import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { schemaSql } from "./schema.js";

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
