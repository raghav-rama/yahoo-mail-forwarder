import pino from "pino";
import { loadConfig } from "./config.js";
import { createMailAgentDb } from "./db/client.js";
import { createYahooImapClient } from "./email/imap.js";
import { createYahooSmtpClient } from "./email/smtp.js";
import { runPollOnce, startPolling } from "./worker.js";

async function main() {
  const config = loadConfig();
  const logger = pino({ level: config.logLevel });
  const db = createMailAgentDb(config.databasePath);
  const imap = createYahooImapClient(config);
  const smtp = createYahooSmtpClient(config);
  const abortController = new AbortController();

  const dependencies = {
    db,
    config,
    imap,
    smtp,
    logger
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

  logger.info(
    {
      config: {
        yahooEmail: config.yahooEmail,
        forwardToAddresses: config.forwardToAddresses,
        mailPollIntervalMs: config.mailPollIntervalMs,
        maxEmailChars: config.maxEmailChars,
        databasePath: config.databasePath,
        logLevel: config.logLevel
      }
    },
    "Starting Yahoo mail forwarder"
  );
  await startPolling(dependencies, {
    intervalMs: config.mailPollIntervalMs,
    signal: abortController.signal,
    onError: (error) => logger.error({ err: error, mailbox: "INBOX", stage: "poll_iteration" }, "Polling iteration failed")
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
