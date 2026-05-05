# Yahoo Mail Forwarder

TypeScript background worker for forwarding incoming Yahoo Mail.

The runtime polls Yahoo IMAP for unseen mail, parses and stores an idempotency row in SQLite, forwards every non-duplicate message to `FORWARD_TO_ADDRESS` over Yahoo SMTP, records the outbound action, and only then marks the inbound message seen. SMTP forwards include a readable text summary plus the original raw email attached as a `.eml` file. Yahoo SMTP rejected at least one real forwarded message when the attachment used `message/rfc822`, so the worker sends the `.eml` attachment as `application/octet-stream`. Original reply addresses are included in the summary body instead of the outbound `Reply-To` header because Yahoo rejected the live forwarded message when the header was set to the original sender.

## Setup

```bash
pnpm install
cp .env.example .env
```

Fill in `YAHOO_EMAIL`, `YAHOO_APP_PASSWORD`, and `FORWARD_TO_ADDRESS`. Use a Yahoo app password, not the account password. `FORWARD_TO_ADDRESS` accepts one address or a comma-separated list, and every destination must be different from `YAHOO_EMAIL`.

## Commands

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm worker:once
pnpm dev
```

## Processing Model

- Every unseen, non-duplicate message is forwarded.
- Duplicate detection uses either the RFC Message-ID or the Yahoo mailbox UID tuple.
- Messages are marked seen only after SMTP forwarding and outbound action recording both succeed.
- Forwarding failures are recorded in `errors`, the email status is set to `failed`, and the message is left unseen for retry.
- Existing SQLite databases may still contain old tables from earlier versions; the current schema only creates `emails`, `threads`, `outbound_actions`, and `errors`.

## Manual Smoke

1. Set `.env` with Yahoo credentials and `FORWARD_TO_ADDRESS`.
2. Send a test email to the Yahoo inbox.
3. Run `pnpm worker:once`.
4. Inspect `data/mail-forwarder.db` for `emails`, `outbound_actions`, and `errors` rows.
