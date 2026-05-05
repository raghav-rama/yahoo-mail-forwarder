import { describe, expect, it, vi } from "vitest";
import { createMailAgentDb } from "../src/db/client.js";
import { runPollOnce } from "../src/worker.js";

const workerConfig = {
  yahooEmail: "me@yahoo.com",
  forwardToAddress: "archive@example.com",
  maxEmailChars: 12_000
};

describe("worker orchestration", () => {
  it("forwards unseen mail, records the action, marks seen after forwarding, and skips duplicates", async () => {
    const db = createMailAgentDb(":memory:");
    const markSeen = vi.fn();
    const forwardOriginalMail = vi.fn().mockResolvedValue({ messageId: "smtp-1" });
    const rawSource = Buffer.from(`From: Alice <alice@example.com>
Reply-To: Alice Replies <reply@example.com>
To: Me <me@yahoo.com>
Subject: Please forward
Message-ID: <worker-1@example.com>
Date: Mon, 1 Jan 2024 12:00:00 +0000

Can you keep this for me?`);
    const imap = {
      fetchUnseen: vi.fn().mockResolvedValue([
        {
          mailbox: "INBOX",
          uidValidity: "999",
          uid: 77,
          source: rawSource
        }
      ]),
      markSeen
    };

    await runPollOnce({
      db,
      config: workerConfig,
      imap,
      smtp: { forwardOriginalMail }
    });

    expect(forwardOriginalMail).toHaveBeenCalledOnce();
    expect(forwardOriginalMail).toHaveBeenCalledWith({
      forwardToAddress: "archive@example.com",
      original: expect.objectContaining({
        messageId: "<worker-1@example.com>",
        fromAddress: "alice@example.com",
        subject: "Please forward",
        replyToAddresses: ["reply@example.com"],
        bodyText: "Can you keep this for me?"
      }),
      rawSource,
      uid: 77,
      runId: expect.any(String)
    });
    expect(markSeen).toHaveBeenCalledWith("INBOX", 77);
    expect(forwardOriginalMail.mock.invocationCallOrder[0]).toBeLessThan(markSeen.mock.invocationCallOrder[0]);

    const email = db.sqlite.prepare("SELECT id, status FROM emails WHERE message_id = ?").get("<worker-1@example.com>") as
      | { id: number; status: string }
      | undefined;
    expect(email?.status).toBe("processed");

    const action = db.sqlite
      .prepare("SELECT action_type AS actionType, recipient, subject, status FROM outbound_actions WHERE email_id = ?")
      .get(email?.id) as { actionType: string; recipient: string; subject: string; status: string } | undefined;
    expect(action).toEqual({
      actionType: "forward_original",
      recipient: "archive@example.com",
      subject: "Fwd: Please forward",
      status: "sent"
    });

    await runPollOnce({
      db,
      config: workerConfig,
      imap,
      smtp: { forwardOriginalMail }
    });

    expect(forwardOriginalMail).toHaveBeenCalledTimes(1);
    expect(markSeen).toHaveBeenCalledTimes(1);
    db.close();
  });

  it("records failures and leaves messages unseen when SMTP forwarding fails", async () => {
    const db = createMailAgentDb(":memory:");
    const markSeen = vi.fn();
    const forwardOriginalMail = vi.fn().mockRejectedValue(new Error("SMTP unavailable"));
    const imap = {
      fetchUnseen: vi.fn().mockResolvedValue([
        {
          mailbox: "INBOX",
          uidValidity: "999",
          uid: 78,
          source: Buffer.from(`From: Bob <bob@example.com>
To: Me <me@yahoo.com>
Subject: Failing message
Message-ID: <worker-2@example.com>
Date: Mon, 1 Jan 2024 12:00:00 +0000

This should not be marked seen.`)
        }
      ]),
      markSeen
    };

    await runPollOnce({
      db,
      config: workerConfig,
      imap,
      smtp: { forwardOriginalMail }
    });

    const email = db.sqlite.prepare("SELECT id, status FROM emails WHERE message_id = ?").get("<worker-2@example.com>") as
      | { id: number; status: string }
      | undefined;
    expect(email?.status).toBe("failed");

    const error = db.sqlite.prepare("SELECT stage, message, retryable FROM errors WHERE email_id = ?").get(email?.id) as
      | { stage: string; message: string; retryable: 0 | 1 }
      | undefined;
    expect(error).toEqual({
      stage: "forward_original",
      message: "SMTP unavailable",
      retryable: 1
    });
    expect(markSeen).not.toHaveBeenCalled();
    db.close();
  });
});
