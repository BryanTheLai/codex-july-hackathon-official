# KaunterAI Product Contract

Last updated: 2026-07-18

KaunterAI is a Malaysia-first autonomous service desk for a small residential
aircon operator. It turns Telegram requests into grounded replies and confirmed
service visits, then turns customer complaints into evaluated, human-approved
SOP improvements.

This document is the observable product contract. `SOUL.md` governs visual
taste. Runtime schemas and tests govern details when prose is stale.

## 1. MVP outcome

The demo must prove this loop without a hidden hand-wave:

```text
customer request
  -> grounded multilingual reply
  -> service visit booking
  -> customer says the agent was wrong
  -> Eval case
  -> failed criterion
  -> exact SOP proposal
  -> human accepts or rejects
  -> candidate validation
  -> human activation
  -> reversible immutable release
```

There are three routes:

- `/` — Chat Control
- `/knowledge` — SOP review and release
- `/eval` — Evaluation Lab

No dashboard, settings area, authentication flow, or fourth product route is in
the hackathon MVP.

## 2. Product boundary

### Works now

- Telegram text and voice ingress into one fixed Supabase workspace
- Malay and English customer replies with an English operator view
- fixed service scope and rates: RM99 general service, RM160 chemical wash
- chemical-wash recommendation for poor cooling plus musty smell
- deterministic demo availability and optional Google Calendar availability
- autonomous create, reschedule, and cancel booking tools
- durable Telegram and calendar outbox behavior
- customer-feedback capture into Eval
- immutable Eval suites and run evidence
- exact Knowledge proposals, candidate validation, activation, and rollback
- database-owned versioned demo seed and transactional reset

### Explicitly not claimed

- fault diagnosis, repair outcome, parts, gas, or unsupported price quotes
- multi-tenant authentication or role management
- production capacity, broad model quality, or guaranteed provider uptime
- phone-call automation
- automatic SOP activation

Internal compatibility names such as `patient`, `appointment`, and legacy Eval
case types remain in versioned schemas. They are not user-facing product
language and must not leak into demo copy.

## 3. Source of truth

Supabase is authoritative whenever the workspace server is configured.

```text
demo_seed_templates.source_state
  -> npm run demo:seed
  -> demo_seed_templates.state
  -> reset_demo_workspace(...)
  -> demo_state.state
  -> GET /api/workspace/state
  -> browser projection
```

The browser repository is a cache and offline fallback. It must not overwrite
server conversations, Knowledge files, corrections, datasets, release
pointers, or Eval artifacts after a successful workspace load.

The canonical seed key is `msme-aircon-v1`. The seed contains:

- three demo conversations: booking, package complaint, resolved service
- three SOPs: rate card, booking, service selection
- one Eval dataset with three train and two holdout cases
- criterion-to-Knowledge links through `knowledgeFileIds`
- active Knowledge bundle version 1

## 4. Data relationships

The MVP intentionally stores one validated JSONB aggregate per workspace. IDs
are still explicit relationships:

```text
demo_state.workspace_id
  -> ServerDomainState

Conversation.booking
  -> Google calendar mapping by workspace + conversation
  -> Telegram/calendar delivery audit

EvalDataset.cases[].criterionIds
  -> EvalDataset.criteria[].id

EvalCriterion.knowledgeFileIds
  -> PlaybookFile.id

Correction.sourceCaseId
  -> EvalCase.id

Correction.fileId
  -> PlaybookFile.id

PlaybookHistory.candidateVersionId
  -> PlaybookHistory.versions[].id

PlaybookVersion.passingSuiteId
  -> EvalSuiteSnapshot.id

EvalRunArtifact.suiteId + caseId
  -> frozen suite and frozen case
```

Every transport and persisted aggregate is parsed with Zod. Compare-and-swap
workspace revisions reject stale writes.

## 5. Chat Control contract

The primary artifact is the selected customer conversation.

- queue, thread, and customer context stay visible together on desktop
- mobile renders one working pane at a time
- generated replies cite exact text from the active Knowledge bundle
- booking claims require a successful booking tool result
- unsupported scope or safety concerns use owner handoff
- customer feedback can create an Eval candidate exactly once
- all visible sends state whether Telegram delivery actually occurred

The demo calls confirmed work a “service visit,” not an appointment.

## 6. Evaluation Lab contract

The primary artifact is a raw Eval case and its evidence.

- a case cannot run without a human reference answer and at least one criterion
- sandbox generation never receives or requests autonomous tools
- generation never receives the expected answer or judge rubric
- judge evidence must be an exact span of the candidate response
- a suite freezes model, prompt, criteria, cases, and Knowledge hashes
- retries append immutable attempts
- train failures may propose Knowledge changes
- holdout failures never generate training proposals
- imported HITL cases inherit global criteria plus matching typed criteria

Seed criteria:

- fixed rate card → `file-aircon-rate-card`
- package selection → `file-aircon-service-selection`
- explicit confirmation → `file-aircon-booking`

## 7. Knowledge contract

The primary artifact is an editable Markdown SOP.

### Review states

- pending: show neutral text with red removed and green added indicators
- approved/rejected while a candidate exists: hide proposal cards and color
  only the affected editor line number
- activated or discarded: remove correction colors

Full-line editor background color is not a correction signal.

The right proposal pane exists only while the selected file has pending
proposals. Decided proposal history remains persisted but does not occupy the
working frame.

### Release states

```text
pending proposal
  -> human decision
  -> inactive candidate
  -> Validate candidate
       1. affected train cases
       2. complete train + holdout suite
  -> Ready candidate
  -> Activate
  -> prior active version becomes rollback target
```

Activation stays disabled until validation passes. Rollback stays disabled
until one activation creates a prior version. Disabled controls must explain
the gate in their accessible name or title.

“Check saved text” verifies exact accepted/rejected text locally. It is not an
Eval score. Its lower dock is draggable, keyboard-resizable, collapsible by
closing it, and scoped to the editor.

## 8. API boundary

Primary same-origin endpoints:

- `GET /healthz`, `GET /readyz`
- `GET /api/workspace/state`
- `POST /api/demo/reset`
- `POST /api/workspace/commands`
- `POST /api/agent/runs`
- `POST /api/eval/suites`
- `POST /api/eval/suites/:id/cases/:caseId/run`
- `POST /api/telegram/webhook`
- `POST /api/admin/calendar/google/connect`
- `GET /api/admin/calendar/google/callback`
- booking, outbound delivery, speech, and translation endpoints under `/api`

Browser code never receives provider keys, Telegram tokens, Google OAuth
secrets, token-encryption keys, or the Supabase service-role key.

## 9. Runtime dependencies

- React 19 + React Router — route surfaces
- Zustand — typed UI orchestration
- Zod — runtime contracts
- CodeMirror 6 through `@uiw/react-codemirror` — Markdown editor and gutter
- Radix primitives — accessible menus/dialogs
- TanStack Table + Recharts — Eval case table and history
- Express — same-origin API and built frontend
- OpenAI SDK — Responses/Chat-compatible text and OpenAI voice fallback
- ElevenLabs API — optional direct STT/TTS
- Supabase JS — Postgres, Storage, workspace CAS, reset template
- Google APIs — optional Calendar OAuth and event synchronization
- Vitest + Testing Library + Playwright + Axe — verification

No resizable-panel dependency is required for one lower dock; the implementation
uses Pointer Events, pointer capture, keyboard controls, and the ARIA separator
pattern.

## 10. Demo reset

The migration `20260718010000_demo_seed_templates.sql` must exist in the target
database before reset.

Safe operator order:

1. stop the app and Telegram worker
2. apply migrations and `supabase/seed.sql`
3. compile the template with `npm run demo:seed`
4. set `LIVE_TELEGRAM_ENABLED=false`
5. run the guarded reset with explicit `RESET_DEMO` confirmation
6. restart the app and verify the five seeded Eval cases and three aircon SOPs

The reset preserves Google OAuth and sent Telegram audit, removes pending work,
and clears mapped Google events through the guarded CLI path.

## 11. Demo beats

Each beat should reveal a concrete consequence in under 20 seconds:

1. Open the Malay booking request and generate a grounded reply.
2. Confirm a service slot and show the server-owned booking result.
3. Open the package complaint and capture “agent was wrong” feedback.
4. Run the failed package-selection Eval and inspect evidence.
5. Generate one exact SOP proposal.
6. Accept it; watch the proposal pane disappear and gutter number turn green.
7. Validate the candidate across train and holdout.
8. Activate; watch candidate and gutter state clear.
9. Roll back; show the prior SOP restored as a new immutable version.

## 12. Acceptance gate

Before commit:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Also verify:

- server projection replaces stale browser demo conversations
- no user-facing clinic/patient/medical copy remains
- no unscored Eval case reaches suite freezing
- sandbox prompts explicitly forbid tool requests
- rate-card failures target the rate-card SOP
- pending proposal pane disappears after all decisions
- approved lines use number-only color
- activation clears diff markers and enables rollback
- 1440px, 390px, and 320px layouts have no critical overflow

Do not commit secrets, generated provider output, or destructive reset state.
