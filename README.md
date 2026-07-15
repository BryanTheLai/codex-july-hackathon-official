---
project: KaunterAI
artifact: "Repository entrypoint"
audience:
  - "Hackathon judges and mentors"
  - "Product designers and engineers"
  - "Coding agents rebuilding the product"
purpose: "Explain the current product, its evidence boundary, and the canonical read order."
status: "The Dream-to-versioned-playbook release loop is implemented. The fixed workspace is deployed with live Supabase persistence, a protected Telegram webhook, live inbound text, and live Whisper voice transcription. Authentication, outbound delivery proof, and agent/Eval provider-quality proof remain."
event: "Codex Community Hackathon Kuala Lumpur 2026"
demo_day: "2026-07-18"
location: "Sunway University, Kuala Lumpur"
last_updated: "2026-07-15"
last_verified: "2026-07-15"
verification_method:
  - "npm run lint, npm run typecheck, npm test, and npm run build"
  - "Mocked Telegram, OpenAI speech, Eval, and release-workflow tests"
  - "427 automated tests, 18 Playwright executions with three intentional skips, DigitalOcean health/readiness checks, and live protected Telegram inbound text and voice verification"
  - "Live agent/Eval runs, translation, TTS, and outbound delivery remain pending"
sources_consulted:
  - "PROJECT.md"
  - "SOUL.md"
  - "https://codexhackathon.my/"
  - "https://openai.devpost.com/rules"
update_protocol: "Update this file when the product pitch, evidence boundary, canonical documents, or event framing changes."
related_docs:
  - "SOUL.md"
  - "PROJECT.md"
---

# KaunterAI

KaunterAI is a synthetic multilingual clinic front-desk workspace where staff handle
conversations, evaluate agent replies, and approve playbook changes.

It targets operational friction in Malaysian clinic work: multilingual messages, repeated
front-desk coordination, unclear handoffs, and unsafe automation. The product keeps the working
conversation, evaluation evidence, and next human decision visible together.

## Hackathon fit

The [Codex Community Hackathon Kuala Lumpur 2026](https://codexhackathon.my/) asks teams to build
practical Malaysia-first products. KaunterAI sits in the Health and Care track:

- **Usefulness:** staff move from a patient conversation to a concrete action or evaluation.
- **Responsible AI:** synthetic output never becomes approved behavior without a human decision.
- **Technical execution:** one state model connects conversation handling, deterministic
  candidate generation, server-side semantic judging, and playbook review.
- **Continuation potential:** the same supervision model can later sit behind a real clinic
  channel, model gateway, and shared data store.

Demo day is 18 July 2026 at Sunway University, Kuala Lumpur. Organizers allow building during
the week before demo day.

### OpenAI Build Week (Global)

Separate from the Malaysia demo day. Rules: https://openai.devpost.com/rules

- Submission Period (PDT): 2026-07-13 09:00 to 2026-07-21 17:00
  (MYT: 2026-07-14 00:00 to 2026-07-22 08:00)
- Category fit: Work and Productivity
- Required package, not limited to: working project; README with Codex / GPT-5.6 collaboration
  story; demo video under 3 minutes; accessible repo URL; `/feedback` Codex Session ID from the
  thread where the majority of core functionality was built
- Cursor chat IDs are not `/feedback` Session IDs. Capture the Session ID from a real Codex thread.
- Existing projects may be extended during the Submission Period. Document prior vs new work if
  judges ask.
- Malaysia demo day and Global Devpost are separate packages.

## Read order

Only three durable docs:

1. `SOUL.md` — taste and anti-generic UI
2. `PROJECT.md` — behavior, acceptance, MVP order (section 16), channel/Meta research (section 17)
3. This file — pitch, runbook, deploy

Canonical contract hierarchy: `PROJECT.md` section "Read order and contract hierarchy". Rejected
architecture options and the former demo-day / production-roadmap workbooks remain recoverable from
git history only.

## Approved hackathon POC

Current code: a live three-table Supabase workspace, protected Telegram text plus automatic inbound
voice download, OGG/Opus-to-WebM conversion, direct-OpenAI transcription and English gloss, shared
Chat and Eval runner, immutable server Eval evidence, and a server-authoritative Dream release loop.
Markdown import, an accepted correction, or a Dream draft creates an inactive whole-playbook
version. A configured LLM proposes one exact, reviewable diff; affected train cases must pass
before a full train-plus-holdout replay can mark the version Ready. Human activation updates the
bundle used by Chat, and one click restores the prior SOP as a new immutable version. Verification
uses mocked providers. Live Supabase, protected Telegram text, and one live English voice
transcription are verified; live agent/Eval quality, translation, TTS, outbound voice, and
authentication remain pending.

- MVP order, deferred list, capability matrix, activation/rollback: `PROJECT.md` section 16
- Product loop, causal boundaries, local acceptance: `PROJECT.md` sections 2, 3, and 14
- Post-MVP backlog and the DigitalOcean inference-switch TODO: `PROJECT.md` section 16
- Channel, hosting research, Meta boundary: `PROJECT.md` section 17

The deterministic Analyze failures path remains a no-provider fallback. With `LLM_API_KEY`
configured, Analyze failures uses the server-side structured-output proposer instead.

Routes: `/` Chat Control, `/eval` Evaluation Lab, `/dream` Dream playbook review.

## Operational value

KaunterAI is designed to reduce:

- dropped or unresolved patient conversations;
- repeated receptionist back-and-forth;
- multilingual handling overhead;
- unclear escalation context;
- unreviewed agent behavior changes.

## Responsible boundary

Every patient, message, playbook, and candidate response is synthetic. Automated tests use a
simulated judge. A configured `LLM_*` provider serves explicitly requested agent and Eval runs;
committed live Eval judge artifacts carry `simulated: false`. The automated gate uses provider
fixtures and does not make a live LLM, patient, or clinic-system call. Full language, safety,
grounding, and tool boundaries: `PROJECT.md` section 2.

## Run locally

Requirements: Node.js 22.12 or newer and npm.

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`.

To exercise the production server path locally, build before starting:

```bash
npm run build
npm start
```

`npm start` serves the existing `dist/` output and does not build it.

### OpenAI or LiteLLM

`LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL` configure the shared agent and judge provider.
Leave `LLM_BASE_URL` empty to use `https://api.openai.com/v1`. Otherwise set the provider's exact
OpenAI-compatible base URL. For LiteLLM Responses, its
[official OpenAI SDK example](https://docs.litellm.ai/docs/response_api#litellm-proxy-with-openai-sdk)
uses the proxy root, such as `http://127.0.0.1:4000`. Set `LLM_API_MODE=responses` or
`LLM_API_MODE=chat_completions`; the value applies to both the agent and judge. `JUDGE_MODEL` is
optional and inherits `LLM_MODEL` when empty. Any non-empty provider configuration is validated
during server startup, even while `LIVE_AGENT_ENABLED=false`. Keep the live switch off until one
provider request succeeds. Full variable list: `.env.example`.

Inbound Telegram voice additionally uses the same direct OpenAI credentials with `whisper-1`: its
verbose transcription produces the original transcript and detected language, and the translation
endpoint produces an English staff gloss for non-English speech. The host must provide `ffmpeg`
with the Opus encoder; the adapter stores no audio file after the request completes.

### Telegram

Telegram requires the fixed Supabase workspace because inbound events and messages are persisted
before the webhook returns. Apply **every** file in `supabase/migrations/` in ascending filename
order (the later two files add the required outbound-voice columns and private storage bucket),
set the Supabase and Telegram values in `.env`, then run:

```bash
npm run bootstrap:demo
npm run dev
```

Generate `TELEGRAM_WEBHOOK_SECRET` with `openssl rand -hex 32`. Set
`TELEGRAM_BOT_TOKEN` to the current token from
[@BotFather](https://core.telegram.org/bots/features#botfather). If a token enters chat, logs, or
source control, use BotFather `/token` to replace it before continuing.

After the app has a public HTTPS URL, register the webhook:

```bash
set -a
source .env
set +a
curl --fail --silent --show-error \
  --request POST \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=https://YOUR_PUBLIC_HOST/api/telegram/webhook" \
  --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}"
curl --fail --silent --show-error \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

Telegram documents `secret_token` and the matching
`X-Telegram-Bot-Api-Secret-Token` header under
[setWebhook](https://core.telegram.org/bots/api#setwebhook).

Keep `LIVE_TELEGRAM_ENABLED=false` for a local or separate test bot. The deployed controlled demo
currently uses `true`; staff must still explicitly approve every outbound send. Do not test a real
outbound reply until the target chat and exact message are approved.

If a process crashes while a delivery is `sending`, fail closed. Do not auto-resend. Inspect the
delivery record before any manual recovery. Telegram Bot API has no request idempotency key that
makes automatic resend safe.

## Deploy topology

Selected hackathon topology: one DigitalOcean App Platform Docker web service, with Supabase for
Postgres and Storage. The image runs the Express server, serves the built Vite SPA, and includes
`ffmpeg` for inbound and outbound Telegram voice conversion.

```text
GitHub repository
  -> one DigitalOcean App Platform web service
       -> Docker build: Node 22 + ffmpeg
       -> Express serves Vite build from dist/
       -> one fixed-workspace TypeScript API
            -> Supabase Postgres + Storage
            -> text / STT / TTS endpoints
            -> Telegram Bot API
```

Runtime rules: the container listens on `0.0.0.0:8080`; App Platform checks `/healthz` and
`/readyz`; deployed Telegram uses webhooks; every provider call is bounded; agent and Eval work
starts from a browser action and finishes in one request; no permanent worker or durable job queue
exists in the POC.

`PORT=5173` is only for local development. Do not add it to DigitalOcean: leave `PORT` unset so
the Docker image's `PORT=8080` is used, or explicitly set it to `8080`.

### POC access

1. The app opens directly into one fixed demo workspace.
2. There is no login, signup, logout, OTP, account, role, tenant picker, or browser Supabase
   session.
3. Every Telegram `chat_id` received by the bot is accepted.
4. The Telegram webhook still requires `TELEGRAM_WEBHOOK_SECRET`.
5. The browser never receives provider secrets or the Supabase service-role key.

### Hosting comparison

| Host | Cost floor | Decision |
|---|---:|---|
| DigitalOcean App Platform | $5 monthly for one 512 MiB shared service | Selected: managed HTTPS, GitHub deploys, health checks, logs, and `ffmpeg` in Docker |
| DigitalOcean Droplet | $4 monthly starting price | Not selected: requires OS, Docker, TLS, firewall, process, and log management |

The service deploys from the root `Dockerfile`. Add all provider values only as encrypted runtime
variables in App Platform; never bake `.env` into the image or expose a server secret through a
`VITE_` variable. Use the generated HTTPS domain for the Telegram webhook only after `/healthz`
and `/readyz` succeed.

### Health checks and operator alerts

[`app.yaml`](app.yaml) is the non-secret App Platform spec for this repository and branch. It
configures the app-level failed-deployment alert, an 80% RAM alert over five minutes, and a
restart-count alert over five minutes. It also keeps the routes deliberately separate:
`/readyz` controls whether App Platform sends traffic to the service, while `/healthz` is the
liveness probe that may restart a stuck process.

After the app exists, open **Apps → kaunter-ai-demo → Settings → Alert Policies → Edit** and
confirm the email recipient. The spec is versioned, but DigitalOcean owns notification recipients
and any alert policy created in the dashboard. Do not upload a newly written app spec over an
existing app without first downloading its current spec, because an App Platform update replaces
the full configuration, including encrypted environment variables.

## Code architecture and backend seams

```text
route component
  -> typed Zustand action
  -> pure domain mutation
  -> injected state repository

evaluation action
  -> bounded judge request schema
  -> injected judge client
  -> same-origin server endpoint
  -> provider adapter
```

- `src/contracts/` owns runtime-validated transport and persistence schemas plus shared enum
  values.
- `src/domain/` owns pure business rules, booking notification policy, evaluation metrics,
  persistence migration, the five-case server seed, and synthetic-only reset behavior.
- `src/store/` owns UI orchestration. Store slices depend on repositories instead of browser
  storage directly.
- `src/services/` owns async transport clients and typed client errors.
- `server/` owns HTTP limits, fixed-workspace load and compare-and-swap saves, Supabase access,
  request validation, provider configuration, timeouts, and response mapping.

Authentication and normalized domain tables remain complete-target work (`PROJECT.md` section 16).

## Current synthetic walkthrough

1. In Chat Control, open a conversation, generate and approve a staff draft, then create an Eval case.
2. In Evaluation Lab, run the case and select Analyze failures. With an LLM configured, it creates
   one pending exact SOP diff from the latest failed train evidence.
3. Open the linked Dream correction and accept it. This creates an inactive candidate; it does not
   change Chat or prior Eval evidence.
4. Replay affected cases, then the full train and holdout suite. A complete pass makes the candidate
   Ready.
5. Activate it, generate the next Chat draft against the new SOP, then use Roll back to restore the
   prior SOP as another immutable version.

The proposer and activation path never auto-activate, rerun a case, or change existing evidence.

## Verification

Run the complete local gate:

```bash
npm run verify
```

During one module, run the narrow test first:

```bash
npm test -- tests/domain/telegram.test.ts
npx oxlint --deny-warnings src/domain/telegram.ts tests/domain/telegram.test.ts
npx playwright test e2e/chat.spec.ts --project=desktop-1440
```

Use the matching `tests/<layer>/` file for contract, domain, server, store, service, or route
changes. TypeScript project validation is repository-wide through `npm run typecheck`. Run
`npm run verify` before closing the module.

The verified gate covers lint, the complete automated contract, domain, server, store, component,
route, and regression suite, TypeScript, the production build, and 18 browser executions when the
Playwright browser binaries are installed.
The browser matrix exercises all three routes at 1440px, 390px, and 320px, including Axe scans,
overflow checks, 44px mobile targets, route handoffs, reset behavior, the Telegram text refresh
and exact-send flow, and the full Chat to Eval to Dream flow with browser API fixtures.

## What this repository proves

The repository proves the local synthetic workflow, the same-origin judge contract, deterministic
simulated-judge behavior, fixed-workspace CAS and reset behavior, the three-table PostgreSQL
migration, responsive frontend contract, deployed DigitalOcean health/readiness, live Supabase
persistence, protected Telegram inbound text, and one live English Whisper transcription. It does
not prove live agent/Eval quality or availability, translation, TTS, outbound Telegram delivery,
authentication, clinical integration, production capacity, or real-patient operation.
`PROJECT.md` section 16 separates verified behavior, deferred TODOs, and post-POC gaps.
