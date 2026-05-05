import crypto from "node:crypto";
import nodemailer, { type SentMessageInfo } from "nodemailer";
import type { AppConfig } from "../config.js";
import type { ResponderDraft } from "../agent/schemas.js";

export type DraftForwardInput = {
  originalFrom?: string;
  reviewAddress: string;
  draft: ResponderDraft;
  runId?: string;
};

export type SmtpClient = {
  forwardDraftForReview(input: DraftForwardInput): Promise<SentMessageInfo>;
  sendReply(input: {
    to: string;
    subject: string;
    bodyText: string;
    runId?: string;
  }): Promise<SentMessageInfo>;
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
    forwardDraftForReview(input) {
      return transporter.sendMail({
        from: config.yahooEmail,
        to: input.reviewAddress,
        subject: `[Review draft] ${input.draft.reply_subject}`,
        text: [
          `Original sender: ${input.originalFrom ?? "unknown"}`,
          "",
          "Proposed draft:",
          "",
          input.draft.reply_body_text
        ].join("\n"),
        headers: {
          "X-Yahoo-Agent-Run-Id": input.runId ?? crypto.randomUUID()
        }
      });
    },

    sendReply(input) {
      return transporter.sendMail({
        from: config.yahooEmail,
        to: input.to,
        subject: input.subject,
        text: input.bodyText,
        headers: {
          "X-Yahoo-Agent-Run-Id": input.runId ?? crypto.randomUUID()
        }
      });
    },

    close() {
      transporter.close();
    }
  };
}
