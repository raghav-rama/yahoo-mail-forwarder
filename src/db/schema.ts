export const schemaSql = `
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mailbox TEXT NOT NULL,
  uid_validity TEXT NOT NULL,
  uid INTEGER NOT NULL,
  message_id TEXT,
  from_address TEXT,
  from_name TEXT,
  subject TEXT NOT NULL DEFAULT '',
  received_at TEXT,
  body_hash TEXT NOT NULL,
  body_preview TEXT NOT NULL,
  status TEXT NOT NULL,
  thread_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(mailbox, uid_validity, uid),
  UNIQUE(message_id)
);

CREATE TABLE IF NOT EXISTS threads (
  thread_key TEXT PRIMARY KEY,
  recent_summary TEXT NOT NULL DEFAULT '',
  reply_count INTEGER NOT NULL DEFAULT 0,
  last_message_at TEXT,
  last_outbound_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS outbound_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id INTEGER REFERENCES emails(id),
  action_type TEXT NOT NULL,
  recipient TEXT,
  subject TEXT,
  status TEXT NOT NULL,
  run_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id INTEGER REFERENCES emails(id),
  stage TEXT NOT NULL,
  message TEXT NOT NULL,
  retryable INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status);
CREATE INDEX IF NOT EXISTS idx_errors_email_id ON errors(email_id);
`;
