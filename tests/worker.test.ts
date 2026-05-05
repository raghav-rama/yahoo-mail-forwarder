import { describe, expect, it, vi } from "vitest";
import { createMailAgentDb } from "../src/db/client.js";
import { runPollOnce } from "../src/worker.js";

describe("worker orchestration", () => {
  it("persists, drafts for review, and marks seen only after successful processing", async () => {
    const db = createMailAgentDb(":memory:");
    const markSeen = vi.fn();
    const imap = {
      fetchUnseen: vi.fn().mockResolvedValue([
        {
          mailbox: "INBOX",
          uidValidity: "999",
          uid: 77,
          source: Buffer.from(`From: Alice <alice@example.com>
To: Me <me@yahoo.com>
Subject: Please reply
Message-ID: <worker-1@example.com>
Date: Mon, 1 Jan 2024 12:00:00 +0000

Can you confirm receipt?`)
        }
      ]),
      markSeen
    };
    const router = vi.fn().mockResolvedValue({
      category: "needs_action",
      confidence: 0.95,
      recommended_action: "draft_reply",
      risk_flags: [],
      reason: "sender asks for confirmation"
    });
    const responder = vi.fn().mockResolvedValue({
      reply_subject: "Re: Please reply",
      reply_body_text: "Confirmed, thank you.",
      tone: "concise",
      missing_context: [],
      confidence: 0.96,
      requires_human_review: false
    });

    await runPollOnce({
      db,
      config: {
        yahooEmail: "me@yahoo.com",
        maxEmailChars: 12000,
        minAutoConfidence: 0.92,
        autoSend: false,
        draftReviewAddress: undefined
      },
      imap,
      router,
      responder
    });

    const drafts = db.listDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.status).toBe("pending_review");
    expect(markSeen).toHaveBeenCalledWith("INBOX", 77);

    await runPollOnce({
      db,
      config: {
        yahooEmail: "me@yahoo.com",
        maxEmailChars: 12000,
        minAutoConfidence: 0.92,
        autoSend: false,
        draftReviewAddress: undefined
      },
      imap,
      router,
      responder
    });

    expect(router).toHaveBeenCalledTimes(1);
    expect(markSeen).toHaveBeenCalledTimes(1);
    db.close();
  });

  it("routes low-confidence non-draft decisions to human review", async () => {
    const db = createMailAgentDb(":memory:");
    const markSeen = vi.fn();
    const imap = {
      fetchUnseen: vi.fn().mockResolvedValue([
        {
          mailbox: "INBOX",
          uidValidity: "999",
          uid: 78,
          source: Buffer.from(`From: Alice <alice@example.com>
To: Me <me@yahoo.com>
Subject: Ambiguous
Message-ID: <worker-2@example.com>
Date: Mon, 1 Jan 2024 12:00:00 +0000

Maybe we should talk later.`)
        }
      ]),
      markSeen
    };
    const router = vi.fn().mockResolvedValue({
      category: "unknown",
      confidence: 0.4,
      recommended_action: "mark_seen",
      risk_flags: [],
      reason: "ambiguous"
    });
    const responder = vi.fn();

    await runPollOnce({
      db,
      config: {
        yahooEmail: "me@yahoo.com",
        maxEmailChars: 12000,
        minAutoConfidence: 0.92,
        autoSend: false,
        draftReviewAddress: undefined
      },
      imap,
      router,
      responder
    });

    const email = db.sqlite
      .prepare("SELECT status FROM emails WHERE message_id = ?")
      .get("<worker-2@example.com>") as { status: string } | undefined;

    expect(email?.status).toBe("human_review");
    expect(responder).not.toHaveBeenCalled();
    expect(markSeen).toHaveBeenCalledWith("INBOX", 78);
    db.close();
  });
});
