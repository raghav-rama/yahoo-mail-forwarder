import OpenAI from "openai";
import pino from "pino";
import { loadConfig } from "./config.js";
import { createMailAgentDb } from "./db/client.js";
import { createYahooImapClient } from "./email/imap.js";
import { createYahooSmtpClient } from "./email/smtp.js";
import { draftReply } from "./agent/responder.js";
import { routeEmail } from "./agent/router.js";
import type { LlmEmailInput } from "./agent/schemas.js";
import { runPollOnce, startPolling } from "./worker.js";

async function main() {
  const config = loadConfig();
  const logger = pino({ level: config.logLevel });
  const db = createMailAgentDb(config.databasePath);
  const openai = new OpenAI({ apiKey: config.openaiApiKey });
  const imap = createYahooImapClient(config);
  const smtp = createYahooSmtpClient(config);
  const abortController = new AbortController();

  const dependencies = {
    db,
    config,
    imap,
    smtp,
    router: (email: LlmEmailInput) =>
      routeEmail({
        openai,
        model: config.openaiModel,
        email
      }),
    responder: ({ email, decisionReason }: { email: LlmEmailInput; decisionReason: string }) =>
      draftReply({
        openai,
        model: config.openaiModel,
        email,
        decisionReason
      })
  };

  const shutdown = async () => {
    abortController.abort();
    await imap.close();
    smtp.close();
    db.close();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  if (process.argv.includes("--once")) {
    await runPollOnce(dependencies);
    await shutdown();
    return;
  }

  logger.info({ intervalMs: config.mailPollIntervalMs }, "Starting Yahoo mail agent poller");
  await startPolling(dependencies, {
    intervalMs: config.mailPollIntervalMs,
    signal: abortController.signal,
    onError: (error) => logger.error({ err: error }, "Polling iteration failed")
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
