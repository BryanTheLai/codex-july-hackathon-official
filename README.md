---
project: KaunterAI
artifact: "Repository entrypoint"
audience:
  - "Hackathon judges and mentors"
  - "Product designers and engineers"
  - "Coding agents rebuilding the product"
purpose: "Explain the current product, its evidence boundary, and the canonical read order."
status: "Local synthetic demo and server persistence wedge implemented and verified; the remaining MVP sequence is Markdown SOP import, LLM proposal, behavioral replay, activation, and rollback."
event: "Codex Community Hackathon Kuala Lumpur 2026"
demo_day: "2026-07-18"
location: "Sunway University, Kuala Lumpur"
last_updated: "2026-07-14"
last_verified: "2026-07-14"
verification_method:
  - "npm run verify"
  - "Playwright browser matrix at 1440px, 390px, and 320px"
  - "Axe accessibility scans, viewport containment, and mobile target checks"
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

Current code: three-table Supabase wedge, Telegram text and inbound voice-metadata, shared Chat and
five-seed Eval runner, immutable server Eval evidence. Verification uses mocked providers. Live
Supabase, Telegram, LLM, Vercel, STT, TTS, LLM proposer, candidate activation, and rollback proof
remain.

- MVP order, deferred list, capability matrix, activation/rollback: `PROJECT.md` section 16
- Product loop, causal boundaries, local acceptance: `PROJECT.md` sections 2, 3, and 14
- Post-MVP backlog (read-only MCP first): `PROJECT.md` section 16
- Channel, hosting research, Meta boundary: `PROJECT.md` section 17

Deterministic Analyze failures is the invalid-output fallback, not the target LLM proposer.

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

### Telegram

Telegram requires the fixed Supabase workspace because inbound events and messages are persisted
before the webhook returns. Apply `supabase/migrations/001_demo_platform.sql`, set the Supabase and
Telegram values in `.env`, then run:

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

Keep `LIVE_TELEGRAM_ENABLED=false` while testing inbound messages. Set it to `true` only when the
visitor-approved outbound send path is ready to contact the bot chat.

If a process crashes while a delivery is `sending`, fail closed. Do not auto-resend. Inspect the
delivery record before any manual recovery. Telegram Bot API has no request idempotency key that
makes automatic resend safe.

## Deploy topology

Selected hackathon topology: one Vercel project for the Vite SPA plus request-driven TypeScript
API functions, with Supabase for Postgres and Storage. Distilled from the former demo-day and
production-roadmap docs (2026-07-14).

```text
GitHub repository
  -> one Vercel project
       -> Vite build in dist/ as static assets
       -> SPA rewrite sends non-API routes to index.html
       -> TypeScript API for one fixed workspace
            -> Supabase Postgres + Storage
            -> text / STT / TTS endpoints
            -> Telegram Bot API
```

Runtime rules: Express remains the local harness; thin Vercel adapters wrap the same services;
deployed Telegram uses webhooks; every provider call is bounded; agent and Eval work starts from a
browser action and finishes in one request; no permanent worker or durable job queue in the POC;
do not proxy audio through a Vercel Function response.

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
| Vercel Hobby | $0 only for qualifying non-commercial personal use | Selected technical topology |
| Vercel Pro | $20 per developer each month before usage overages | Use if Hobby eligibility is unclear |
| Railway Hobby | $5 monthly minimum including $5 of usage | Fallback if porting or Vercel policy blocks |
| Render Free | $0 | Avoid for a live webhook demo (sleeps) |
| Render Starter | $7 per month | Valid, but no clear advantage over Railway here |

Hobby eligibility for a prize-bearing hackathon deployment is not proven. Confirm with Vercel or
use Pro / Railway. Stay on Vercel while the demo uses webhooks and bounded requests. Switch to
Railway when the product needs an always-on consumer or persistent polling.

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

1. In Chat Control, open Nurul Aisyah, send a staff reply, then choose Create Eval case.
2. In Evaluation Lab, import the conversation, run the case, then choose Analyze failures and
   Start analysis.
3. Open the linked Dream correction, inspect the old and proposed text, then approve or reject it.
4. Choose Test Changes. The dock verifies the saved playbook text without changing Eval scores.

Analyze failures reads the latest committed failed train verdicts and creates unique pending Dream
corrections. It does not rerun the agent or judge, alter Eval evidence, or change candidate output.

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
route, and regression suite, TypeScript, the production build, and 18 passing browser executions.
The browser matrix exercises all three routes at 1440px, 390px, and 320px, including Axe scans,
overflow checks, 44px mobile targets, route handoffs, reset behavior, the Telegram text refresh
and exact-send flow, and the full Chat to Eval to Dream flow with browser API fixtures.

## What this repository proves

The repository proves the local synthetic workflow, the same-origin judge contract, deterministic
simulated-judge behavior, fixed-workspace CAS and reset behavior, the three-table PostgreSQL
migration, mocked Telegram inbound and exact outbound text transport, and the responsive frontend
contract. It does not prove a live Supabase project, live Telegram provider compatibility, live
OpenAI quality or availability, authentication, clinical integration, a deployed shared database,
production capacity, or real patient contact. `PROJECT.md` section 16 separates approved POC work
from post-POC gaps. `PROJECT.md` section 17 holds channel and Meta research.
