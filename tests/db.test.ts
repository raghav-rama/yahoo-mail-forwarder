import { afterEach, describe, expect, it } from "vitest";
import { createMailAgentDb } from "../src/db/client.js";

describe("mail agent database", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("treats duplicate message IDs and duplicate Yahoo UID tuples as already processed", () => {
    const db = createMailAgentDb(":memory:");

    expect(
      db.hasProcessedEmail({
        mailbox: "INBOX",
        uidValidity: "123",
        uid: 10,
        messageId: "<same@example.com>"
      })
    ).toBe(false);

    db.saveEmail({
      mailbox: "INBOX",
      uidValidity: "123",
      uid: 10,
      messageId: "<same@example.com>",
      fromAddress: "alice@example.com",
      fromName: "Alice",
      subject: "Hello",
      receivedAt: new Date("2024-01-01T12:00:00Z"),
      bodyHash: "hash",
      bodyPreview: "preview",
      status: "processed",
      threadKey: "thread"
    });

    expect(
      db.hasProcessedEmail({
        mailbox: "INBOX",
        uidValidity: "123",
        uid: 11,
        messageId: "<same@example.com>"
      })
    ).toBe(true);
    expect(
      db.hasProcessedEmail({
        mailbox: "INBOX",
        uidValidity: "123",
        uid: 10
      })
    ).toBe(true);

    db.close();
  });
});
