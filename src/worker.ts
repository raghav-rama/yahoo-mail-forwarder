import crypto from "node:crypto";
import type { WorkerConfig } from "./config.js";
import type { MailAgentDb } from "./db/client.js";
import { parseEmailSource, type ParsedEmail } from "./email/parser.js";
import type { ImapMailboxClient, UnseenMessage } from "./email/imap.js";
import type { SmtpClient } from "./email/smtp.js";
import { detectSafetySignals, shouldNeverReply } from "./agent/safety.js";
import type { LlmEmailInput, ResponderDraft, RouterDecision } from "./agent/schemas.js";

export type WorkerDependencies = {
  db: MailAgentDb;
  config: WorkerConfig;
  imap: Pick<ImapMailboxClient, "fetchUnseen" | "markSeen">;
  smtp?: Pick<SmtpClient, "forwardDraftForReview" | "sendReply">;
  router: (email: LlmEmailInput) => Promise<RouterDecision>;
  responder: (input: { email: LlmEmailInput; decisionReason: string }) => Promise<ResponderDraft>;
};

export async function runPollOnce(dependencies: WorkerDependencies): Promise<void> {
  const messages = await dependencies.imap.fetchUnseen("INBOX");

  for (const message of messages) {
    await processUnseenMessage(dependencies, message);
  }
}

export async function startPolling(
  dependencies: WorkerDependencies,
  options: {
    intervalMs: number;
    signal?: AbortSignal;
    onError?: (error: unknown) => void;
  }
): Promise<void> {
  while (!options.signal?.aborted) {
    try {
      await runPollOnce(dependencies);
    } catch (error) {
      options.onError?.(error);
    }

    await delay(options.intervalMs, options.signal);
  }
}

async function processUnseenMessage(dependencies: WorkerDependencies, message: UnseenMessage): Promise<void> {
  let emailId: number | undefined;

  try {
    const parsed = await parseEmailSource(message.source, dependencies.config.maxEmailChars);

    if (
      dependencies.db.hasProcessedEmail({
        mailbox: message.mailbox,
        uidValidity: message.uidValidity,
        uid: message.uid,
        messageId: parsed.messageId
      })
    ) {
      return;
    }

    const threadKey = buildThreadKey(parsed);
    const saved = dependencies.db.saveEmail({
      mailbox: message.mailbox,
      uidValidity: message.uidValidity,
      uid: message.uid,
      messageId: parsed.messageId,
      fromAddress: parsed.fromAddress,
      fromName: parsed.fromName,
      subject: parsed.subject,
      receivedAt: parsed.date ?? normalizeDate(message.internalDate),
      bodyHash: parsed.bodyHash,
      bodyPreview: parsed.bodyText.slice(0, 1_000),
      status: "processing",
      threadKey
    });
    emailId = saved.id;

    const safety = detectSafetySignals({
      fromAddress: parsed.fromAddress,
      selfAddress: dependencies.config.yahooEmail,
      headers: parsed.headers,
      bodyText: parsed.bodyText
    });

    if (shouldNeverReply(safety)) {
      const decision: RouterDecision = {
        category: safety.isListMail ? "newsletter" : "unknown",
        confidence: 1,
        recommended_action: "mark_seen",
        risk_flags: ["never_reply"],
        reason: "Message matched deterministic no-reply safety guardrails."
      };
      dependencies.db.saveAgentDecision(saved.id, decision);
      dependencies.db.updateEmailStatus(saved.id, "ignored");
      await dependencies.imap.markSeen(message.mailbox, message.uid);
      return;
    }

    const llmEmail = toLlmEmailInput(parsed, safety.riskFlags);
    const decision = await dependencies.router(llmEmail);
    const guardedDecision = applyPolicyToDecision(decision, {
      riskFlags: safety.riskFlags,
      minConfidence: dependencies.config.minAutoConfidence
    });
    dependencies.db.saveAgentDecision(saved.id, guardedDecision);

    if (guardedDecision.recommended_action !== "draft_reply") {
      dependencies.db.updateEmailStatus(
        saved.id,
        guardedDecision.recommended_action === "human_review" ? "human_review" : "processed"
      );
      await dependencies.imap.markSeen(message.mailbox, message.uid);
      return;
    }

    if (safety.requiresHumanReview) {
      dependencies.db.updateEmailStatus(saved.id, "human_review");
      await dependencies.imap.markSeen(message.mailbox, message.uid);
      return;
    }

    const draft = await dependencies.responder({
      email: llmEmail,
      decisionReason: guardedDecision.reason
    });
    const recipient = parsed.replyToAddresses[0] ?? parsed.fromAddress ?? "";
    dependencies.db.saveDraft({
      emailId: saved.id,
      recipient,
      draft,
      status: "pending_review"
    });

    if (dependencies.config.draftReviewAddress && dependencies.smtp) {
      const runId = crypto.randomUUID();
      await dependencies.smtp.forwardDraftForReview({
        originalFrom: parsed.fromAddress,
        reviewAddress: dependencies.config.draftReviewAddress,
        draft,
        runId
      });
      dependencies.db.recordOutboundAction({
        emailId: saved.id,
        actionType: "forward_draft_for_review",
        recipient: dependencies.config.draftReviewAddress,
        subject: draft.reply_subject,
        status: "sent",
        runId
      });
    }

    dependencies.db.updateEmailStatus(saved.id, draft.requires_human_review ? "human_review" : "processed");
    await dependencies.imap.markSeen(message.mailbox, message.uid);
  } catch (error) {
    dependencies.db.recordError({
      emailId,
      stage: "process_message",
      message: error instanceof Error ? error.message : String(error),
      retryable: true
    });

    if (emailId !== undefined) {
      dependencies.db.updateEmailStatus(emailId, "failed");
    }
  }
}

function toLlmEmailInput(parsed: ParsedEmail, safetyFlags: string[]): LlmEmailInput {
  return {
    from: parsed.fromAddress,
    subject: parsed.subject,
    date: parsed.date?.toISOString(),
    messageId: parsed.messageId,
    body: parsed.bodyText,
    attachments: parsed.attachments.map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size
    })),
    safetyFlags
  };
}

function applyPolicyToDecision(
  decision: RouterDecision,
  policy: {
    riskFlags: string[];
    minConfidence: number;
  }
): RouterDecision {
  const extraFlags = new Set(policy.riskFlags);
  let recommendedAction = decision.recommended_action;
  let reason = decision.reason;

  if (decision.confidence < policy.minConfidence) {
    extraFlags.add("low_confidence");
    recommendedAction = "human_review";
    reason = `${reason} Confidence is below the configured threshold.`;
  }

  if (decision.recommended_action === "draft_reply" && decision.category !== "needs_action") {
    extraFlags.add("category_action_mismatch");
    recommendedAction = "human_review";
    reason = `${reason} Draft replies require needs_action classification.`;
  }

  if (policy.riskFlags.length > 0) {
    recommendedAction = "human_review";
    reason = `${reason} Deterministic safety checks require human review.`;
  }

  if (extraFlags.size === 0 && recommendedAction === decision.recommended_action) {
    return decision;
  }

  return {
    ...decision,
    recommended_action: recommendedAction,
    risk_flags: [...new Set([...decision.risk_flags, ...extraFlags])],
    reason
  };
}

function buildThreadKey(parsed: ParsedEmail): string {
  const firstReference = parsed.references[0] ?? parsed.inReplyTo ?? parsed.messageId;
  if (firstReference) {
    return firstReference.toLowerCase();
  }

  return `${normalizeSubject(parsed.subject)}:${parsed.fromAddress ?? "unknown"}`;
}

function normalizeSubject(subject: string): string {
  return subject.replace(/^(re|fwd):\s*/i, "").trim().toLowerCase();
}

function normalizeDate(value: Date | string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  return value instanceof Date ? value : new Date(value);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}
