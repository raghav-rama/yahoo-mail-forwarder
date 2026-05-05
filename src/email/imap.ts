import { ImapFlow, type FetchMessageObject } from "imapflow";
import type { AppConfig } from "../config.js";

export type UnseenMessage = {
  mailbox: string;
  uidValidity: string;
  uid: number;
  envelope?: FetchMessageObject["envelope"];
  flags?: Set<string>;
  internalDate?: Date | string;
  source: Buffer;
};

export type ImapMailboxClient = {
  fetchUnseen(mailbox?: string): Promise<UnseenMessage[]>;
  markSeen(mailbox: string, uid: number): Promise<void>;
  close(): Promise<void>;
};

export function createYahooImapClient(config: Pick<AppConfig, "yahooEmail" | "yahooAppPassword">): ImapMailboxClient {
  const client = new ImapFlow({
    host: "imap.mail.yahoo.com",
    port: 993,
    secure: true,
    auth: {
      user: config.yahooEmail,
      pass: config.yahooAppPassword
    },
    logger: false
  });

  let connected = false;

  async function ensureConnected() {
    if (!connected) {
      await client.connect();
      connected = true;
    }
  }

  return {
    async fetchUnseen(mailbox = "INBOX"): Promise<UnseenMessage[]> {
      await ensureConnected();
      const lock = await client.getMailboxLock(mailbox, { readOnly: false, description: "Fetch unseen Yahoo mail" });

      try {
        const uidValidity = client.mailbox ? client.mailbox.uidValidity.toString() : "unknown";
        const uids = await client.search({ seen: false }, { uid: true });
        if (!uids || uids.length === 0) {
          return [];
        }

        const messages: UnseenMessage[] = [];
        for await (const message of client.fetch(
          uids,
          { uid: true, envelope: true, flags: true, internalDate: true, source: true },
          { uid: true }
        )) {
          if (!message.source) {
            continue;
          }

          messages.push({
            mailbox,
            uidValidity,
            uid: message.uid,
            envelope: message.envelope,
            flags: message.flags,
            internalDate: message.internalDate,
            source: message.source
          });
        }

        return messages;
      } finally {
        lock.release();
      }
    },

    async markSeen(mailbox: string, uid: number): Promise<void> {
      await ensureConnected();
      const lock = await client.getMailboxLock(mailbox, {
        readOnly: false,
        description: "Mark processed Yahoo mail as seen"
      });

      try {
        await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
      } finally {
        lock.release();
      }
    },

    async close(): Promise<void> {
      if (connected) {
        await client.logout();
        connected = false;
      }
    }
  };
}
