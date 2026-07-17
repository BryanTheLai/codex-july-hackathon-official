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
- optional Google Calendar OAuth, availability, and event synchronization
- durable Telegram/calendar outbox processing
- immutable Eval suites and run evidence
- exact Knowledge proposals with human decision
- candidate validation, activation, and rollback
- Supabase-owned versioned demo seed and guarded reset

Not claimed: equipment diagnosis, unsupported quotes, production capacity,
multi-tenant authentication, or automatic SOP activation.

## Local development

Requirements: Node.js 22.12+ and npm.

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`.

Production-style local start:

```bash
npm run build
npm start
```

`npm start` serves the existing `dist/`; it does not build first.

## Provider configuration

Text generation and judging use the OpenAI SDK against either OpenAI or an
OpenAI-compatible gateway.

```dotenv
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=gpt-5.6-luna
LLM_API_MODE=responses
JUDGE_MODEL=
LIVE_AGENT_ENABLED=false
```

An empty `LLM_BASE_URL` uses `https://api.openai.com/v1`. A gateway may require
its own model alias; deployment values override the checked-in documented
Luna default. `JUDGE_MODEL` inherits `LLM_MODEL` when empty.

Voice providers are selected independently:

- OpenAI fallback: `whisper-1` and `gpt-4o-mini-tts`
- ElevenLabs: Scribe v2 and Eleven v3

The host needs `ffmpeg` with Opus support.

## Supabase setup

Supabase is the runtime source of truth. The aircon demo seed depends on
migration `supabase/migrations/20260718010000_demo_seed_templates.sql`.

### First-time apply (or after missing `demo_seed_templates`)

Run these steps in order. Do not skip.

1. Stop the app/worker and disable live Telegram.
2. Apply `supabase/migrations/20260718010000_demo_seed_templates.sql`.
3. Run `supabase/seed.sql`.
4. Run `npm run demo:seed`.
5. Run the guarded reset (next section).
6. Restart the app.

Copy-paste form:

```bash
# Stop the app/worker and set LIVE_TELEGRAM_ENABLED=false first.

# Apply:
# supabase/migrations/20260718010000_demo_seed_templates.sql

# Then:
# supabase/seed.sql
npm run demo:seed

KAUNTER_ALLOW_DEMO_RESET=1 \
LIVE_TELEGRAM_ENABLED=false \
npm run demo:reset -- \
  --workspace demo \
  --seed msme-aircon-v1 \
  --confirm RESET_DEMO

# Restart the app.
```

Optional local bootstrap after the template is compiled:

```bash
npm run bootstrap:demo
```

The canonical template is `msme-aircon-v1`.

The browser can boot from a local fallback for tests, but a successful server
load replaces demo conversations, SOPs, corrections, datasets, and release
state with the Supabase aggregate.

### Guarded reset

Reset is destructive to the fixed `demo` workspace. Stop the app and live
Telegram processing first. Migration `20260718010000_demo_seed_templates.sql`
and a compiled seed (`npm run demo:seed`) must already exist.

```bash
KAUNTER_ALLOW_DEMO_RESET=1 \
LIVE_TELEGRAM_ENABLED=false \
npm run demo:reset -- \
  --workspace demo \
  --seed msme-aircon-v1 \
  --confirm RESET_DEMO
```

The reset CLI removes mapped Google events, clears pending work, preserves the
Google OAuth connection and sent Telegram audit, and installs the compiled
aircon template.

## Telegram

Required values:

```dotenv
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
LIVE_TELEGRAM_ENABLED=false
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
KAUNTER_WORKSPACE_ID=demo
```

Generate the webhook secret with `openssl rand -hex 32`. Register a public HTTPS
webhook only after `/healthz` and `/readyz` pass. Keep live switches off for a
test bot unless autonomous replies are intentional.

Telegram delivery fails closed when a send outcome is unknown. Do not blindly
retry a `sending` delivery because Telegram has no request idempotency key.

## Optional Google Calendar

Enable with:

```dotenv
GOOGLE_CALENDAR_ENABLED=true
GOOGLE_CALENDAR_ADMIN_TOKEN=
GOOGLE_CALENDAR_CLIENT_ID=
GOOGLE_CALENDAR_CLIENT_SECRET=
GOOGLE_CALENDAR_REDIRECT_URI=
GOOGLE_CALENDAR_ID=primary
GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY=
GOOGLE_CALENDAR_TIME_ZONE=Asia/Kuala_Lumpur
```

One admin connects through the server OAuth endpoints. Refresh tokens are
AES-256-GCM encrypted before Supabase storage. Live booking requires connected
calendar availability; non-live demos can use the deterministic schedule.

See `docs/calendar-outbox.md`.

## Architecture

```text
React routes
  -> typed Zustand actions
  -> pure domain rules
  -> same-origin Express API
  -> validated Supabase workspace aggregate
       -> OpenAI-compatible agent/judge
       -> Telegram
       -> Google Calendar
       -> ElevenLabs/OpenAI voice
```

Key libraries:

- React 19, React Router, Zustand
- Zod
- CodeMirror 6
- Radix UI
- TanStack Table and Recharts
- Express
- OpenAI SDK
- Supabase JS
- Google APIs
- Vitest, Testing Library, Playwright, Axe

Key relationships and API boundaries are documented in `PROJECT.md`.

## Candidate release flow

1. Run a failed train Eval case until the failure is committed.
2. `Analyze failures` becomes available only after that committed train failure;
   it proposes one exact SOP replacement.
3. Accept or reject pending line items.
4. The accepted text becomes an inactive whole-playbook candidate.
5. `Validate candidate` runs affected train cases, then the complete train and
   holdout suite.
6. A full pass enables `Activate`; until then the control reads `Validate first`.
7. Activation makes the previous active version available to `Roll back`.

Schedule create is conversation-owned: pick `Book for` an existing customer,
confirm name/channel/contact in the dialog, and enter a service address.
Calendar location prefers that address over `CALENDAR_LOCATION`.

Approved editor lines use gutter-number color only. Proposal cards disappear
after decisions, and all correction colors disappear after activation.

## Verification

```bash
npm run verify
npm run test:e2e
```

The verification gate covers lint, TypeScript, unit/integration tests, the
production build, and browser behavior. Live provider quality, Telegram
delivery, Google OAuth/event CRUD, and destructive reset still require
owner-controlled smoke tests with deployment credentials.

## Deployment

The checked-in `app.yaml` and `Dockerfile` target one DigitalOcean App Platform
web service backed by Supabase. The server listens on the platform `PORT`,
serves the Vite build, and exposes `/healthz` and `/readyz`.

Never commit `.env`, provider keys, Telegram tokens, Google credentials, or the
Supabase service-role key. Never expose server secrets through `VITE_*`.
