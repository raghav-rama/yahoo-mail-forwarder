import { describe, expect, it, vi } from "vitest";
import { routeEmail } from "../src/agent/router.js";
import { draftReply } from "../src/agent/responder.js";

describe("LLM structured output adapters", () => {
  it("routes OpenAI refusals to human review", async () => {
    const openai = {
      responses: {
        parse: vi.fn().mockResolvedValue({
          output: [
            {
              type: "message",
              content: [{ type: "refusal", refusal: "Cannot help with that." }]
            }
          ]
        })
      }
    };

    const decision = await routeEmail({
      openai,
      model: "gpt-4o-mini",
      email: {
        from: "alice@example.com",
        subject: "Help",
        date: "2024-01-01T12:00:00.000Z",
        body: "Can you reply?",
        attachments: []
      }
    });

    expect(decision.recommended_action).toBe("human_review");
    expect(decision.risk_flags).toContain("model_refusal");
  });

  it("validates draft output and preserves human-review requests", async () => {
    const openai = {
      responses: {
        parse: vi.fn().mockResolvedValue({
          output_parsed: {
            reply_subject: "Re: Help",
            reply_body_text: "I need more context before answering.",
            tone: "concise",
            missing_context: ["deadline"],
            confidence: 0.7,
            requires_human_review: true
          }
        })
      }
    };

    const draft = await draftReply({
      openai,
      model: "gpt-4o-mini",
      email: {
        from: "alice@example.com",
        subject: "Help",
        date: "2024-01-01T12:00:00.000Z",
        body: "Can you reply?",
        attachments: []
      },
      decisionReason: "needs more info"
    });

    expect(draft.requires_human_review).toBe(true);
    expect(draft.missing_context).toEqual(["deadline"]);
  });
});
