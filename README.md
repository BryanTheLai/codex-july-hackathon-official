# KaunterAI

KaunterAI is a Malaysia-first autonomous service desk for residential aircon
operators. It handles multilingual Telegram requests and service bookings, then
turns customer complaints into evaluated, human-approved SOP improvements.

The hackathon loop is:

```text
Chat request -> booking -> customer correction -> Eval failure
-> exact SOP diff -> validate -> activate -> rollback
```

Routes:

- `/` — Chat Control
- `/knowledge` — SOP review and release
- `/eval` — Evaluation Lab

Read `PROJECT.md` for the behavior/data contract and `SOUL.md` for visual
direction.

## What works

- Telegram text and voice ingress
- Malay and English grounded replies
- RM99 general service and RM160 chemical wash rate card
- conversation-owned booking with explicit customer, contact, and service address
- autonomous availability, booking, reschedule, and cancellation tools
- optional Google Calendar OAuth and write-only event synchronization
- fixed Malaysian customer and scheduling timezone (`Asia/Kuala_Lumpur`, MYT)
- durable Telegram/calendar outbox processing
- immutable Eval suites and run evidence
- exact Knowledge proposals with human decision
- candidate validation, activation, and rollback
- Supabase-owned versioned demo seed and destructive factory reset

Not claimed: equipment diagnosis, unsupported quotes, production capacity,
multi-tenant authentication, or automatic SOP activation.

## Quick start

Requirements:

- Node.js 22.12 or newer
- npm
- `ffmpeg` only when testing voice messages

```bash
git clone https://github.com/BryanTheLai/codex-july-hackathon-official.git
cd codex-july-hackathon-official
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`.

The app opens without provider credentials. Live AI, Telegram, Supabase
persistence, Google Calendar, and factory reset remain disabled until configured.

## Configure the full demo

### 1. Configure Supabase

Create a Supabase project, then apply every SQL file in `supabase/migrations/`
in filename order. Apply `supabase/seed.sql` last.

Set these values in `.env`:

```dotenv
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
KAUNTER_WORKSPACE_ID=demo
```

Compile the canonical seed and create the demo workspace:

```bash
npm run demo:seed
npm run bootstrap:demo
```

Restart `npm run dev`. The server-backed workspace now replaces the local
fallback state.

### 2. Enable live AI

Set an OpenAI or OpenAI-compatible provider in `.env`:

```dotenv
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=gpt-5.6-luna
LLM_API_MODE=responses
JUDGE_MODEL=
LIVE_AGENT_ENABLED=true
```

Leave `LLM_BASE_URL` empty for `https://api.openai.com/v1`.
`JUDGE_MODEL` falls back to `LLM_MODEL`.

### 3. Enable Telegram

```dotenv
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
LIVE_TELEGRAM_ENABLED=true
```

Generate the secret with `openssl rand -hex 32`. Deploy the app behind public
HTTPS, confirm `/healthz` and `/readyz`, then point the Telegram webhook to
`/api/telegram/webhook`.

Keep `LIVE_TELEGRAM_ENABLED=false` until you want the bot to send real replies.

### 4. Optional providers

Google Calendar, OpenAI voice, and ElevenLabs settings are documented directly
in `.env.example`. Calendar-specific behavior is in `docs/calendar-outbox.md`.

Never commit `.env`, API keys, bot tokens, Google credentials, or the Supabase
service-role key.

## Run commands

Development:

```bash
npm run dev
```

Production-style local run:

```bash
npm run build
npm start
```

`npm start` serves the existing `dist/`; it does not build first.

Full verification:

```bash
npm run verify
```

This runs lint, unit and integration tests, TypeScript checks, the production
build, and Playwright end-to-end tests. Individual commands are available in
`package.json`.

## Demo walkthrough

1. Open Chat Control and complete the seeded RM99 booking.
2. Open the poor-cooling and musty-smell complaint.
3. Mark the incorrect RM99 answer as wrong.
4. Open the generated Eval case and run it.
5. Analyze the failure and review the exact SOP diff in Knowledge.
6. Accept, validate, and activate the candidate.
7. Ask the same question again and confirm the RM160 answer.

The full speaking flow is in `docs/kaunterai-youtube-demo-script.md`.

## Reset the demo

The top-right **Reset** action deletes all activity in the fixed `demo`
workspace and restores `msme-aircon-v1`. It preserves credentials but removes
conversations, Eval results, Knowledge changes, delivery records, generated
voice files, and tracked Calendar events.

For the CLI path, stop the app and keep live Telegram disabled:

```bash
KAUNTER_ALLOW_DEMO_RESET=1 \
LIVE_TELEGRAM_ENABLED=false \
npm run demo:reset -- \
  --workspace demo \
  --seed msme-aircon-v1 \
  --confirm RESET_DEMO
```

Per-chat reset is different: it restores only one synthetic conversation.

## Architecture and deployment

The app is a React client backed by a same-origin Express API and a validated
Supabase workspace. Optional integrations provide AI, Telegram, voice, and
Google Calendar.

`Dockerfile` and `app.yaml` target DigitalOcean App Platform. The production
server listens on `PORT`, serves `dist/`, and exposes `/healthz` and `/readyz`.

See `PROJECT.md` for behavior, data contracts, reset operations, and API
boundaries.

## License

KaunterAI is available under the [MIT License](LICENSE).
