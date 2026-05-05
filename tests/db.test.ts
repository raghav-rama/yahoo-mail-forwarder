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

  it("records outbound forwarding actions without draft or agent decision records", () => {
    const db = createMailAgentDb(":memory:");
    const email = db.saveEmail({
      mailbox: "INBOX",
      uidValidity: "123",
      uid: 12,
      messageId: "<forward@example.com>",
      fromAddress: "alice@example.com",
      fromName: "Alice",
      subject: "Forward me",
      receivedAt: new Date("2024-01-01T12:00:00Z"),
      bodyHash: "hash",
      bodyPreview: "preview",
      status: "processing",
      threadKey: "thread"
    });

    db.recordOutboundAction({
      emailId: email.id,
      actionType: "forward_original",
      recipient: "archive@example.com",
      subject: "Fwd: Forward me",
      status: "sent",
      runId: "run-1"
    });

    const action = db.sqlite
      .prepare("SELECT action_type AS actionType, recipient, subject, status, run_id AS runId FROM outbound_actions")
      .get() as { actionType: string; recipient: string; subject: string; status: string; runId: string } | undefined;

    expect(action).toEqual({
      actionType: "forward_original",
      recipient: "archive@example.com",
      subject: "Fwd: Forward me",
      status: "sent",
      runId: "run-1"
    });

    db.close();
  });
});
