import "dotenv/config";
import { z } from "zod";

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

const envSchema = z
  .object({
    YAHOO_EMAIL: z.string().email(),
    YAHOO_APP_PASSWORD: z.string().min(1),
    FORWARD_TO_ADDRESS: z.string().email(),
    MAIL_POLL_INTERVAL_MS: numberFromEnv(60_000),
    MAX_EMAIL_CHARS: numberFromEnv(12_000),
    DATABASE_PATH: z.string().default("./data/mail-forwarder.db"),
    LOG_LEVEL: z.string().default("info")
  })
  .superRefine((env, context) => {
    if (env.FORWARD_TO_ADDRESS.toLowerCase() === env.YAHOO_EMAIL.toLowerCase()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["FORWARD_TO_ADDRESS"],
        message: "FORWARD_TO_ADDRESS must be different from YAHOO_EMAIL"
      });
    }
  });

export type AppConfig = {
  yahooEmail: string;
  yahooAppPassword: string;
  forwardToAddress: string;
  mailPollIntervalMs: number;
  maxEmailChars: number;
  databasePath: string;
  logLevel: string;
};

export type WorkerConfig = Pick<AppConfig, "yahooEmail" | "forwardToAddress" | "maxEmailChars">;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);

  return {
    yahooEmail: parsed.YAHOO_EMAIL,
    yahooAppPassword: parsed.YAHOO_APP_PASSWORD,
    forwardToAddress: parsed.FORWARD_TO_ADDRESS,
    mailPollIntervalMs: parsed.MAIL_POLL_INTERVAL_MS,
    maxEmailChars: parsed.MAX_EMAIL_CHARS,
    databasePath: parsed.DATABASE_PATH,
    logLevel: parsed.LOG_LEVEL
  };
}
