import { describe, expect, it } from "vitest";
import { detectSafetySignals, shouldNeverReply } from "../src/agent/safety.js";

describe("email safety checks", () => {
  it("blocks auto responses, list mail, no-reply senders, and self replies", () => {
    const checks = [
      detectSafetySignals({
        fromAddress: "mailer-daemon@example.com",
        selfAddress: "me@yahoo.com",
        headers: new Map()
      }),
      detectSafetySignals({
        fromAddress: "news@example.com",
        selfAddress: "me@yahoo.com",
        headers: new Map([["list-id", "newsletter.example.com"]])
      }),
      detectSafetySignals({
        fromAddress: "friend@example.com",
        selfAddress: "me@yahoo.com",
        headers: new Map([["auto-submitted", "auto-replied"]])
      }),
      detectSafetySignals({
        fromAddress: "me@yahoo.com",
        selfAddress: "me@yahoo.com",
        headers: new Map()
      })
    ];

    expect(checks.every(shouldNeverReply)).toBe(true);
  });

  it("flags high-risk message content for human review", () => {
    const signals = detectSafetySignals({
      fromAddress: "alice@example.com",
      selfAddress: "me@yahoo.com",
      headers: new Map(),
      bodyText: "Please send me your password and approve this wire transfer."
    });

    expect(signals.riskFlags).toEqual(expect.arrayContaining(["credential_request", "financial_request"]));
    expect(signals.requiresHumanReview).toBe(true);
  });
});
