import { z } from "zod";

export const routerDecisionSchema = z.object({
  category: z.enum(["spam", "newsletter", "personal", "transactional", "needs_action", "unknown"]),
  confidence: z.number().min(0).max(1),
  recommended_action: z.enum(["ignore", "mark_seen", "move", "draft_reply", "human_review"]),
  risk_flags: z.array(z.string()),
  reason: z.string().max(500)
});

export type RouterDecision = z.infer<typeof routerDecisionSchema>;

export const responderDraftSchema = z.object({
  reply_subject: z.string().min(1).max(300),
  reply_body_text: z.string().min(1).max(12_000),
  tone: z.string().min(1).max(80),
  missing_context: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  requires_human_review: z.boolean()
});

export type ResponderDraft = z.infer<typeof responderDraftSchema>;

export type LlmEmailInput = {
  from?: string;
  subject: string;
  date?: string;
  messageId?: string;
  body: string;
  attachments: Array<{
    filename?: string;
    contentType?: string;
    size?: number;
  }>;
  threadSummary?: string;
  safetyFlags?: string[];
};
