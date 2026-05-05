import crypto from "node:crypto";
import nodemailer, { type SentMessageInfo } from "nodemailer";
import type { AppConfig } from "../config.js";
import type { ParsedEmail } from "./parser.js";

export type OriginalMailForwardInput = {
  forwardToAddress: string;
  original: Pick<
    ParsedEmail,
    "messageId" | "fromAddress" | "subject" | "date" | "replyToAddresses" | "bodyText"
  >;
  rawSource: Buffer;
  uid: number;
  runId?: string;
};

export type SmtpClient = {
  forwardOriginalMail(input: OriginalMailForwardInput): Promise<SentMessageInfo>;
  close(): void;
};

export function createYahooSmtpClient(config: Pick<AppConfig, "yahooEmail" | "yahooAppPassword">): SmtpClient {
  const transporter = nodemailer.createTransport({
    host: "smtp.mail.yahoo.com",
    port: 465,
    secure: true,
    auth: {
      user: config.yahooEmail,
      pass: config.yahooAppPassword
    }
  });

  return {
    forwardOriginalMail(input) {
      const subject = buildForwardSubject(input.original.subject);

      return transporter.sendMail({
        from: config.yahooEmail,
        to: input.forwardToAddress,
        subject,
        text: buildForwardBody(input.original),
        headers: {
          "X-Yahoo-Forwarder-Run-Id": input.runId ?? crypto.randomUUID()
        },
        attachments: [
          {
            filename: buildAttachmentFilename(input.original.messageId, input.uid),
            content: input.rawSource,
            contentType: "application/octet-stream"
          }
        ]
      });
    },

    close() {
      transporter.close();
    }
  };
}

export function buildForwardSubject(subject: string): string {
  return `Fwd: ${subject.trim() || "(no subject)"}`;
}

function buildForwardBody(original: OriginalMailForwardInput["original"]): string {
  return [
    "Forwarded original Yahoo mail.",
    "",
    `Original from: ${original.fromAddress ?? "unknown"}`,
    `Original reply-to: ${original.replyToAddresses[0] ?? "unknown"}`,
    `Original subject: ${original.subject.trim() || "(no subject)"}`,
    `Original date: ${original.date?.toISOString() ?? "unknown"}`,
    `Original message id: ${original.messageId ?? "unknown"}`,
    "",
    "Parsed body preview:",
    "",
    original.bodyText.trim() || "(empty body)"
  ].join("\n");
}

function buildAttachmentFilename(messageId: string | undefined, uid: number): string {
  const base = messageId ? messageId.replace(/^<|>$/g, "") : `uid-${uid}`;
  const safeBase = base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${safeBase || `uid-${uid}`}.eml`;
}
