import crypto from "node:crypto";
import type { WorkerConfig } from "./config.js";
import type { MailAgentDb } from "./db/client.js";
import { parseEmailSource, type ParsedEmail } from "./email/parser.js";
import type { ImapMailboxClient, UnseenMessage } from "./email/imap.js";
import { buildForwardSubject, type SmtpClient } from "./email/smtp.js";

export type WorkerLogger = {
  info: (bindings: Record<string, unknown>, message?: string) => void;
  warn: (bindings: Record<string, unknown>, message?: string) => void;
  error: (bindings: Record<string, unknown>, message?: string) => void;
  debug: (bindings: Record<string, unknown>, message?: string) => void;
};

export type WorkerDependencies = {
  db: MailAgentDb;
  config: WorkerConfig;
  imap: Pick<ImapMailboxClient, "fetchUnseen" | "markSeen">;
  smtp: Pick<SmtpClient, "forwardOriginalMail">;
  logger?: WorkerLogger;
};

const noopLogger: WorkerLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {}
};

export async function runPollOnce(dependencies: WorkerDependencies): Promise<void> {
  const logger = dependencies.logger ?? noopLogger;
  const mailbox = "INBOX";

  logger.info({ mailbox }, "Mail poll started");
  const messages = await dependencies.imap.fetchUnseen(mailbox);
  logger.info({ mailbox, unseenCount: messages.length }, "Fetched unseen mail");

  for (const message of messages) {
    await processUnseenMessage(dependencies, message, logger);
  }

  logger.info({ mailbox, unseenCount: messages.length }, "Mail poll completed");
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

async function processUnseenMessage(
  dependencies: WorkerDependencies,
  message: UnseenMessage,
  logger: WorkerLogger
): Promise<void> {
  let emailId: number | undefined;
  let stage = "parse_message";

  logger.info(
    { mailbox: message.mailbox, uid: message.uid, uidValidity: message.uidValidity },
    "Processing unseen message"
  );

  try {
    const parsed = await parseEmailSource(message.source, dependencies.config.maxEmailChars);
    logParsedMetadata(logger, message, parsed);

    if (
      dependencies.db.hasProcessedEmail({
        mailbox: message.mailbox,
        uidValidity: message.uidValidity,
        uid: message.uid,
        messageId: parsed.messageId
      })
    ) {
      logger.info(
        { mailbox: message.mailbox, uid: message.uid, uidValidity: message.uidValidity, messageId: parsed.messageId },
        "Skipping duplicate message"
      );
      return;
    }

    stage = "save_email";
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

    const runId = crypto.randomUUID();
    stage = "forward_original";
    logger.info(
      {
        mailbox: message.mailbox,
        uid: message.uid,
        emailId,
        recipient: dependencies.config.forwardToAddress,
        runId
      },
      "Forwarding original message"
    );
    await dependencies.smtp.forwardOriginalMail({
      forwardToAddress: dependencies.config.forwardToAddress,
      original: parsed,
      rawSource: message.source,
      uid: message.uid,
      runId
    });
    logger.info({ mailbox: message.mailbox, uid: message.uid, emailId, runId }, "Forwarded original message");

    stage = "record_outbound_action";
    dependencies.db.recordOutboundAction({
      emailId,
      actionType: "forward_original",
      recipient: dependencies.config.forwardToAddress,
      subject: buildForwardSubject(parsed.subject),
      status: "sent",
      runId
    });

    dependencies.db.updateEmailStatus(emailId, "processed");

    stage = "mark_seen";
    await dependencies.imap.markSeen(message.mailbox, message.uid);
    logger.info({ mailbox: message.mailbox, uid: message.uid, emailId }, "Marked message seen");
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    dependencies.db.recordError({
      emailId,
      stage,
      message: messageText,
      retryable: true
    });

    if (emailId !== undefined) {
      dependencies.db.updateEmailStatus(emailId, "failed");
    }

    logger.error(
      {
        err: error,
        mailbox: message.mailbox,
        uid: message.uid,
        emailId,
        stage
      },
      "Message processing failed"
    );
  }
}

function logParsedMetadata(logger: WorkerLogger, message: UnseenMessage, parsed: ParsedEmail): void {
  logger.debug(
    {
      mailbox: message.mailbox,
      uid: message.uid,
      messageId: parsed.messageId,
      from: parsed.fromAddress,
      subject: parsed.subject,
      bodyPreviewLength: parsed.bodyText.length,
      attachmentCount: parsed.attachments.length
    },
    "Parsed message metadata"
  );

  if (!parsed.messageId || !parsed.fromAddress) {
    logger.warn(
      {
        mailbox: message.mailbox,
        uid: message.uid,
        messageId: parsed.messageId,
        from: parsed.fromAddress
      },
      "Parsed message missing expected metadata"
    );
  }
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
