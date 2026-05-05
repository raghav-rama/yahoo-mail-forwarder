import "dotenv/config";
import { z } from "zod";

const booleanFromEnv = z
  .string()
  .optional()
  .transform((value) => value === "true");

const numberFromEnv = (defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (!value || value.trim() === "") {
        return defaultValue;
      }

      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error(`Expected a numeric env value, received ${value}`);
      }

      return parsed;
    });

const envSchema = z.object({
  YAHOO_EMAIL: z.string().email(),
  YAHOO_APP_PASSWORD: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  MAIL_POLL_INTERVAL_MS: numberFromEnv(60_000),
  AUTO_SEND: booleanFromEnv.default("false"),
  DRAFT_REVIEW_ADDRESS: z.string().email().optional().or(z.literal("")),
  MAX_EMAIL_CHARS: numberFromEnv(12_000),
  MIN_AUTO_CONFIDENCE: numberFromEnv(0.92),
  DATABASE_PATH: z.string().default("./data/mail-agent.db"),
  LOG_LEVEL: z.string().default("info")
});

export type AppConfig = {
  yahooEmail: string;
  yahooAppPassword: string;
  openaiApiKey: string;
  openaiModel: string;
  mailPollIntervalMs: number;
  autoSend: boolean;
  draftReviewAddress?: string;
  maxEmailChars: number;
  minAutoConfidence: number;
  databasePath: string;
  logLevel: string;
};

export type WorkerConfig = Pick<
  AppConfig,
  "yahooEmail" | "maxEmailChars" | "minAutoConfidence" | "autoSend" | "draftReviewAddress"
>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);

  return {
    yahooEmail: parsed.YAHOO_EMAIL,
    yahooAppPassword: parsed.YAHOO_APP_PASSWORD,
    openaiApiKey: parsed.OPENAI_API_KEY,
    openaiModel: parsed.OPENAI_MODEL,
    mailPollIntervalMs: parsed.MAIL_POLL_INTERVAL_MS,
    autoSend: parsed.AUTO_SEND,
    draftReviewAddress: parsed.DRAFT_REVIEW_ADDRESS || undefined,
    maxEmailChars: parsed.MAX_EMAIL_CHARS,
    minAutoConfidence: parsed.MIN_AUTO_CONFIDENCE,
    databasePath: parsed.DATABASE_PATH,
    logLevel: parsed.LOG_LEVEL
  };
}
