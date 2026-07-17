---
title: "KaunterAI MSME Aircon Demo Implementation Handoff"
status: "Design-only implementation contract; no product code or external system changed by this document"
owner: "Bryan Lai"
created_at: "2026-07-17"
target_event: "Codex Community Hackathon Kuala Lumpur 2026"
target_track: "MSME Advantage"
repository: "/Users/bryan.lai/Documents/Adhoc/codex-july-hackathon-official"
branch_at_capture: "main"
working_tree_at_capture: "Heavily dirty; another agent is actively editing"
implementation_rule: "One writer at a time; re-read the current tree before every phase"
commit_policy: "Do not commit or push unless Bryan explicitly asks"
external_write_policy: "Operator triggers deploys; never trigger DigitalOcean deploys or access staging"
---

# 1. Mission

Pivot the existing KaunterAI healthcare skin to a Malaysia-first residential aircon
servicing MSME demo without rebuilding the working engine.

The winning story is not "another WhatsApp booking bot." The differentiator is
the governed learning loop in sections 2 and 16.2.

Diagnosis: the engine exists. The root gap is domain skin plus visible UX glue
that lets a judge trace complaint -> Eval -> SOP diff -> release.

Terms:

- Eval: stored examples and criteria that test an agent reply;
- Knowledge: editable Markdown SOP files;
- Activate: the human action that makes a replayed candidate SOP active;
- Rollback: a new immutable release that restores the prior SOP content.

The implementation must stay minimal:

- preserve existing Telegram text and voice;
- preserve book, reschedule, and cancel tools;
- preserve Google Calendar;
- preserve multilingual replies;
- preserve Eval, Knowledge, Activate, and Rollback;
- change the domain skin, add the missing UX breadcrumbs, move the runtime demo
  seed to Supabase, and prove the loop;
- do not add unrelated features, architecture, dependencies, or durable docs.

# 2. Locked decisions

These decisions come from the operator and are not open for re-litigation.

| Decision | Contract |
|---|---|
| Market | MSME Advantage |
| Beachhead | Residential aircon servicing in Klang Valley |
| Supported units | Wall-mounted 1.0-1.5 HP only |
| Pricing | Fixed rate card; no negotiated/custom pricing |
| Channel | Telegram is the live channel; describe WhatsApp only as a later channel with the same conversation shape |
| Core action | Book one service visit |
| Differentiator | Complaint -> Eval -> Knowledge diff -> replay -> human Activate -> Rollback |
| Learning control | Feedback can create evidence and a proposed correction; it cannot rewrite and activate shared policy by itself |
| Rollback UX | Keep Rollback in the UI; make its unavailable state understandable before the first activation |
| Diff UX | Cursor-style gutter/line-number color only; no full-line green or red text background |
| Runtime seed owner | Supabase, not hardcoded production source |
| One-time cutover | Operator intends to wipe the demo database later; section 6.0 separates a one-time wipe from repeatable reset |
| Repeatable reset | One guarded command (design-only), no manual SQL paste; preserve Google OAuth and processed/sent Telegram audit |
| Demo backlog | Reschedule/cancel tools remain built but are omitted from live demo, video, and Eval until post-core work |
| Track registration | Operator confirmed the submission can move to MSME Advantage; published prizes are not per-track |
| Explicit non-goals | Outside-hours rules, owner dispatch, negotiated discounts, payments, photos, parts quotes, emergency routing, WhatsApp integration, auth/tenancy |
| Branching | The operator creates a branch only after the current concurrent agent finishes; this document does not create one |

# 3. Current verified baseline

## 3.1 Persistence

The deployed workspace is one row in `public.demo_state`:

- `workspace_id`: workspace key;
- `schema_version`: state schema;
- `revision`: compare-and-swap revision;
- `state`: complete JSONB aggregate.

Source: `supabase/migrations/001_demo_platform.sql:3-16`.

The JSONB aggregate includes:

- conversations;
- playbook files and corrections;
- Eval datasets and artifacts;
- `playbookHistory`.

`playbookHistory` contains:

- `activeVersionId`;
- `candidateVersionId`;
- `rollbackTargetVersionId`;
- `versions[]`, the immutable SOP bundle snapshots.

Source: `src/contracts/app-state.ts:369-388`. The server payload includes
`playbookHistory` at `src/contracts/app-state.ts:414-426`.

## 3.2 What v1, v2, and v3 mean

The displayed `vN` is the stored bundle's `sequence`, not a separate database
table row.

```text
v1 initial and active
  -> approved correction creates inactive candidate v2
  -> replay passes
  -> Activate makes v2 active and points rollbackTargetVersionId to v1
  -> Roll back creates immutable restore snapshot v3 from v1
  -> v3 becomes active and rollbackTargetVersionId points to v2
```

Activation stores the previous active version as the rollback target:
`src/domain/playbook-release.ts:358-376`.

Rollback creates a new `kind: "restore"` snapshot; it does not mutate or reactivate
the old object in place:
`src/domain/playbook-release.ts:395-425`.

## 3.3 Why the screenshot has no Rollback button

The screenshot shows:

- Active SOP: v1;
- Candidate: None;
- no prior activation.

The toolbar currently renders Rollback only when
`release.rollbackTargetVersionId` is non-null:
`src/routes/knowledge/knowledge-toolbar.tsx:109-113`.

Therefore, no button at v1 is current expected behavior, not proof that the
backend is missing.

The three-column release gate is unconditionally rendered at
`src/routes/knowledge/knowledge-route.tsx:633-661`. Its values change with
release state; the section itself has no state-based hide predicate. If it
disappears in a live browser, investigate stale hot reload, legacy Dream assets,
or concurrent working-tree drift after the tree stabilizes.

## 3.4 Current feedback path

The agent tool already:

1. creates an `autonomous_feedback` Eval case;
2. leaves `expectedHumanOutput` empty;
3. labels the conversation `agent-feedback`;
4. writes a system audit message;
5. returns `evalCaseId`.

Source: `server/autonomous-booking-tools.ts:461-519`.

The composer can show `Open Eval candidate` only inside the current autonomous
action trace:
`src/routes/chat/thread-pane.tsx:790-804`.

This is insufficient because the link is easy to miss and is not the persistent
conversation-level status the operator requested.

Eval proposal success currently emits only:

`LLM SOP proposal created for human review.`

Source: `src/store/eval-slice.ts:447-465`.

Knowledge already supports a deep link through `?correction=<id>`. Reuse it.
Do not create another correction navigation system.

## 3.5 Current diff styling

Whole-line backgrounds come from:

- `.cm-correction-line`;
- `.cm-correction-line--approved`;
- `.cm-correction-line--rejected`;
- `.cm-correction-preview__remove`;
- `.cm-correction-preview__add`.

Source: `src/routes/knowledge/knowledge.css:516-559`.

The editor currently uses `Decoration.line`, which styles the content line:
`src/routes/knowledge/editor-pane.tsx:61-90`.

## 3.6 Current reset behavior

Two reset/bootstrap paths ship today:

- `POST /api/demo/reset` uses expected-revision compare-and-swap (CAS) and
  `mergeSyntheticReset`; it preserves Telegram conversations and non-seed Eval
  content. Source: `server/index.ts:2020-2066` and
  `src/domain/reset-merge.ts:112-201`.
- `npm run bootstrap:demo` inserts the workspace only when absent. It is not a
  reset and does not replace an existing row.

The full Supabase reset in section 6 is design-only. It must not be documented
as shipped until implemented and tested.

# 4. Product framing

## 4.1 One sentence

KaunterAI is a multilingual aircon service desk that books jobs immediately and
lets owners improve the agent's Markdown SOPs through Eval evidence, human
activation, and rollback.

## 4.2 User and pain

User/pain:

- a small Klang Valley operator is on-site and cannot answer every chat;
- customers message several providers; the first credible reply often wins;
- a slow reply loses bookings;
- a wrong package selection loses trust;
- silently editing shared policy can fix one case and break others.

## 4.3 Competitor boundary

Do not rebuild competitor CRM intake, assignment, or reminders. KaunterAI wins
on the governed policy-learning loop.

Pitch line: business SOPs live as editable Markdown files, like Codex
`AGENTS.md` for engineers. The owner reviews exact lines, replays Eval evidence,
then activates or rolls back. This is not a hidden prompt dump.

Reference:

- https://raiontech.io/home-services
- https://buklah.com/
- https://www.recommend.my/

Why aircon over other home-service skins:

| Option | Demo fit |
|---|---|
| Aircon | Fixed service SKUs, common voice-note intake, repeat demand, and a clear symptom -> package Eval failure |
| Plumbing/electrical | More diagnosis, emergency, parts, and variable-price pressure |
| Cleaning/handyman | Easy booking but weaker policy-selection and rollback story |

# 5. Aircon domain contract

## 5.1 Fixed rate card

Use exactly one canonical rate card everywhere:

| Service | Supported unit | Fixed price | Demo rule |
|---|---|---:|---|
| General service | Wall-mounted 1.0-1.5 HP | RM99 per unit | Routine cleaning with no musty smell and no severe cooling complaint |
| Chemical wash | Wall-mounted 1.0-1.5 HP | RM160 per unit | Recommend when poor cooling and musty smell occur together |

These values are synthetic demo policy, grounded in publicly advertised Klang
Valley ranges. They are not a market-wide pricing claim.

References:

- https://www.acservice.my/
- https://www.aircondcare.my/aircond-service-price/
- https://www.acfix.my/aircond-service-price/

## 5.2 Required intake fields

Before quoting and booking, the agent needs:

1. service symptoms;
2. wall-mounted confirmation;
3. horsepower: 1.0 or 1.5 HP;
4. number of units;
5. service area;
6. preferred date/time;
7. synthetic demo address after slot selection.

Canonical fake address:

```text
Unit DEMO-12, Jalan SS2 Demo, 47300 Petaling Jaya
```

Do not add photos, diagnostic parts, technician assignment, deposits, or route
optimization.

## 5.3 Haggling

The agent does not negotiate.

Approved response shape:

> Our demo uses a fixed rate card: RM99 per unit for general service and RM160
> per unit for a chemical wash. I can help you choose a slot.

If asked for a discount:

> The rate card is fixed, so I cannot change the price. It is RM99 for general
> service or RM160 for a chemical wash per supported unit.

Do not generate fake discounts, bundle prices, or manager approvals.

## 5.4 Package-selection rule

The deliberate baseline failure is:

```text
Customer says: "aircond tak sejuk and bau hapak"
Wrong v1 behavior: quotes general service RM99
Expected behavior: recommends chemical wash RM160
```

The proposed Knowledge correction must be one exact rule:

```markdown
If a wall-mounted 1.0-1.5 HP unit has both poor cooling and a musty smell,
recommend the RM160 chemical wash. Do not quote the RM99 general service.
```

Do not insert a long diagnostic decision tree.

# 6. Runtime seed and Supabase reset design

## 6.0 One-time database wipe vs repeatable reset

The operator intends to wipe the hackathon demo database once during the MSME
cutover. This is intent, not permission for an agent to run destructive SQL.

Recommended interpretation:

- keep the existing Supabase project, schema, URL, and keys;
- pause the DigitalOcean app;
- wipe all rows in the seven app tables in FK-safe order;
- apply pending migrations;
- load `msme-aircon-v1`;
- reconnect Google if its row was wiped;
- restart through the operator;
- prove `/readyz`, Telegram, and Calendar.

Do not recreate the Supabase project unless the operator explicitly wants new
project URL/keys. Project recreation also requires DigitalOcean environment
rotation, full migration replay, Google OAuth reconnection, and storage review.

One-time row-wipe order:

1. export the current `demo_state` row and row counts;
2. operator confirms the DigitalOcean app/workers are paused;
3. delete mapped Google events through the Google API before deleting mappings;
4. clear `outbox_jobs`;
5. clear `calendar_deliveries`;
6. clear `telegram_deliveries`;
7. clear `google_calendar_events`;
8. clear `telegram_events`;
9. clear `google_calendar_connections`;
10. clear `demo_state`;
11. apply pending migrations, compile `msme-aircon-v1`, then call
    `repository.bootstrap(workspaceId, template.state)` because the workspace
    row is absent; the reset RPC is only for an existing row;
12. inspect optional `voice-artifacts` storage orphans;
13. reconnect Google if needed;
14. operator restarts the app; verify `/readyz` before live smoke.

The future `demo_seed_templates` row is configuration, not workspace history;
do not delete it during the one-time app-data wipe.

Every child table uses `ON DELETE RESTRICT`. A true wipe of `demo_state` cannot
preserve Google OAuth or Telegram audit rows. If the operator wants to preserve
any of those rows, use the repeatable reset instead of the one-time full wipe.

One-time wipe losses:

- all conversations, Knowledge versions/corrections, Eval cases/runs, and
  selections in `demo_state.state`;
- Telegram dedupe and send audit if Telegram tables are cleared;
- Calendar delivery/outbox history;
- Google OAuth if `google_calendar_connections` is cleared;
- database rows do not delete external Google events or storage objects.

Destructive safety gate: no agent writes or runs wipe SQL until the operator
confirms all of:

1. same-project row wipe or new-project recreation;
2. exact `workspace_id`;
3. preserve/delete for Google OAuth, Telegram events, and sent deliveries;
4. external Google event cleanup;
5. pre-wipe export completed;
6. DigitalOcean app paused;
7. exact confirmation token.

Repeatable `make demo-reset` remains separate. It is for rehearsals after
cutover and preserves OAuth plus processed/sent Telegram audit. The existing
`POST /api/demo/reset` remains the non-destructive in-session merge reset.

## 6.1 Selected approach

Design a database-owned versioned seed template plus one transactional reset
function.

```text
supabase/seed.sql source_state
  -> npm run demo:seed
  -> validated, hash-complete state
  -> public.demo_seed_templates
  -> reset_demo_workspace RPC
  -> public.demo_state.state
```

`make demo-reset` is a thin wrapper around the canonical
`npm run demo:reset` command. The Node CLI invokes the reset RPC with the
service role after safety checks.

These commands, the table, and the RPC do not exist today.

No new npm dependency is required. The repository already has:

- `@supabase/supabase-js`;
- `tsx`;
- `zod`.

## 6.2 Why this approach

| Approach | Benefit | Cost | Decision |
|---|---|---|---|
| Supabase template + transactional RPC | Database owns runtime seed; atomic reset; no manual SQL | One migration, one RPC, one CLI | Selected |
| Versioned JSON + Node upsert | Fastest code path | Cross-table reset is not atomic; runtime seed still lives outside DB | Rejected |
| Keep `src/domain/seed.ts` | Lowest edit count | Violates database-owned seed requirement | Rejected |

## 6.3 Proposed table

The implementing agent may adjust SQL syntax after inspecting the live Supabase
schema, but must preserve this contract:

```sql
public.demo_seed_templates
  seed_key text primary key
  schema_version integer not null
  source_state jsonb not null
  state jsonb
  compiled_at timestamptz
  created_at timestamptz not null
  updated_at timestamptz not null
```

`ServerDomainStatePayload` is the persisted server workspace shape defined in
`src/contracts/app-state.ts:414-426`.

- `source_state` holds the database-owned domain seed from section 7;
- `state` holds the compiled `ServerDomainStatePayload`;
- `server/demo-seed-builder.ts` reads `source_state`, computes real
  `contentHash` and `bundleHash` through the existing SHA-256 helper, adds
  `playbookHistory` v1, `evalArtifacts`, `speechArtifacts`, and server
  conversation fields, then validates with `serverDomainStateSchema.parse`;
- `npm run demo:seed` writes the validated result and `compiled_at`;
- reset rejects a missing/uncompiled `state`.

`supabase/seed.sql` is the one machine-readable owner of aircon demo content.
Do not add a second canonical JSON/TypeScript fixture.

Required insert shape:

```sql
insert into public.demo_seed_templates (
  seed_key,
  schema_version,
  source_state,
  state,
  compiled_at
) values (
  'msme-aircon-v1',
  4,
  '<complete domainStateSchema JSON from section 7>'::jsonb,
  null,
  null
);
```

`source_state` contains exactly these top-level keys:

```text
schemaVersion
fixtureTime
conversations
playbookFolders
playbookFiles
corrections
evalDatasets
```

It does not contain client `selections`, server `playbookHistory`,
`speechArtifacts`, or `evalArtifacts`; `demo:seed` adds the server fields.

Seed key:

```text
msme-aircon-v1
```

The template contains only synthetic product state. It must never contain:

- Supabase keys;
- Telegram tokens or update IDs;
- Google refresh tokens or event IDs;
- provider receipts;
- real customer names, phones, or addresses.

## 6.4 Reset RPC contract

Proposed signature:

```text
reset_demo_workspace(
  workspace_id,
  seed_key,
  confirmation
)
```

Security:

- revoke execute from `anon` and `authenticated`;
- grant only to `service_role`;
- allowlist the demo workspace ID;
- require an exact confirmation value;
- reject missing seed or schema mismatch;
- lock the workspace row during reset;
- never use unrestricted `TRUNCATE`.

Transaction:

1. load and validate the seed template;
2. lock the target `demo_state` row;
3. preserve processed `telegram_events`;
4. preserve sent `telegram_deliveries`;
5. preserve `google_calendar_connections`;
6. clear `google_calendar_events` after external cleanup;
7. clear demo `calendar_deliveries`;
8. clear workspace `telegram_deliveries` whose status is `pending`, `sending`,
   or `failed`; preserve `sent`;
9. replace `demo_state.state` with `template.state`;
10. set `demo_state.schema_version` from `template.schema_version`;
11. increment `revision`;
12. clear all workspace `outbox_jobs` after the state update, because the
    existing update trigger may enqueue Calendar work;
13. return revision, seed key, and row-count summary.

This full reset intentionally differs from the existing UI reset:

- `make demo-reset`: destructive operator command; clean product state;
  preserves OAuth and processed/sent integration audit only.
- `POST /api/demo/reset`: in-session merge reset; preserves live Telegram
  conversations and non-seed Eval content.

Both modes must use the same Supabase seed template. Do not leave two canonical
seed definitions.

## 6.5 Google Calendar second-order effect

Deleting a `google_calendar_events` mapping does not delete the real Google
event. Clearing the mapping first creates an orphan that the app can no longer
address.

Therefore `demo:reset` must:

0. operator confirms the DigitalOcean app and any local server are stopped
   through Google cleanup and RPC commit;
1. add `listByWorkspace` and `deleteMapping` to the Google Calendar repository;
2. add `deleteMappedEvent(eventId)` to the Google Calendar service because
   `syncBooking` cannot delete an approved/active booking;
3. list every active `google_calendar_events` row for the target workspace;
4. delete each through the Google API using its stored event ID;
5. abort the database reset if cleanup fails;
6. then call the reset RPC.

External Google deletion and the database transaction cannot be one atomic
transaction. Delete Google events first. If the database step fails, the
mapping remains and retry is safe; the inverse order would create unreachable
orphan events.

Do not delete `google_calendar_connections`; OAuth reconnection is not part of
every demo reset.

## 6.6 Telegram second-order effect

Deleting processed `telegram_events` may allow duplicate webhook updates to be
processed again. Preserve them.

Deleting sent `telegram_deliveries` removes the durable audit and may weaken
duplicate-send protection. Preserve sent records.

The repeatable reset uses the dedicated demo workspace as its scope. Delete
`telegram_deliveries` only where `workspace_id` matches and `status` is
`pending`, `sending`, or `failed`; preserve `sent`.

## 6.7 Command contract

Precondition: the operator confirms the DigitalOcean app and any local server
are stopped before the CLI starts Google cleanup.

Compile/validate the database seed:

```bash
npm run demo:seed -- --seed msme-aircon-v1
```

Canonical:

```bash
npm run demo:reset -- --workspace demo --seed msme-aircon-v1 --confirm RESET_DEMO
```

Convenience:

```bash
make demo-reset
```

The Make target must call the npm script. Business logic belongs in one Node
CLI, not duplicated in Make.

CLI output:

```text
workspace=<id>
seed=msme-aircon-v1
previous_revision=<n>
new_revision=<n+1>
google_events_removed=<n>
outbox_rows_removed=<n>
oauth_preserved=true
telegram_sent_audit_preserved=true
status=ready
```

Exit non-zero if any required verification fails.

## 6.8 Runtime and test data boundary

Production runtime demo data must not remain hardcoded in `src/domain/seed.ts`.

`createCanonicalSeed` currently feeds domain persistence, browser fallback,
server bootstrap, E2E helpers, and tests. Replace those consumers deliberately:

- server/bootstrap reads the Supabase template;
- add `projectServerWorkspaceFromSeed` and `reconcileDemoSelections` in
  `src/domain/server-workspace.ts`;
- use that full projection after initial workspace load in
  `src/store/use-app-store.ts`, after destructive `demo:reset`, and after
  `POST /api/demo/reset` so both synthetic and Telegram server conversations
  replace client-local conversation state;
- run `reconcileDemoSelections` after each full projection; prefer the three
  section 7.4 IDs and fall back to the first valid IDs only if one is absent;
- keep `mergeTelegramWorkspaceState`
  (`src/domain/telegram-workspace.ts:80-124`) only for incremental live
  Telegram refresh;
- that projection maps nullable server phone/MRN fields to the client view's
  string-compatible empty values without rendering an MRN;
- browser mode without Supabase shows an explicit setup state or uses local
  Supabase;
- E2E and unit tests use one shared test builder, not a copy of the full demo;
- `src/domain/server-seed.ts` remains as the snapshot/hash builder but accepts
  an injected or repository-loaded seed instead of importing healthcare data.

The row column `demo_state.schema_version` and JSONB
`state.schemaVersion` must both match `SCHEMA_VERSION`.

Tests may retain small, purpose-built fixtures under `tests/fixtures` when a
unit test needs a precise state. They must not copy the entire aircon demo
dataset. Integration tests should seed the database template or use one shared
test builder.

Local development without Supabase must show a clear setup state or use a local
Supabase instance seeded by the same SQL. Do not silently fall back to a second
hardcoded healthcare dataset.

# 7. Minimal synthetic seed

Keep the seed small. Do not build a fake CRM.

## 7.1 Business

```text
name: CoolBreeze Aircond PJ
coverage: Petaling Jaya demo areas
language: Malay and English
channel: Telegram
fixtureTime: 2026-07-18T08:00:00+08:00
fakeAddress: Unit DEMO-12, Jalan SS2 Demo, 47300 Petaling Jaya
```

The Supabase template's `fixtureTime` is authoritative for runtime state.
Runtime builders must not overwrite it with the current test-only
`FIXTURE_TIME_ISO` constant (`src/domain/types.ts:52`).

## 7.2 Conversations

| ID | Purpose | State |
|---|---|---|
| `convo-aircon-booking` | Golden path: Malay voice/text booking | In progress, no booking at reset |
| `convo-aircon-complaint` | Wrong-package learning loop | In progress; includes a prior `synthetic_agent` message quoting general service RM99 |
| `convo-aircon-resolved` | Queue realism without another feature | Resolved |

Use synthetic names and non-routable or clearly fake phone values.

Compatibility fields:

| Conversation | Internal `patient.name` | Phone | `medicalRecordNumber` | Language |
|---|---|---|---|---|
| `convo-aircon-booking` | Aina Demo | `+601100000101` | `null` in server payload | Malay |
| `convo-aircon-complaint` | Farid Demo | `+601100000102` | `null` in server payload | English |
| `convo-aircon-resolved` | Mei Demo | `+601100000103` | `null` in server payload | Malay |

All three use internal `urgency: "routine"`. The resolved conversation uses
`agentMode: "staff_only"` and `resolvedAt: fixtureTime`; the other two use
`synthetic_agent` and `resolvedAt: null`.

Labels:

- booking: `["aircon", "booking", "general-service"]`;
- complaint: `["aircon", "package-selection"]`;
- resolved: `["aircon", "resolved"]`.

The full server payload allows `medicalRecordNumber: null`. If an intermediate
domain `AppState` builder is retained, use an empty string there because
`patientSchema` requires a string, then map it to `null` in the server payload.

All reset/demo conversations use `channel: "demo"` and
`source: "synthetic"`. A real inbound Telegram message creates its own
`channel: "telegram"` and `source: "telegram"` conversation.

Google Calendar proof requires the live Telegram conversation. The Calendar
service intentionally skips synthetic conversations.

Do not seed emergency, clinic, prescription, lab, MRN, patient, parts, payment,
or dispatch scenarios.

Minimum messages:

```text
convo-aircon-booking
[book-1 @ fixtureTime] customer: "Saya nak servis biasa untuk satu aircond wall unit 1.5 HP di SS2."
[book-2 @ fixtureTime] agent: "General service is RM99 per unit. Which date and time do you prefer?"

convo-aircon-complaint
[complaint-1 @ fixtureTime] customer: "My 1.5 HP wall unit is not cooling and smells musty."
[complaint-2 @ fixtureTime] agent: "General service is RM99 per unit."
[complaint-3 @ fixtureTime] customer: "That package is wrong. I said it is not cooling and smells musty."

convo-aircon-resolved
[resolved-1 @ fixtureTime] customer: "Terima kasih, servis sudah selesai."
[resolved-2 @ fixtureTime] staff: "Sama-sama. Job ini ditutup."
[resolved-3 @ fixtureTime] system: "Conversation resolved by staff."
```

Every message uses the internal role enum (`patient` renders as Customer) and
has stable `id`, text, optional gloss/language, and `sentAt: fixtureTime`.

## 7.3 Playbooks

| ID | Path | Owns |
|---|---|---|
| `file-aircon-rate-card` | `playbooks/aircon-rate-card.md` | Supported services and fixed prices |
| `file-aircon-booking` | `playbooks/aircon-booking.md` | Required fields, slot confirmation, Calendar action |
| `file-aircon-service-selection` | `playbooks/aircon-service-selection.md` | General vs chemical wash rule |

Each fact has one owner. Do not repeat the full rate card in all three files.
Other playbooks may link to `aircon-rate-card.md`.

File metadata:

| ID | Title | `updatedAt` | `protected` |
|---|---|---|---|
| `file-aircon-rate-card` | Aircon rate card | `fixtureTime` | `true` |
| `file-aircon-booking` | Aircon booking | `fixtureTime` | `true` |
| `file-aircon-service-selection` | Aircon service selection | `fixtureTime` | `true` |

Exact v1 file bodies:

```markdown
# Aircon rate card

- Supported scope: wall-mounted 1.0-1.5 HP units in the demo service area.
- General service: RM99 per unit.
- Chemical wash: RM160 per unit.
- Prices are fixed. Do not invent discounts, parts, gas, or repair quotes.
```

```markdown
# Aircon booking

Collect symptoms, unit type, horsepower, unit count, area, preferred slot, and
address. Offer only server-returned slots. Create the booking only after the
customer explicitly confirms one slot and the address.
```

```markdown
# Aircon service selection

Routine cleaning uses the RM99 general service.
For poor cooling and a musty smell, quote the RM99 general service.
Do not diagnose parts or promise a repair outcome.
```

The second line in `aircon-service-selection.md` is the intentional v1 defect.
The correction in section 5.4 replaces that line; no other seed policy changes.

## 7.4 Eval dataset

Dataset:

```text
id: dataset-aircon-ops
name: Aircon service operations
protected: true
```

Minimal cases:

| ID | Split | Tests |
|---|---|---|
| `case-aircon-rate-card-train` | Train | Exact fixed price and no invented discount |
| `case-aircon-selection-train` | Train | Poor cooling + musty smell -> chemical wash |
| `case-aircon-confirm-train` | Train | No booking until explicit slot confirmation |
| `case-aircon-rate-card-holdout` | Holdout | English paraphrase still uses fixed price |
| `case-aircon-selection-holdout` | Holdout | Malay paraphrase still selects chemical wash |

Criteria:

| ID / label | Instruction | `required` / `version` | `caseTypes` | Good / bad example |
|---|---|---|---|---|
| `crit-aircon-price` / Fixed rate card | Use RM99 general service and RM160 chemical wash; do not invent discounts | `true` / `1` | omitted: applies to all | Good: `General service is RM99.` Bad: `I can discount it to RM80.` |
| `crit-aircon-selection` / Package selection | Poor cooling plus musty smell requires chemical wash | `true` / `1` | `["general"]` | Good: `Chemical wash is RM160.` Bad: `General service is RM99.` |
| `crit-aircon-confirm` / Explicit booking confirmation | Do not create or claim a booking before explicit slot/address confirmation | `true` / `1` | `["booking"]` | Good: `Please confirm the slot and address.` Bad: `Your booking is confirmed.` |

Case payloads:

| Case ID / title | Type / language | Input | Exact expected human output | Criteria |
|---|---|---|---|---|
| `case-aircon-rate-card-train` / Malay general-service price | `general` / Malay | `Berapa servis biasa untuk wall unit 1.5 HP?` | `General service is RM99 per supported unit.` | `crit-aircon-price` |
| `case-aircon-selection-train` / Combined symptoms need chemical wash | `general` / English | `My 1.5 HP wall unit is not cooling and smells musty.` | `For poor cooling and a musty smell, I recommend the RM160 chemical wash for one supported unit.` | `crit-aircon-selection`, `crit-aircon-price` |
| `case-aircon-confirm-train` / Explicit booking confirmation | `booking` / English | `Saturday 10 AM works.` | `Please confirm Saturday 10:00-12:00 at Unit DEMO-12, Jalan SS2 Demo, 47300 Petaling Jaya before I create the booking.` | `crit-aircon-confirm` |
| `case-aircon-rate-card-holdout` / Discount request holdout | `general` / English | `Can you discount a normal service?` | `The fixed general-service price is RM99 per supported unit; I cannot add a discount.` | `crit-aircon-price` |
| `case-aircon-selection-holdout` / Malay combined-symptom holdout | `general` / Malay | `Aircond wall unit 1.0 HP kurang sejuk dan berbau hapak.` | `Untuk kurang sejuk dan bau hapak, saya syorkan chemical wash RM160 untuk satu unit yang disokong.` | `crit-aircon-selection`, `crit-aircon-price` |

All cases use `source.kind: "seed"`. Start with `suiteSnapshots: []` and
`runHistory: []`; dataset `candidateVersion: 1`; `corrections: []`; and
`playbookFolders: ["playbooks", "playbooks/data"]`.

Each case input has one message with stable ID `<case-id>-1`, internal role
`patient`, and `sentAt: fixtureTime`.

Client-only selection defaults are not stored in the Supabase
`ServerDomainStatePayload`. After hydrate, `reconcileDemoSelections` selects:

```text
conversationId: convo-aircon-booking
playbookFileId: file-aircon-rate-card
evalDatasetId: dataset-aircon-ops
```

Update `SEED_EVAL_CASE_IDS` to these five IDs. Keep old healthcare IDs only in
`LEGACY_SEED_EVAL_CASE_IDS` while existing-state migration/reset tests still
need them; remove them after the one-time wipe if no persisted legacy state
remains. The merge reset must not assume `dataset-seed`; it must select the
protected canonical dataset loaded from `msme-aircon-v1`.

Do not add reschedule or cancel Eval cases. They are outside core DoD.

## 7.5 Version state at reset

Use the v1 initial state defined in section 3.2. The discoverability contract is
section 8.1.

# 8. UX contracts

## 8.1 Rollback discoverability

Root cause: section 3.3.

Decision: yes, keep Rollback in the UI. The backend is real; the minimal fix is
discoverability, not another release system.

Minimal solution:

- always render `Roll back` in the Knowledge toolbar;
- at v1, disable it;
- accessible reason: `Available after the first candidate is activated`;
- after activation, enable it;
- while draft dirty, candidate exists, or release action runs, disable with the
  matching reason below;
- do not add version history or a target picker.

Disabled reason:

- no target: `Available after the first candidate is activated`;
- dirty draft: `Save or discard draft changes before rollback`;
- release busy: `Release action in progress`;
- candidate present: `Discard or activate the candidate before rollback`.

Always expose the active reason through `title` and `aria-label`.

Replace the current third release-gate column:

- `Release path` -> `Prior version`;
- add `rollbackTargetVersionSequence: number | null` to the release projection;
- move the short Edit -> Replay -> Activate hint under Candidate or toolbar
  help;
- do not add a fourth column.

Release gate copy:

```text
Prior version: None until first activation
```

After activation:

```text
Prior version: v1 available
```

## 8.2 Chat learning banner

Show one persistent conversation-level banner when a feedback case exists for
the selected conversation.

Derive it from persisted state:

- `evalCase.source.kind === "autonomous_feedback"`;
- `evalCase.source.conversationId === selectedConversation.id`.

Scan only the protected dataset's `cases` array.

Do not add a new database field merely for the banner.

Copy:

```text
Learning signal captured
The agent flagged this conversation for review. Shared SOPs have not changed.
[Open Eval case]
```

Behavior:

- CTA deep-links to `/eval?case=<evalCaseId>`;
- banner survives refresh;
- banner appears once per relevant conversation;
- if several cases match, link the last matching case in persisted dataset
  order;
- no auto-navigation;
- no toast-only implementation;
- mobile keeps the CTA visible without opening the customer rail.

Mount the banner in `src/routes/chat/thread-pane.tsx` directly above the
composer, outside the customer rail.

## 8.3 Eval -> Knowledge correction CTA

After `proposeCorrections` succeeds:

1. compare correction IDs before and after the command;
2. select the newly created correction;
3. show:

```text
SOP correction proposed
Nothing is active yet. Review the exact diff in Knowledge.
[Open Knowledge correction]
```

CTA:

```text
/knowledge?correction=<correctionId>
```

If no new correction exists, do not invent a link. Show the existing completion
status only.

## 8.4 Knowledge arrival toast

When Knowledge consumes `?correction=<id>` and finds the correction:

```text
Correction opened from Eval evidence
Review the diff, replay affected cases, then activate only if the full suite passes.
```

Keep it local to Knowledge. Do not add a global notification center.

## 8.5 Cursor-style correction markers

Approved/rejected correction status belongs in the line-number gutter.

Implementation direction:

- replace content-line status styling with CodeMirror `gutterLineClass` or
  `lineNumberMarkers`;
- approved gutter: `var(--kaunter-success-fg)`;
- rejected gutter: `var(--kaunter-risk-fg)`;
- pending gutter: `var(--kaunter-warning-fg)`;
- content background: `var(--kaunter-paper)`;
- focus: existing `var(--kaunter-focus-ring)`, never a filled background;
- pending remove/add preview keeps a thin red/green left border and readable
  text, not a full-width colored block.

Do not change unrelated Knowledge layout, typography, spacing, or panes.

# 9. Why feedback does not auto-activate policy

## 9.1 Correct terms

Use:

- untrusted user input;
- prompt or instruction injection;
- instruction poisoning;
- single-example overfitting;
- regression;
- distribution shift;
- Goodhart's law or evaluator overoptimization;
- specification gaming;
- human-in-the-loop policy release;
- immutable versioning and rollback.

## 9.2 Terms not to use

Do not call the Markdown policy loop:

- model retraining;
- fine-tuning;
- RLHF;
- catastrophic forgetting;
- model collapse.

Those terms describe model-weight or training-data processes. KaunterAI changes
runtime policy files, not model weights.

## 9.3 Thirty-second explanation

A complaint is one untrusted data point, not a safe global rule. If customer
text can directly rewrite the shared playbook, untrusted input is promoted into
the agent's privileged instruction layer. KaunterAI captures the complaint as
Eval evidence, proposes one reviewable Markdown diff, replays regression cases,
and requires human Activate. Rollback provides recovery if a passing change
still behaves badly after release.

## 9.4 Primary references

- OpenAI prompt injection:
  https://openai.com/safety/prompt-injections/
- OpenAI agent safety:
  https://developers.openai.com/api/docs/guides/agent-builder-safety
- OpenAI prompts as application code:
  https://developers.openai.com/api/docs/guides/prompting
- OpenAI Codex `AGENTS.md`:
  https://developers.openai.com/codex/guides/agents-md
- Anthropic agent Eval regression:
  https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- Anthropic agent oversight:
  https://www.anthropic.com/research/measuring-agent-autonomy
- NIST AI Risk Management Framework:
  https://nvlpubs.nist.gov/nistpubs/ai/nist.ai.100-1.pdf
- OWASP LLM prompt injection:
  https://owasp.org/www-project-top-10-for-large-language-model-applications/

# 10. Prompt and visible-copy changes

Change domain words only after the seed IDs are locked.

## 10.1 Server prompts

Inspect and minimally update:

- `server/agent-prompt.ts`;
- `server/judge-prompt.ts`;
- `server/correction-proposer.ts`;
- tool descriptions in `server/autonomous-booking-tools.ts`;
- translation instruction in `server/translation-service.ts`.

Required vocabulary:

- customer, not patient;
- service visit, not appointment/consultation where the context is aircon;
- operator/owner, not clinic staff;
- playbook/SOP, not clinical policy;
- escalate unsupported quote to the owner, not a medical handoff.

Do not change tool names or their schemas solely for cosmetic reasons.

## 10.2 Internal compatibility fields

To minimize blast radius before the hackathon:

- keep internal `patient` object and `patient` message role temporarily;
- render them as `Customer` in UI;
- leave `medicalRecordNumber` null and hide it;
- use only `booking` and `general` Eval case types in the aircon seed;
- do not map aircon work onto `prescription`, `lab_follow_up`, or
  `emergency_triage`.

This is an intentional compatibility boundary, not a claim that the schema is
domain-neutral. Rename internal fields only after the demo is green and only
with a separate migration plan.

## 10.3 User-facing sweep

Before completion, user-facing `src/`, prompts, and seed must contain no:

```text
clinic
patient
prescription
lab result
MRN
triage
999
healthcare
```

Allow internal compatibility identifiers only when they do not render or enter
prompts. Document each allowed hit in the proof lane.

Production without Supabase fails readiness. Local development without Supabase
shows:

```text
Supabase is required for the demo workspace.
Configure SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and KAUNTER_WORKSPACE_ID,
then reload.
```

Do not silently load healthcare data.

# 11. Implementation sequence

Dependencies determine order. Do not parallelize overlapping files.

## Phase 0: stabilize the tree

1. Get operator confirmation that the concurrent agent stopped.
2. Record `git rev-parse HEAD` and `git status --short`.
3. Read every dirty/untracked file in the target phase before editing.
4. Confirm the router serves Knowledge and no active import points to Dream.
5. Record the baseline result of `npm run verify`.
6. Operator creates the implementation branch if desired.
7. Do not clean, restore, reset, stash, or overwrite concurrent work.

Exit: one writer, canonical Knowledge route, recorded baseline tests.

Known baseline at 2026-07-17 23:58 MYT:

```text
npm run typecheck
tests/setup.ts(27,10): TS2591 Cannot find name 'process'
```

Before pivot verification can be green, add Node types to the applicable
TypeScript test config or add the local Node type reference in
`tests/setup.ts`; rerun `npm run verify`. Do not misattribute this current
dirty-tree baseline failure to the MSME changes.

## Phase 1: freeze data and behavior contracts

1. Freeze seed key, IDs, rate card, conversations, playbooks, Eval cases.
2. Freeze UI copy in sections 8 and 9.
3. Freeze reset preserve/clear matrix.
4. Add no implementation yet if any of these still conflict.

Exit: one owner per seed fact, one rate card, one reset contract.

## Phase 2: Supabase seed and reset

1. Add migration for `demo_seed_templates`.
2. Add `supabase/seed.sql` source for `msme-aircon-v1`.
3. Add `server/demo-seed-builder.ts` and `npm run demo:seed` to compile hashes
   and validate the full server state.
4. Add service-role-only reset RPC.
5. Add Node reset CLI with environment and workspace guards.
6. Add `npm run demo:reset`.
7. Add thin `make demo-reset`.
8. Keep the current merge reset but source it from the same database template.
9. Repoint server snapshot/hash construction to injected database seed state.
10. Add one full server-workspace projection that maps both synthetic and
   Telegram conversations; do not rely on Telegram-only merge for initial
   hydrate/reset.
11. Update `SEED_EVAL_CASE_IDS` and protected-dataset merge behavior.
12. Remove runtime healthcare seed dependency.
13. Replace browser/E2E/test consumers listed in section 6.8.
14. Prepare the section 6.0 operator wipe playbook; do not execute it.

Exit gate: every reset assertion in section 13.4 is green and `/readyz` stays
healthy.

## Phase 3: MSME skin

1. Load aircon seed into Supabase.
2. Update prompt vocabulary.
3. Update visible Chat/Knowledge/Eval labels.
4. Hide MRN and other healthcare-only presentation.
5. Keep internal compatibility fields unchanged.
6. Update `package.json` description/keywords.
7. Replace or remove healthcare-only `SIMULATE_SCENARIOS` if still exposed.
8. Run a user-facing healthcare-string sweep.

Exit: all routes read as aircon MSME, no clinical surface remains, and existing
booking/Calendar contracts are unchanged.

## Phase 4: minimal learning glue

1. Add derived Chat learning banner.
2. Add Eval correction CTA.
3. Add Knowledge arrival toast.
4. Make Rollback visible but disabled before first activation.
5. Add reason text and accessible state.
6. Add UI tests before cosmetic work.

Exit: section 13.2 is green; no notification framework or auto-activation was
added.

## Phase 5: Cursor-style diff

1. Replace content-line backgrounds with gutter markers.
2. Keep pending preview border-only.
3. Verify approved, rejected, pending, focused, and active editor-line
   combinations.
4. Verify 1440px, 390px, and 320px.

Exit: section 13.3 is green.

## Phase 6: demo proof

1. Reset to `msme-aircon-v1`.
2. Run the golden booking path on a live Telegram conversation.
3. Run failure-learning path.
4. Activate v2.
5. prove Rollback creates v3.
6. re-run affected and full Eval suites.
7. run full repository verification.
8. record <3-minute video.
9. rehearse 6-minute live demo five times.

## Phase 7: docs, last

Update only after behavior is proven:

- `README.md`: setup, sample-data/seed pointer, run/reset command, demo/testing
  instructions, and where Codex/GPT-5.6 accelerated the workflow;
- `PROJECT.md`: canonical current product/behavior contract;
- `SOUL.md`: aircon/customer terminology and attention model;
- `docs/autonomous-booking-agent.md`: feedback and release safety;
- `docs/calendar-outbox.md`: any healthcare fixture examples;
- `docs/elevenlabs-autonomy-mvp.md`: customer/service examples;
- `package.json`: description and keywords;
- only other durable docs with claims made false by the pivot.

Until Phase 7 is complete, `PROJECT.md` healthcare demo sections are stale.
The demo-script source of truth is sections 16-17 of this handoff.

Do not add:

- a durable migration diary;
- a second architecture overview;
- a second demo script;
- a duplicate rate-card section;
- "what changed from healthcare" narration.

# 12. File ownership map

Re-read before editing because the tree is moving.

| Area | Likely files | Contract |
|---|---|---|
| Supabase schema | `supabase/migrations/*` | Template table, RPC, grants |
| Seed | `supabase/seed.sql`, `server/demo-seed-builder.ts` | One database-owned source + validated compiled state |
| Reset CLI | `server/demo-reset.ts`, `package.json`, `Makefile` | Guarded orchestration; no duplicated logic |
| Server projection | `src/domain/server-workspace.ts` | Full hydrate + selection reconcile; Telegram merge stays incremental |
| Workspace reset | `server/index.ts`, workspace repository/service | Use database template |
| Seed removal | `src/domain/seed.ts` and its consumers | No production healthcare fixture |
| Seed snapshot builder | `src/domain/server-seed.ts` | Keep hashing/snapshot logic; accept repository-loaded or injected seed |
| Seed/merge constants | `src/contracts/constants.ts`, `src/domain/reset-merge.ts` | Aircon seed IDs and protected-dataset merge |
| Prompt skin | agent, judge, correction, translation prompt files | Customer/service language |
| Chat glue | `src/routes/chat/*` | Persisted derived banner + Eval link |
| Eval glue | `src/store/eval-slice.ts`, `src/routes/eval/*` | New correction CTA |
| Knowledge glue | `src/routes/knowledge/knowledge-route.tsx` | Deep-link toast |
| Rollback UX | `knowledge-toolbar.tsx`, route, tests | Visible disabled -> enabled |
| Diff UX | `editor-pane.tsx`, `knowledge.css` | Gutter marker only |
| Contracts | existing schemas | No broad rename in core phase |
| Tests | focused domain/server/route/E2E files | Prove behavior, not strings only |
| Durable docs | README/PROJECT/SOUL/agent doc | Current-state facts, no duplicate history |

# 13. Test and proof matrix

## 13.1 Rollback

The UI and E2E rows are DESIGN acceptance criteria; they are not shipped today.

| Layer | Proof |
|---|---|
| Domain | Activate v2 sets target v1; rollback creates restore v3 |
| Server command | `rollback_playbook` persists revision and version |
| Store | response projects active, candidate, and rollback pointers |
| UI | v1 shows disabled Rollback with reason |
| UI | v2 active enables Rollback |
| E2E | click Rollback -> active version sequence becomes v3 and file content matches v1 |

## 13.2 Learning glue

Every row is DESIGN acceptance criteria; the persistent banner/CTA/toast are
not shipped today.

| Scenario | Expected |
|---|---|
| No feedback case | No Chat learning banner |
| Feedback case created | Banner appears with correct Eval case link |
| Browser refresh | Banner still appears from persisted state |
| Fresh browser after DB seed | Supabase synthetic conversations appear without local seed fallback |
| Proposal creates correction | Eval status includes Knowledge CTA |
| Deep link valid | Knowledge selects file/correction and shows arrival toast |
| Deep link invalid | No fake success; show not-found feedback |

## 13.3 Diff

Every row is DESIGN acceptance criteria; current code still colors content
lines.

| State | Expected |
|---|---|
| Pending | warning gutter; neutral text background; border-only preview |
| Approved | green gutter/line number; neutral text background |
| Rejected | red/muted gutter/line number; neutral text background |
| Focused | visible focus indicator without hiding status |
| Active editor line | active-line style does not overwrite correction marker |

Use an E2E computed-style assertion or screenshot proof. A class-name unit test
alone does not prove the rendered visual.

## 13.4 Reset

Scope: this matrix applies only to destructive
`npm run demo:reset` / `make demo-reset`. The existing
`POST /api/demo/reset` keeps its merge contract: Telegram conversations and
non-seed Eval content survive, and existing merge-reset tests remain green.

| State before reset | Expected after reset |
|---|---|
| Google OAuth connection | Unchanged |
| Processed Telegram event | Preserved |
| Sent Telegram delivery | Preserved |
| Pending/sending/failed Telegram delivery | Deleted for the target workspace |
| Outbox jobs | Cleared to avoid stale dedupe keys/actions |
| Mapped Google event | Deleted externally before mapping is cleared |
| `demo_state.state` | Exact `msme-aircon-v1` template |
| Live Telegram conversations inside `demo_state.state` | Removed; only template synthetic conversations remain |
| Revision | Increased |
| Playbook history | v1 active; no candidate; no rollback target |
| Healthcare runtime seed | Absent |

## 13.5 Repository gate

Run the repository's canonical gate:

```bash
npm run verify
```

Then:

- inspect changed-file lints;
- inspect final diff;
- run user-facing healthcare-string sweep;
- run duplicate-content sweep across durable docs;
- run the golden demo against a freshly reset workspace.

Static/unit green does not prove Telegram, Google, Supabase, or DigitalOcean.
Label each proof tier correctly.

Proof tiers and required non-secret environment names:

| Tier | Proves | Required names |
|---|---|---|
| Static | lint, unit/domain/server/route tests, typecheck, build, mocked E2E | none beyond test defaults |
| Local integration | Supabase seed/reset and repository behavior | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `KAUNTER_WORKSPACE_ID` |
| Operator-live | real Telegram voice/text, Google event, deployed UI | prior names plus `LLM_API_KEY`, `LLM_MODEL`, `LIVE_AGENT_ENABLED`, `SPEECH_PROVIDER`, `TTS_PROVIDER`, `LIVE_TELEGRAM_ENABLED`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `CALENDAR_DISPATCH_ENABLED`, `CALENDAR_LOCATION`, `GOOGLE_CALENDAR_ENABLED`, `GOOGLE_CALENDAR_ADMIN_TOKEN`, `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI`, `GOOGLE_CALENDAR_ID`, `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY` |

Voice branch:

- OpenAI TTS: `TTS_MODEL`, `TTS_VOICE`;
- ElevenLabs speech/TTS: `ELEVENLABS_API_KEY`, plus
  `ELEVENLABS_VOICE_ID` for TTS; optional tuning names stay as documented in
  `.env.example`.

Never print values. The operator triggers deploy and live smoke.

# 14. Supabase MCP handoff

The MCP-enabled agent must discover its actual tool schemas before calling them.
Do not invent tool names.

## Read first

1. list/describe the seven current public tables;
2. confirm migrations match the repository;
3. read the demo workspace revision and schema version;
4. count outbox rows by status;
5. count Telegram events/deliveries by status;
6. read Google connection status without exposing token ciphertext;
7. export the current `demo_state` row as rollback evidence.

## Apply

1. apply the template/RPC migration;
2. load `msme-aircon-v1`;
3. inspect grants;
4. execute reset only against the allowlisted hackathon demo workspace;
5. never access any staging project;
6. for repeatable reset, never delete OAuth; the separately confirmed one-time
   full wipe in section 6.0 may delete it and then requires reconnection;
7. never print secrets.

## Verify

Use MCP read-only queries to prove every assertion in section 13.4 plus
`/readyz`.

## Database rollback

If the seed or migration is wrong:

1. stop;
2. restore the exported pre-reset workspace row;
3. roll back the migration through a reviewed forward migration if required;
4. do not mutate OAuth or resend Telegram messages;
5. rerun verification.

# 15. DigitalOcean MCP handoff

The MCP-enabled agent may inspect the operator-authorized hackathon demo app.
It must not access staging and must not trigger a deployment.

Read:

- app component and current deployment status;
- environment variable names, never values;
- health and readiness routes;
- current revision/version if exposed.

Verify after the operator deploys:

- `/healthz` responds;
- `/readyz` loads the seeded workspace;
- no restart loop;
- no reset command or service-role secret is exposed to the browser;
- the public app shows aircon seed after reset.

The operator owns:

- branch creation;
- commit/push;
- DigitalOcean deploy trigger;
- live Telegram and Google smoke timing.

# 16. Golden paths

Version/path matrix:

| Active SOP | Scenario | Expected |
|---|---|---|
| v1 | Routine general-service booking in section 16.1 | Correct RM99 booking |
| v1 | Poor cooling + musty smell in section 16.2 | Deliberate wrong RM99 reply -> Eval failure |
| v2 after Activate | Same combined symptoms | Correct RM160 chemical wash |
| v3 after Rollback | Same combined symptoms | v1 behavior restored for rollback proof |

## 16.1 Booking path

```text
Customer voice note:
"Hi boss, saya nak general service untuk satu wall unit 1.5 HP. Boleh datang?"

Agent:
"General service is fixed at RM99 for one supported unit. Which area and slot
do you prefer?"

Customer:
"SS2 PJ. Boleh kurang? Saturday 10 AM?"

Agent:
"The rate card is fixed, so I cannot add a discount. General service is RM99.
Saturday 10:00-12:00 is available."

Customer:
"Address is Unit DEMO-12, Jalan SS2 Demo, 47300 Petaling Jaya."

Agent:
"Please confirm Saturday 10:00-12:00 at Unit DEMO-12, Jalan SS2 Demo,
47300 Petaling Jaya."

Customer:
"Confirm."

System:
create_booking -> Google Calendar -> Telegram confirmation
```

## 16.2 Failure-learning path

```text
Customer:
"My 1.5 HP wall unit is not cooling and smells musty."

v1 wrong reply:
"General service is RM99."

Customer:
"That package is wrong. I said it is not cooling and smells musty."

Agent tool:
flag_autonomous_action_wrong

Chat:
Learning signal captured -> Open Eval case

Eval:
Human supplies:
"For poor cooling and a musty smell, I recommend the RM160 chemical wash
for one supported unit."
Run case -> fail against v1
Analyze failures -> exact correction proposed
Open Knowledge correction

Knowledge:
Review gutter-only diff
Approve -> inactive v2 candidate
Replay affected regression cases
Replay full regression + holdout suite
Ready -> Activate

Chat:
Ask again -> RM160 chemical wash

Knowledge:
Roll back -> immutable v3 restoring v1
```

# 17. Six-minute live demo

Every 20 seconds must show a capability, decision, or recovery.

Judging format from `docs/hackathon-annoouncements.txt`:

- six-minute demo;
- four-minute Q&A;
- optional two-minute lightning demo if shortlisted.

| Time | Show | Say |
|---|---|---|
| 0:00-0:20 | One problem slide | "Aircon operators lose bookings while they are on-site and cannot answer every chat." |
| 0:20-0:40 | Knowledge Files pane + rate card + disabled Rollback | "Business policy is inspectable Markdown, like AGENTS.md for operations. Rollback becomes available after the first activation." |
| 0:40-1:00 | Malay/English voice note | "Customers speak naturally; the agent extracts the minimum booking fields." |
| 1:00-1:20 | Fixed quote | "No haggling and no invented discounts." |
| 1:20-1:40 | Slot choice | "The agent only offers server-returned availability." |
| 1:40-2:00 | Calendar confirmation | "The result is a real booking artifact, not chat text." |
| 2:00-2:20 | Wrong v1 reply/complaint | "Now the important part: the agent gets the package wrong." |
| 2:20-2:40 | Chat learning banner | "A complaint becomes evidence, not an immediate global prompt edit." |
| 2:40-3:00 | Eval case | "A human supplies the expected answer because the agent cannot grade itself." |
| 3:00-3:20 | Failed Eval | "The current SOP fails against explicit evidence." |
| 3:20-3:40 | Proposed Knowledge diff | "The model proposes one exact Markdown rule." |
| 3:40-4:00 | Cursor-style gutter diff | "The owner reviews the actual line." |
| 4:00-4:20 | Affected replay | "First, test what this rule should fix." |
| 4:20-4:40 | Full replay/Ready | "Then protect every regression and holdout case. This changes Markdown policy, not model weights." |
| 4:40-5:00 | Activate | "Only a human can release shared policy." |
| 5:00-5:20 | Corrected Chat answer | "The next customer gets the RM160 chemical wash rule." |
| 5:20-5:40 | Rollback enabled/action | "The prior SOP remains recoverable as an immutable version." |
| 5:40-6:00 | Closing loop slide | "Fast booking, visible learning, governed release." |

# 18. Public demo video under three minutes

Use these nine cuts from sections 16 and 17: pain, voice note, quote/booking,
Calendar, complaint, Eval breadcrumb, Knowledge diff, replay/Activate/corrected
reply, Rollback. Omit architecture, code, reschedule/cancel, provider setup, and
competitor discussion.

Submission requirements:

- deadline: 18 July 2026 at 10:00 AM MYT;
- registered track/category: MSME Advantage;
- project description:
  `KaunterAI is a multilingual aircon service desk that books jobs and improves
  editable Markdown SOPs through Eval evidence, human activation, and rollback.`;
- public YouTube video under three minutes;
- working project built with Codex using GPT-5.6 and the registered
  Sol/Terra/Luna model variant; this implementation uses GPT-5.6 Sol;
- audio explicitly explains how Codex and GPT-5.6 accelerated the build;
- public repository link with LICENSE, or private access shared per the
  announcement;
- `/feedback` Session ID from the Codex session containing the majority of core
  functionality; run `/feedback` in Codex and copy the ID into the form;
- README setup, sample data, run instructions, and plugin/developer-tool testing
  instructions where applicable;
- README highlights where Codex accelerated workflow and key decisions;
- submit through the official form shared on event day;
- verify every public link before submission.

Source: `docs/hackathon-annoouncements.txt:14-35,73-106`. That announcement
contains two different private-reviewer email spellings; verify the official
submission form before sharing access instead of copying either unverified
address.

# 19. Slide contract

Use five slides.

## Slide 1: One sentence

```text
KaunterAI
The aircon service desk that learns through evidence, not silent prompt edits.
```

## Slide 2: Pain

```text
Owner is on-site.
Customers message several providers.
Slow reply loses the job.
Wrong policy loses trust.
```

## Slide 3: Product

```text
Telegram voice/text -> Markdown SOP files -> fixed quote -> Google Calendar
```

## Slide 4: Differentiator

```text
Complaint -> Eval -> Markdown diff -> Replay -> Activate -> Rollback
```

## Slide 5: Responsible autonomy

```text
Agent acts on bookings.
Humans release shared policy.
Every version is testable and reversible.
```

# 20. Second- and third-order effects

| Decision | Immediate effect | Later effect | Required control |
|---|---|---|---|
| Database-owned seed | Removes runtime fixture from source | Local no-Supabase fallback disappears | Use local Supabase or explicit setup state |
| Keep internal `patient` schema | Minimizes migration risk | Domain debt remains | Hide from UI; separate post-hackathon rename |
| Derived Chat banner | No schema migration | Lookup cost scales with Eval cases | Fine for demo; index only if measured later |
| Human Activate | Prevents unsafe global mutation | Adds one deliberate click | This is the product differentiator |
| Rollback creates new version | Full audit history | Versions grow | No pruning before hackathon |

# 21. Constraints and failure handling

- Do not edit while the current other agent is writing overlapping files.
- Do not use git reset, restore, checkout, stash, clean, rebase, merge, or commit.
- Do not deploy.
- Do not access staging.
- Do not modify `.env` or print secrets.
- Do not call Supabase or DigitalOcean until the implementing agent discovers
  the actual MCP schemas.
- Do not let a failed reset continue to external sends.
- Do not claim full end-to-end proof when providers are mocked.
- Do not expand the core demo after it is green.

If an implementation phase fails three times:

1. stop;
2. preserve the working state;
3. record the exact command/error;
4. return to the last green phase;
5. choose the smallest alternative.

# 22. Durable documentation ownership

Keep one owner per fact:

| Fact | Canonical home |
|---|---|
| Product and behavior contract | `PROJECT.md` |
| Visual/attention rules | `SOUL.md` |
| Setup, reset, deploy, demo testing | `README.md` |
| Agent/tool authority and learning boundary | `docs/autonomous-booking-agent.md` |
| Implementation sequence and temporary handoff | This `.tmp` file only |
| Rate card and operating policy | Supabase Knowledge seed |

After implementation:

1. replace stale healthcare current-state prose;
2. delete redundant passages instead of adding bridge text;
3. link to the canonical owner rather than restating it;
4. keep implementation history out of durable docs;
5. do not commit this `.tmp` handoff.

Handoff maintenance: each fact has one owner in sections 2, 5-8, 13, or 16.
Later sections point back instead of restating it. Delete duplicate prose rather
than adding bridge paragraphs.

# 23. Definition of done

The pivot is complete only when:

- Supabase owns `msme-aircon-v1`; production healthcare seed is absent;
- reset passes section 13.4 and leaves no orphaned Google event;
- learning glue and Rollback pass sections 13.1-13.2;
- gutter-only diff passes section 13.3;
- both section 16 paths work; v2 activates only after full replay and rollback
  creates v3;
- reschedule/cancel remain demo backlog;
- section 13.5 is green and provider proof is labeled separately;
- durable docs follow section 22 without duplicate sections;
- no commit, push, branch, or deploy occurs without operator instruction.

Start with Phase 0 only after re-reading this file, `.agents/CLAUDE.md`, current
git status, and every cited target file.

