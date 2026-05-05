import { beforeEach, describe, expect, it, vi } from "vitest";
import { createYahooSmtpClient } from "../src/email/smtp.js";

const nodemailerMock = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  close: vi.fn()
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: nodemailerMock.createTransport
  }
}));

describe("Yahoo SMTP client", () => {
  beforeEach(() => {
    nodemailerMock.sendMail.mockResolvedValue({ messageId: "smtp-1" });
    nodemailerMock.createTransport.mockReturnValue({
      sendMail: nodemailerMock.sendMail,
      close: nodemailerMock.close
    });
  });

  it("forwards the parsed message summary and attaches the original raw email with a Yahoo-safe MIME type", async () => {
    const rawSource = Buffer.from("raw rfc822 source");
    const smtp = createYahooSmtpClient({
      yahooEmail: "me@yahoo.com",
      yahooAppPassword: "app-password"
    });

    await smtp.forwardOriginalMail({
      forwardToAddress: "archive@example.com",
      original: {
        messageId: "<worker-1@example.com>",
        fromAddress: "alice@example.com",
        subject: "Hello",
        date: new Date("2024-01-01T12:00:00.000Z"),
        replyToAddresses: ["reply@example.com"],
        bodyText: "A short body preview."
      },
      rawSource,
      uid: 77,
      runId: "run-123"
    });

    expect(nodemailerMock.sendMail).toHaveBeenCalledWith({
      from: "me@yahoo.com",
      to: "archive@example.com",
      subject: "Fwd: Hello",
      text: expect.stringContaining("Original from: alice@example.com"),
      headers: {
        "X-Yahoo-Forwarder-Run-Id": "run-123"
      },
      attachments: [
        {
          filename: "worker-1-example.com.eml",
          content: rawSource,
          contentType: "application/octet-stream"
        }
      ]
    });

    expect(nodemailerMock.sendMail.mock.calls[0]?.[0]).not.toHaveProperty("replyTo");
  });
});
