import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { schemaSql } from "./schema.js";
import type { RouterDecision } from "../agent/schemas.js";
import type { ResponderDraft } from "../agent/schemas.js";

export type SaveEmailInput = {
  mailbox: string;
  uidValidity: string;
  uid: number;
  messageId?: string;
  fromAddress?: string;
  fromName?: string;
  subject: string;
  receivedAt?: Date;
  bodyHash: string;
  bodyPreview: string;
  status: EmailStatus;
  threadKey: string;
};

export type EmailStatus = "processing" | "processed" | "ignored" | "failed" | "human_review";

export type SavedEmail = SaveEmailInput & {
  id: number;
};

export type DraftRecord = {
  id: number;
  emailId: number;
  recipient: string;
  subject: string;
  bodyText: string;
  tone: string;
  missingContext: string[];
  confidence: number;
  requiresHumanReview: boolean;
  status: string;
};

export type ProcessedLookup = {
  mailbox: string;
  uidValidity: string;
  uid: number;
  messageId?: string;
};

export type MailAgentDb = ReturnType<typeof createMailAgentDb>;

export function createMailAgentDb(path: string) {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(schemaSql);

  return {
    hasProcessedEmail(input: ProcessedLookup): boolean {
      const row = sqlite
        .prepare(
          `
          SELECT id
          FROM emails
          WHERE status != 'failed'
            AND (
              (message_id IS NOT NULL AND message_id = @messageId)
              OR (mailbox = @mailbox AND uid_validity = @uidValidity AND uid = @uid)
            )
          LIMIT 1
        `
        )
        .get({
          mailbox: input.mailbox,
          uidValidity: input.uidValidity,
          uid: input.uid,
          messageId: input.messageId ?? null
        });

      return Boolean(row);
    },

    saveEmail(input: SaveEmailInput): SavedEmail {
      const existing = sqlite
        .prepare(
          `
          SELECT id
          FROM emails
          WHERE (message_id IS NOT NULL AND message_id = @messageId)
             OR (mailbox = @mailbox AND uid_validity = @uidValidity AND uid = @uid)
          LIMIT 1
        `
        )
        .get({
          mailbox: input.mailbox,
          uidValidity: input.uidValidity,
          uid: input.uid,
          messageId: input.messageId ?? null
        }) as { id: number } | undefined;

      if (existing) {
        return { ...input, id: existing.id };
      }

      const info = sqlite
        .prepare(
          `
          INSERT INTO emails (
            mailbox, uid_validity, uid, message_id, from_address, from_name,
            subject, received_at, body_hash, body_preview, status, thread_key
          )
          VALUES (
            @mailbox, @uidValidity, @uid, @messageId, @fromAddress, @fromName,
            @subject, @receivedAt, @bodyHash, @bodyPreview, @status, @threadKey
          )
        `
        )
        .run({
          mailbox: input.mailbox,
          uidValidity: input.uidValidity,
          uid: input.uid,
          messageId: input.messageId ?? null,
          fromAddress: input.fromAddress ?? null,
          fromName: input.fromName ?? null,
          subject: input.subject,
          receivedAt: input.receivedAt?.toISOString() ?? null,
          bodyHash: input.bodyHash,
          bodyPreview: input.bodyPreview,
          status: input.status,
          threadKey: input.threadKey
        });

      this.upsertThread(input.threadKey, input.receivedAt);

      return { ...input, id: Number(info.lastInsertRowid) };
    },

    updateEmailStatus(emailId: number, status: EmailStatus): void {
      sqlite
        .prepare("UPDATE emails SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(status, emailId);
    },

    upsertThread(threadKey: string, lastMessageAt?: Date): void {
      sqlite
        .prepare(
          `
          INSERT INTO threads (thread_key, last_message_at)
          VALUES (@threadKey, @lastMessageAt)
          ON CONFLICT(thread_key) DO UPDATE SET
            last_message_at = COALESCE(excluded.last_message_at, threads.last_message_at),
            updated_at = CURRENT_TIMESTAMP
        `
        )
        .run({
          threadKey,
          lastMessageAt: lastMessageAt?.toISOString() ?? null
        });
    },

    saveAgentDecision(emailId: number, decision: RouterDecision): number {
      const info = sqlite
        .prepare(
          `
          INSERT INTO agent_decisions (
            email_id, category, confidence, recommended_action, risk_flags_json, reason
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          emailId,
          decision.category,
          decision.confidence,
          decision.recommended_action,
          JSON.stringify(decision.risk_flags),
          decision.reason
        );

      return Number(info.lastInsertRowid);
    },

    saveDraft(input: {
      emailId: number;
      recipient: string;
      draft: ResponderDraft;
      status: "pending_review" | "forwarded_for_review" | "sent";
    }): number {
      const info = sqlite
        .prepare(
          `
          INSERT INTO drafts (
            email_id, recipient, subject, body_text, tone, missing_context_json,
            confidence, requires_human_review, status
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          input.emailId,
          input.recipient,
          input.draft.reply_subject,
          input.draft.reply_body_text,
          input.draft.tone,
          JSON.stringify(input.draft.missing_context),
          input.draft.confidence,
          input.draft.requires_human_review ? 1 : 0,
          input.status
        );

      return Number(info.lastInsertRowid);
    },

    listDrafts(): DraftRecord[] {
      const rows = sqlite
        .prepare(
          `
          SELECT
            id,
            email_id AS emailId,
            recipient,
            subject,
            body_text AS bodyText,
            tone,
            missing_context_json AS missingContextJson,
            confidence,
            requires_human_review AS requiresHumanReview,
            status
          FROM drafts
          ORDER BY id ASC
        `
        )
        .all() as Array<{
        id: number;
        emailId: number;
        recipient: string;
        subject: string;
        bodyText: string;
        tone: string;
        missingContextJson: string;
        confidence: number;
        requiresHumanReview: 0 | 1;
        status: string;
      }>;

      return rows.map((row) => ({
        id: row.id,
        emailId: row.emailId,
        recipient: row.recipient,
        subject: row.subject,
        bodyText: row.bodyText,
        tone: row.tone,
        missingContext: JSON.parse(row.missingContextJson) as string[],
        confidence: row.confidence,
        requiresHumanReview: row.requiresHumanReview === 1,
        status: row.status
      }));
    },

    recordOutboundAction(input: {
      emailId?: number;
      actionType: string;
      recipient?: string;
      subject?: string;
      status: string;
      runId: string;
    }): number {
      const info = sqlite
        .prepare(
          `
          INSERT INTO outbound_actions (email_id, action_type, recipient, subject, status, run_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          input.emailId ?? null,
          input.actionType,
          input.recipient ?? null,
          input.subject ?? null,
          input.status,
          input.runId
        );

      return Number(info.lastInsertRowid);
    },

    recordError(input: { emailId?: number; stage: string; message: string; retryable: boolean }): number {
      const info = sqlite
        .prepare(
          `
          INSERT INTO errors (email_id, stage, message, retryable)
          VALUES (?, ?, ?, ?)
        `
        )
        .run(input.emailId ?? null, input.stage, input.message, input.retryable ? 1 : 0);

      return Number(info.lastInsertRowid);
    },

    close(): void {
      sqlite.close();
    },

    sqlite
  };
}
