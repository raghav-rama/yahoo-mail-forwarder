# Yahoo Mail Forwarding Agent

TypeScript background worker for Yahoo Mail triage and draft generation.

The v1 runtime is intentionally draft-only: it polls Yahoo IMAP for unseen mail, parses and sanitizes the message, stores idempotency state in SQLite, asks OpenAI for a structured routing decision, optionally generates a structured draft, stores that draft for review, and only then marks the inbound message seen.

## Setup

```bash
pnpm install
cp .env.example .env
```

Fill in `YAHOO_EMAIL`, `YAHOO_APP_PASSWORD`, and `OPENAI_API_KEY`. Use a Yahoo app password, not the account password.

## Commands

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm worker:once
pnpm dev
```

## Safety Model

- No automatic sends in v1. `AUTO_SEND=false` is the default and direct send logic is not wired into the worker.
- The worker skips replies to self, list mail, auto responses, and no-reply senders.
- Financial, legal, credential, and security-sensitive requests route to human review.
- Only sanitized text, normalized headers, and attachment metadata go to the model. Raw MIME and attachment bytes stay out of prompts and SQLite.
- Drafts are stored locally with `pending_review` status. If `DRAFT_REVIEW_ADDRESS` is set, a proposed draft can also be forwarded for review.

## Manual Smoke

1. Set `.env` with Yahoo and OpenAI credentials.
2. Keep `AUTO_SEND=false`.
3. Send a test email to the Yahoo inbox.
4. Run `pnpm worker:once`.
5. Inspect `data/mail-agent.db` for `emails`, `agent_decisions`, and `drafts` rows.
