---
project: KaunterAI
one_liner: "A multilingual clinic front desk where an autonomous Telegram agent handles administrative work and people govern playbook changes."
audience: "A product designer, engineer, or coding agent rebuilding the experience without access to the current implementation."
purpose: "Canonical, stack-agnostic product, spatial, and rebuild contract."
design_soul: "SOUL.md"
production_strategy: "PROJECT.md section 17"
status: "Canonical rebuild contract; the local synthetic baseline, shared Chat and server Eval runner, immutable Eval evidence, fixed-workspace CAS persistence, complete Knowledge candidate-to-Ready-to-activate-to-rollback lifecycle, and automatic Telegram text and transcribed-voice control flow are implemented. A newly persisted live-agent Telegram message creates a durable Postgres outbox job for the function-calling agent and reply. Single-admin Google Calendar OAuth filters candidate slots with FreeBusy and synchronizes booking create, reschedule, cancel, and persisted Schedule edits. The deterministic schedule is limited to non-live demo mode; live booking requires the Google connection. OpenAI remains the default speech provider and ElevenLabs direct STT/TTS can be selected independently. Dashboard authentication, EHR/PMS authority, and broader provider-quality validation remain outside the demonstrated slice."
implementation_scope: "The built scope includes versioned playbook snapshots, a server command boundary, Markdown-only SOP import, structured-output LLM correction proposals, inactive candidates, server sync and frozen execution of existing imported/manual Eval cases, affected train replay, full train-and-holdout readiness, human activation, immutable one-click rollback, inbound Telegram OGG/Opus-to-WebM transcription with a provider-selected OpenAI Whisper or ElevenLabs Scribe v2 adapter, English glossing, browser transcription recovery, real outbound translation, provider-selected TTS, recorded-voice fallback, idempotent Text, Voice, and Both delivery records, automatic replies through a durable Postgres outbox, and autonomous server-owned booking tools. It connects one admin Google Calendar with OAuth refresh-token encryption, FreeBusy candidate filtering, and event CRUD. Deterministic availability remains a non-live demo fixture; live booking fails closed without Google. It retains the existing no-provider deterministic Analyze fallback. Authentication, multi-user authorization, EHR/PMS authority, and live provider validation remain deferred."
created: "2026-07-08"
last_updated: "2026-07-17"
last_verified: "2026-07-17"
last_verified_scope: "Lint, typecheck, automated unit/component tests, production build, and Playwright verification. Focused tests cover booking revisions, Google FreeBusy filtering, Google event create/delete, migration access rules, and outbox retry state with mocked providers. They do not prove a real Google consent, Google event, Telegram receipt, or live provider quality."
verification_method:
  - "npm run lint, npm run typecheck, npm test, and npm run build"
  - "Mocked Telegram, provider-selected OpenAI/ElevenLabs speech, Eval, and release-workflow tests"
  - "DigitalOcean deployment, public health checks, live Supabase persistence, and protected Telegram inbound text and voice verification"
  - "Focused autonomous-tool and automatic-reply tests verify booking mutations, new inbound text -> one agent run -> one outbound delivery, duplicate suppression, and automatic handoff acknowledgement"
  - "Independent cold-read design, behavior, and causal-honesty audit"
routes:
  chat_control: "/"
  knowledge: "/knowledge"
  eval: "/eval"
schema_version: 4
theme: "Light mode only"
route_delivery_budget: "No individual route delivery artifact above 500 kB uncompressed"
contract_priority:
  - "User-visible behavior"
  - "Data integrity and causal honesty"
  - "Autonomous task authority, data integrity, and playbook release gates"
  - "Accessibility and responsive behavior"
  - "Reproducible verification"
  - "Replaceable implementation details"
stack_policy: "No framework, language, storage engine, editor, table, chart, or component library is required by this document."
synthetic_boundary: "All patients, messages, playbooks, and candidate outputs are synthetic. Tests use a simulated judge; configured local runs may use OpenAI and record that result as live LLM evidence."
production_gap: "The fixed demo workspace has live Supabase persistence, protected Telegram inbound delivery, a durable outbox, and optional one-admin Google Calendar synchronization, but no dashboard authentication, authorization, tenancy, multi-user coordination, EHR/PMS authority, or real-patient operating model. A real owner-controlled external-service smoke remains required."
---

# KaunterAI Product and Rebuild Contract

This file defines what the product does, what each state means, how the three routes connect,
and what must be verified before the rebuild is considered complete.

It deliberately does not prescribe a technology stack. A replacement implementation may use
different frameworks, storage, editors, tables, charts, and component libraries when every
observable requirement and acceptance gate in this document still passes.

## Read order and contract hierarchy

Read in this order:

1. `SOUL.md` sections 1 through 5 and 13 for the attention model and anti-generic rules.
2. This file's glossary and causal boundaries in sections 1 through 3.
3. The matching route contract in sections 7 through 9 before changing a page.
4. Section 19 before changing booking notifications or semantic judging.
5. Acceptance, verification-status, and unbuilt-surface sections 14 through 16 before claiming
   completion.
6. Section 17 before complete-target channel, hosting, or Meta planning.
7. Section 18 before editing this contract.
8. `README.md` for runbook, deploy topology, and event framing.

Rejected architecture options and the former demo-day / production-roadmap workbooks are
recoverable from git history only. They are not live build inputs.

When visual judgment conflicts with observable behavior, use the contract hierarchy below.

When two statements appear to conflict, use this order:

1. Safety and human approval boundaries.
2. Data integrity and causal boundaries.
3. User-visible behavior.
4. Accessibility and responsive requirements.
5. Deterministic fixture behavior.
6. Visual judgment from `SOUL.md`.
7. Reference implementation details outside this document.

This document defines the rebuild target. Runtime evidence must come from the implementation,
tests, build output, and browser checks once those artifacts exist. This document is not evidence
that a production backend, model, integration, or clinical workflow exists. Time-sensitive
provider capability, eligibility, pricing, and channel research live in section 17 of this
file. Deploy topology and env runbook live in `README.md`.

`SOUL.md` explains why the product has this shape. This file states what a conforming
implementation must show and do.

## Autonomous Telegram supersession

For a live Telegram administrative conversation, the agent is not a staff-gated draft generator.
It may independently reply, inspect supplied availability, create, reschedule, or cancel a booking
through schema-validated server tools. A human review is required to change the shared playbook
policy, not to approve an individual permitted booking action. The implementation and
[`docs/autonomous-booking-agent.md`](docs/autonomous-booking-agent.md) are authoritative for this
live path when older fixture-oriented language below says otherwise.

## 1. Glossary

### Synthetic demo

A local, deterministic product simulation. The demo behaves like a working application, but its
data and model behavior are generated from fixed fixtures. It does not contact patients, clinic
systems, model providers, or external services.

### Human-guided policy change

A person reviews Eval evidence and changes a shared agent policy before that policy is activated.
This document abbreviates human in the loop as HITL only after this definition. HITL does not gate
an individual administrative action available through the autonomous Telegram tools.

### Conversation

One patient thread containing:

- a patient record;
- channel;
- urgency;
- agent mode;
- workflow status;
- labels;
- ordered messages;
- an optional booking request.

Messages are authored by a patient, staff member, synthetic agent, or the system.

### Playbook file

One editable Markdown document that represents a clinic procedure or reusable response rule.
The demo starts with triage, Malay booking, and Mandarin prescription playbooks.

### Draft

Unsaved playbook content associated with one file. A draft overrides the saved content in the
editor but does not change the saved file until Save succeeds.

### Correction

A proposed replacement of one exact text fragment in one playbook file:

- old text;
- new text;
- evidence;
- current local state of pending, approved, or rejected;
- approved POC state of pending, accepted, or rejected;
- optional source evaluation case.

### Evaluation dataset

A named collection of criteria, cases, candidate version, and suite snapshots.

### Evaluation case

One test at the grain of one input conversation. It contains:

- train or holdout split;
- case type;
- language;
- input conversation;
- expected human HITL response;
- applicable scoring-rule identifiers;
- optional synthetic agent output;
- optional latest grade.

### Scoring rule

A reusable natural-language requirement for the LLM judge:

- human-readable name and instruction;
- required-to-pass flag;
- optional case-type scope;
- optional good and bad examples;
- version.

### LLM judge

The server-side evaluator that reads one synthetic candidate, the hidden expected staff response,
and the selected scoring rules. It returns Pass, Fail, or Needs review with one structured result
per scoring rule. The synthetic candidate generator cannot read the hidden expected response or
judge result.

### Train split

Cases eligible to diagnose failures and create Knowledge proposals.

### Holdout split

Cases used to check whether a candidate generalizes. Holdout cases never generate Knowledge
proposals.

### Candidate version

The synthetic agent version used by the Evaluation Lab. Higher versions select better fixture
templates in the current local baseline. It is not a deployed model version or POC release
authority. Analyze failures does not increment it.

### Suite snapshot

A point-in-time record of overall, train, and holdout results after a suite run.

### Saved-text verification

Check saved text is a local saved-text check. With the server release workflow configured,
Knowledge save, Markdown import, or correction acceptance creates an inactive version instead; only
affected train replay followed by a complete passing train-and-holdout suite can make it Ready. Neither
path changes the active playbook until a human activates it.

### Deep link

A route plus query parameters that opens the relevant dataset, case, import, playbook file, or
correction. Deep links must work on first navigation and when the query changes while the route
is already open.

## 2. Product intent and boundaries

Deferred table, binding MVP build order, capability matrix, and activation contracts: section 16.
POC access and deploy topology: `README.md`.

The built baseline demonstrates this human-supervision loop:

1. Staff handle multilingual clinic conversations in Chat Control.
2. A staff reply can become the expected response for a train evaluation case.
3. The server synchronizes the selected existing dataset before freezing a suite, so imported and
   manual cases run through the shared sandbox agent and judge when the release workflow is enabled.
4. A failed train case can create one pending LLM-generated exact Knowledge correction.
5. A human accepts that correction, a draft, or Markdown import into an inactive playbook candidate.
6. Replay all eval cases runs affected train cases first and continues to the all-case train and holdout replay only when they pass.
7. Only a complete passing all-case replay marks the candidate Ready.
8. A human activates the Ready candidate; subsequent Chat requests resolve the new active bundle.
9. Roll back creates a new immutable version from the immediately prior active SOP.

The product is intentionally small:

- exactly three top-level routes;
- one shared synthetic data model;
- one light theme;
- one canonical seed;
- local persistence;
- deterministic candidate outputs;
- deterministic judge fixtures in automated tests.

### What the built local demo proves

- The complete interaction design can be exercised locally.
- Staff can move from a conversation to an evaluation case.
- Evaluation evidence can point to a pending playbook correction.
- Human approval can change saved playbook content.
- The same state survives reloads and migrations.
- Desktop, mobile, keyboard, and accessibility behavior can be tested.

### What the built local demo does not prove

- Clinical correctness or regulatory compliance.
- Real model quality.
- Real-time patient messaging.
- Audio capture, speech recognition, or speech synthesis.
- Secure multi-user operation.
- Server durability or concurrency.
- Production latency, throughput, cost, or availability.
- Automatic model or agent improvement after Knowledge acceptance or activation.

The synthetic "Voice transcript" fixture is text labeled as a transcript and has no play control.
Live Telegram voice is a separate integration: it keeps the Telegram file reference, renders
playback plus recovery controls, and stores the transcript, detected language, and optional English
gloss. It must not imply that the application permanently stores the audio file itself.

### Patient-facing agent boundary

The target rebuild uses fixtures. Any future live patient-facing agent must:

- continue only admin-safe work automatically;
- use only supplied, schema-validated administrative tools for booking changes;
- never diagnose, recommend medication, interpret results, or claim medical certainty;
- refuse clinical answers and recommend in-person assessment for non-emergency medical questions;
- direct urgent or emergency-like cases to immediate care;
- autonomously acknowledge and route clinical or emergency concerns; ask the patient, rather than
  staff, for routine-booking clarification;
- preserve the user's active language mix, names, locations, and time expressions;
- ask one useful question at a time when information is missing;
- pass tools only values learned from the user or current state;
- never invent identifiers, branches, slots, or policy facts;
- treat tool errors as constraints, not suggestions.

## 3. System map and causal boundaries

```text
+----------------------- Shared synthetic state -----------------------+
| conversations | playbook files | corrections | eval datasets | runs |
+------------------+-------------------+-------------------+-----------+
                   |                   |                   |
                   v                   v                   v
             Chat Control           Knowledge            Evaluation Lab
                  /                /knowledge                /eval
                   |                   ^                   |
                   | latest staff     | pending           | failed
                   | reply            | correction        | baseline
                   +----> HITL case ---+<---- proposal ----+ train case
```

### The most important causal boundary

Failure analysis and the Knowledge correction lifecycle are related but separate:

- Analyze failures reads committed failed train runs and may add pending corrections.
- Analyze failures does not rerun cases, increment a candidate version, or claim the agent improved.
- Knowledge correction acceptance creates inactive candidate content.
- Acceptance does not change the active playbook or retroactively change Evaluation Lab scores.
- Activation changes the active playbook only after a full train and holdout suite is Ready.
- Evaluation success does not auto-approve or deploy a correction.
- A correction remains pending until a human explicitly decides it.

The UI must state this boundary anywhere an operator could confuse sandbox evidence with promoted
playbook behavior.

## 4. Sources of truth and data lifecycle

| Layer | Owns | Does not own |
|---|---|---|
| Canonical seed | Initial conversations, files, corrections, dataset, cases, criteria | Runtime selections and drafts |
| Domain rules | Judge-request construction, verdict policy, proposal mapping, correction application, metrics | Storage and visual layout |
| Transport schemas | Persisted-state, backend-bound domain-state, judge-request, judge-response, and typed-error validation | Business decisions and visual layout |
| Repository boundary | Load and save of persisted demo state | Business decisions and session UI state |
| Persisted demo state | User-created data, edits, decisions, grades, snapshots, valid selections | Temporary dialogs, drawers, and active requests |
| Session UI state | Open pane, open dialog, active drawer, request progress, and cancellation | Durable product data |
| UI | Input, rendering, navigation, feedback | Canonical business truth |

### Schema and migration

The persisted schema version is 4.

Migration requirements:

1. Versions 1 through 3 migrate to version 4 without wiping valid conversations, playbooks, or
   user-created evaluation cases.
2. Legacy exact-text criteria become versioned natural-language scoring rules.
3. Incompatible legacy grades, run history, and suite snapshots are cleared instead of being
   presented as semantic-judge evidence.
4. The migrated version 4 state is saved immediately and a one-time status message names the
   cleared evaluation evidence and preserved product data.
5. Existing bookings gain a positive revision used to reject stale edits.
6. Unknown versions reseed, save the recovered version 4 state, and show a one-time recovery notice.
7. Malformed data follows the same explicit recovery path.
8. A selected conversation, file, or dataset identifier that no longer exists falls back to the
   first valid entity or null when none exists.
9. Migration output must satisfy the current schema before the application renders it.

### Reset

Reset Demo:

- restores a deep copy of the current six-case local seed;
- clears playbook drafts;
- clears saved-text verification results;
- clears run history and suite snapshots;
- restores first valid selections;
- restores default search and filter state;
- closes route-local running states without promoting the reset message into a persistent,
  full-width success highlight;
- never mutates the canonical seed object.

The design-only POC reset restores its five approved seed cases and replaces only entities marked
synthetic. It preserves Telegram conversations, Telegram delivery records, and real Eval cases
imported from Chat.

## 5. Canonical fixture inventory

### 5.1 Seed conversations

| Patient | Channel | Language | Queue role | Important state |
|---|---|---|---|---|
| Ahmad bin Hassan | WhatsApp | English | Emergency | Chest pain, in progress, synthetic agent initially active |
| Nurul Aisyah | WhatsApp | Malay | Booking details | Autonomous agent asks for the date and time before it can book |
| Mei Lin Tan | Voice transcript | Mandarin | AI handling | Prescription renewal; English gloss is available |
| Rajesh Kumar | SMS | English | Done | Resolved lab-results conversation; agent mode off |

Every patient has a name, phone number, medical record number, and preferred language.

### 5.2 Simulated intake scenarios

The Simulate Patient dialog appends one deterministic conversation for each selected scenario:

1. Emergency chest pain.
2. Malay booking request.
3. Mandarin voice transcript.

Each simulated conversation has a collision-safe identifier, appears at the top of the inbox,
becomes selected, and clears search and restrictive filters so the new row is visible.

### 5.3 Seed playbooks and corrections

| Playbook | Pending correction |
|---|---|
| Triage | Add immediate 999 guidance for chest pain with sweating |
| Malay booking | Add SMS confirmation before closing the conversation |
| Mandarin prescription | Require GP approval as well as dispense-history verification |

All three corrections start pending and link to their train evaluation case.

### 5.4 Evaluation seed datasets

The current local synthetic baseline contains:

- 3 train cases: English emergency, Malay booking, Mandarin prescription;
- 3 holdout cases: English lab follow-up, Malay triage, Mandarin booking;
- 4 natural-language scoring rules: emergency direction, respectful tone, booking next step, and
  prescription safety;
- candidate version 1;
- no suite snapshots;
- no run history;
- no prefilled synthetic output or grade.

The approved POC seed is design-only and contains exactly five cases:

- Train: Malay appointment booking;
- Train: Mandarin Chinese prescription renewal;
- Train: English emergency symptoms;
- Holdout: English clinic-hours question;
- Holdout: Tamil lab-result follow-up.

Both seeds are explicitly synthetic. Synthetic reset restores the approved five POC cases without
deleting Telegram data or real Eval cases.

## 6. Shared application shell

The shell provides:

- KaunterAI brand;
- navigation for Chat Control, Knowledge, and Evals;
- a visible Synthetic Demo label at every width, shortened to Demo only when space requires;
- Reset Demo;
- an accessible route-loading status;
- one consistent light visual language.

### Shared spatial frame

At 1440px, the shell and every route use the same top-level frame:

```text
+----------------------------------------------------------------------------+
| 54px shell: KaunterAI | Chat Control | Knowledge | Evals | Synthetic Demo | Reset|
+----------------------------------------------------------------------------+
| 46px route toolbar: one h1 | current context | direct actions | More        |
+----------------------------------------------------------------------------+
|                                                                            |
| task-specific workbench = calc(100dvh - 100px)                             |
|                                                                            |
+----------------------------------------------------------------------------+
```

Spatial rules:

- The shell height is 54px.
- Each route fills the viewport below the shell.
- A route title lives inside its toolbar. There is no separate title, subtitle, or breadcrumb
  hero above it.
- Primary work surfaces use panes, rows, or a dense table. They do not start with a card grid.
- Each pane names one vertical scroll owner. Nested competing scroll regions are not allowed.
- The document body does not become the primary scroll container on desktop.
- Region boundaries use one-pixel separators. Shadows are reserved for overlays.
- A non-modal drawer starts below the shell when global navigation must remain usable.
- The normative browser frames are 1440 by 900, 390 by 844, and 320 by 568 CSS pixels.
- `First viewport` means the visible route area after the 54px shell at the initial scroll position.

The page frames in sections 7.2, 8.12, and 9.2 are normative targets for a conforming rebuild.

Route-specific collapse points are deliberate and must not be replaced by one universal
"mobile" breakpoint:

| Route or shell | Wide | Middle | Narrow |
|---|---|---|---|
| Shell | 760px and wider: labels visible | Not applicable | Below 760px: icon-sized navigation with accessible names |
| Chat Control | 1100px and wider: list, thread, rail | 760px to 1099px: 240-280px list, thread at least 480px, rail drawer | Below 760px or when the thread floor cannot fit: one-pane sequence |
| Knowledge | 1200px and wider: 230px files, editor, 320px changes | 1000px to 1199px: 190px files, editor at least 480px, 280px changes | Below 1000px: one visible tab panel |
| Evals | 1200px and wider: main case work plus score-summary rail | 900px to 1199px: score summary above main work | Below 900px: compact summary, filters, case cards; chart in History drawer |

### Route loading and performance

- Each route loads on demand.
- Hovering or focusing a navigation item may preload its route.
- Loading Chat Control must not fetch delivery assets used only by Knowledge or Evals.
- Knowledge and Eval delivery assets may load after route intent is known.
- No individual route delivery artifact may exceed 500 kB uncompressed.

### Small-screen shell

At narrow widths:

- navigation uses icon-sized controls with accessible names;
- each target is at least 44 by 44 CSS pixels;
- the compact Demo label remains visible;
- Reset remains reachable;
- route content starts below the shell;
- drawers and overlays do not block shell navigation unless they are intentionally modal.

### Shared action taxonomy

| Route | Primary | Secondary | Contextual | Maintenance |
|---|---|---|---|---|
| Chat Control | Send in an active thread | Resolve or Reopen, booking decision, emergency escalation | Back, Details, agent mode, patient edit, Eval and Knowledge links | Search, Filter, Schedule, Simulate Patient |
| Knowledge | Accept inside one pending correction | Reject, Save, Check saved text, Activate when Ready | Correction-card focus, file selection, source Eval link, Run Again | New File, Rename, Delete, Discard |
| Evaluation Lab | Run Case when selected; otherwise Run all cases | New manual test, Analyze failures, Import conversations | Open test, Cancel active request, linked Knowledge correction | Dataset CRUD, scoring-rule CRUD, test Duplicate and Delete |

Only the current primary uses the filled petrol action. Secondary actions are bordered or text
actions. Contextual actions stay beside the object they affect. Maintenance moves to More before
any task action does.

## 7. Chat Control contract

This section owns observable Chat UI, jobs, layout, and staff behavior. Live Telegram, voice,
and send-path product rules for the remaining MVP live in section 16. Deploy and env setup:
`README.md`.

### 7.1 User jobs

Staff use Chat Control to:

1. See which conversations need attention.
2. Search and filter the queue.
3. Read one patient thread.
4. Reply to the patient or add an internal note.
5. Change agent mode.
6. Resolve or reopen a conversation.
7. Review and update patient details.
8. Approve or reject a booking.
9. Escalate an emergency.
10. Add or remove labels.
11. Inspect the synthetic schedule.
12. Simulate a new patient.
13. Send staff HITL evidence to Evals or open the relevant Knowledge playbook.

### 7.2 Layout modes

| Width | Layout |
|---|---|
| 1100px and wider | Conversation list, thread, and patient rail visible together |
| 900px to 1099px | 280px list and thread at least 480px; patient rail opens as a drawer |
| 760px to 899px | 240px list and thread at least 480px; patient rail opens as a drawer |
| Below 760px or when the 480px thread floor cannot fit | One pane at a time: list, thread, or patient rail |

Mobile pane sequence and reading order:

```text
list -> select conversation -> thread -> Details -> patient rail
                  thread -> Back -> list
             patient rail -> Close -> thread
```

The list reads group label, patient name, full timestamp, preview, then metadata. The thread reads
patient identity, newest unread patient message, transcript history, then composer. Details reads
patient identity, synthetic triage guidance, booking, labels, then cross-route links.

#### 1440px reference frame

```text
+--------------------------------------------------------------------------------+
| 46px toolbar: Chat Control + count | Inbox/Schedule | search | filters | simulate|
+------------------+------------------------------------------+--------------------+
| queue 300px      | selected conversation, minmax(0, 1fr)    | context 300px      |
| 44px pane head   | 52px thread header                       | 44px pane head     |
|                  |                                          |                    |
| grouped rows     | message history scrolls                  | patient details    |
| queue scrolls    | one 68ch transcript column               | triage guidance    |
|                  |                                          | booking + labels   |
|                  +------------------------------------------+ Eval/Knowledge links   |
|                  | composer pinned to pane bottom, min 108px| rail scrolls       |
+------------------+------------------------------------------+--------------------+
| workbench height = calc(100dvh - 100px)                                          |
+--------------------------------------------------------------------------------+
```

The conversation is the dominant region. The queue and patient rail remain narrow context
columns. The three columns never become equal-width cards.

Desktop reading order is toolbar, selected queue row, newest patient message, composer, then
patient context. The shell, route toolbar, thread header, and composer remain fixed. Only the
three named pane bodies scroll.

#### 760px to 1099px reference frame

```text
+------------------------------------------------------------------------+
| 46px route toolbar                                                     |
+------------------+-----------------------------------------------------+
| queue 240-280px  | selected conversation, minimum 480px                 |
| rows scroll      | 52px header | messages scroll | 108px composer      |
+------------------+------------------------------------+----------------+
| Details opens a 320px drawer below the shell; drawer body scrolls      |
+------------------------------------------------------------------------+
```

#### 390px reference frame

```text
+------------------------------------------+ 390px
| 54px: K | C | D | E | Demo | Reset      |
+------------------------------------------+
| 44px: Chat Control + count | Simulate    |
| 44px: Inbox               | Schedule     |
| 44px: Search              | Filter       |
+------------------------------------------+
| 48px active pane heading                 |
+------------------------------------------+
| one rendered pane                        |
| list: 72px minimum rows                  |
| thread: message history scrolls          |
| details: patient context scrolls         |
|                                          |
+------------------------------------------+
| thread only: composer pinned, min 104px  |
+------------------------------------------+
```

At 390px, Simulate Patient and Filter remain direct because all three toolbar rows fit without
wrapping. The active pane is list, thread, or details. Selecting a row opens thread. Details opens
patient context. Back and Close return exactly one step.

#### 320px reference frame

```text
+----------------------------------+ 320px
| 54px: K|C|D|E|Demo|Reset         |
+----------------------------------+
| 44px: Chat Control + count | More|
| 44px: Inbox            | Schedule|
| 44px: Search                    |
+----------------------------------+
| 48px active pane heading         |
+----------------------------------+
| one rendered pane                |
| list: name shrinks before time   |
| thread: messages scroll          |
| details: context scrolls         |
|                                  |
+----------------------------------+
| thread: composer pinned, 112px   |
+----------------------------------+
```

At 320px, More contains Filter and Simulate Patient. Inbox, Schedule, Search, Back, Details, Send,
and the current pane's primary task action remain direct. The toolbar uses explicit rows and never
relies on accidental wrapping.

#### Schedule view frames

```text
1440px
+----------------------+---------------------------------------------------------+
| day index 220px      | selected day + schedule-source badge                     |
| 7 rows, date + count | 44px row: time | patient | status                       |
| index scrolls        | booking rows scroll; selecting patient returns to Inbox |
+----------------------+---------------------------------------------------------+

390px
+------------------------------------------+
| 44px day selector | schedule-source badge |
| booking row: time + patient              |
| status                                   |
| one list scrolls                         |
+------------------------------------------+

320px
+----------------------------------+
| 44px Day select | source badge   |
| booking row: time + patient      |
| reason                           |
| state on its own metadata line   |
| one list scrolls                 |
+----------------------------------+
```

Schedule uses compact booking rows, not calendar cards, a month grid, or a colored planning
dashboard. The selected patient returns to the Inbox thread at every width.

#### Scroll and region ownership

| Region | Fixed within the region | Scroll owner |
|---|---|---|
| Queue | 44px pane heading | Group labels and conversation rows |
| Thread | 52px thread header and 108px desktop or 104-112px mobile composer | Message history |
| Patient context | 44px rail heading and close action when present | Details, triage, booking, labels, and links |
| Schedule | Route toolbar and day selector | Booking rows |

#### Conversation-row anatomy

```text
+------+----------------------------------------------+
| 32px | patient name................ full timestamp |
| icon | one-line latest message or English gloss    |
|      | [language] [state] [pending slot]            |
+------+----------------------------------------------+
```

- The row spans the full queue width. It is not a floating card.
- The avatar never shrinks.
- The body uses the remaining width and allows text to shrink.
- The timestamp is a max-content column and never truncates.
- The patient name and preview ellipsize before the timestamp moves.
- The preview uses one line.
- Status chips remain metadata. They do not become large callouts.
- The selected row uses the selected surface and a 2px petrol leading edge.
- Emergency uses labeled risk text and weight, not a filled red row.
- Hover uses the quiet surface with no shadow or floating-card treatment.

#### Message-row anatomy

```text
+----------------------------------------------------------------+
| Patient | 10:42                                                |
| Saya sakit dada dan berpeluh sejak pagi.                       |
| English translation: I have had chest pain and sweating.       |
+----------------------------------------------------------------+
| Synthetic agent | 10:42 | Synthetic Demo                       |
| Please seek urgent care now. This demo did not contact 999.    |
+----------------------------------------------------------------+
| System audit                                                   |
| Agent mode changed to Off by staff.                            |
+----------------------------------------------------------------+
```

- Patient messages render as compact left-aligned bubbles. Staff and synthetic-agent replies
  render as compact right-aligned bubbles.
- Patient, staff, and synthetic agent roles remain explicit in text.
- The transcript uses a readable 68ch maximum while each message row spans that transcript.
- English gloss sits directly below source text and never replaces it.
- Internal notes use the warning surface and an "Internal note" label.
- System audits stay centered with muted text, a dashed border, and a lock icon.
- Synthetic voice-transcript messages show a Transcript label and no play icon. Live Telegram
  voice messages expose playback, retry, and manual-transcript recovery controls.
- Every synthetic-agent row repeats the visible `Synthetic Demo` marker.
- A synthetic reply that refers to outreach or escalation states in that row that no external
  person or service was contacted.

#### Attention and action order

1. Emergency and needs-approval queue groups.
2. The newest patient message in the selected thread.
3. Reply or Internal Note and Send.
4. Resolve, reopen, booking, escalation, and patient-context actions.
5. Search, filters, Schedule, and Simulate Patient.

Send is the primary action inside an active thread. Simulate Patient is a demo utility and must
not visually outrank patient work once a conversation is selected.

#### State presentation

| State | Required presentation |
|---|---|
| Route loading | Shell-level inline loading status; no full-page skeleton |
| Filter has no matches | Queue shows "No conversations match this search or filter."; thread and rail show no stale patient |
| No selected conversation | Centered inline text in the thread region; composer absent |
| Send running | Send is replaced by Sending; duplicate send is blocked; draft remains visible until commit |
| Send blocked | Composer names the reason beside the disabled Send action, including resolved or emergency-handoff state |
| Send error | Persistent inline copy names the failed send and keeps the draft; a toast may repeat but not replace it |
| Send canceled by conversation change | No message commits; the old draft is cleared before the new patient renders |
| Hidden or deleted selection | First visible conversation is selected or the thread clears; no stale patient remains |
| Resolved conversation | Resolution state in header; composer disabled; Reopen visible |
| Patient edit running | Rail shows Saving beside the field actions; changing patient cancels the uncommitted edit |
| Patient edit blocked or invalid | Inline field error remains; stored patient values do not change |
| Patient edit canceled | Rail restores the last saved values |
| Simulation running | Dialog action reads Adding synthetic patient and cannot submit twice |
| Simulation canceled | Dialog closes and conversation state remains unchanged |
| Simulation succeeds | New row selected and visible; short polite status |
| Schedule empty | "No synthetic bookings in this seven-day window."; day selection remains available |
| Schedule stale patient link | Row remains readable; selecting it shows a recoverable missing-conversation error |
| Emergency escalation requested | Confirmation states that the agent will turn off and no person or emergency service will be contacted |
| Destructive or consequential mutation | Confirmation names the exact effect before Resolve, Reject booking, or Escalate commits |
| Mutation fails | Persistent inline feedback names the failed action and recovery; no silent no-op |

#### Forbidden substitutions

Global anti-generic rules live in `SOUL.md` section 13. Chat-specific bans:

- No inbox KPI cards.
- No CRM-style patient card gallery.
- No floating compose button.
- No full-screen patient profile on desktop.
- No calendar hero above the inbox.
- No equal-width three-column dashboard.

### 7.3 Toolbar

The toolbar contains:

- "Chat control" title;
- count of conversations visible after current search and filter;
- Inbox and Schedule view switch;
- search;
- filter;
- Simulate Patient.

Desktop filters are direct choices:

- All;
- Needs review;
- AI handling;
- Resolved.

Mobile uses one labeled select control for the same values.

Direct and overflow rules:

- 390px and wider: Inbox, Schedule, Search, Filter, and Simulate Patient remain direct.
- 320px: Inbox, Schedule, and Search remain direct; Filter and Simulate Patient move to More.
- Reply, Internal Note, Send, Back, Details, Resolve or Reopen, booking decisions, and emergency
  escalation never move into the route-level More menu while their owning pane is visible.
- More contains only the two named demo or queue-maintenance actions. It is not a hidden second
  navigation system.

### 7.4 Queue grouping

Groups appear in this order:

1. Emergency.
2. Booking details.
3. Waiting.
4. Autonomous agent.
5. Done.

Empty groups are hidden.

Each row shows:

- patient initials;
- patient name;
- full latest-message date and time;
- preview, preferring an English gloss when available;
- language;
- workflow or agent status;
- pending booking indicator when applicable.

At narrow widths, the patient name and preview may truncate. The timestamp must remain fully
visible.

### 7.5 Search and filters

Search is case-insensitive and checks:

- patient name;
- labels;
- message text;
- English gloss.

When search or filter hides the selected conversation:

- select the first visible conversation;
- select null when no conversation remains;
- never leave the thread showing a hidden conversation.

### 7.6 Conversation thread

The thread header shows:

- patient name;
- channel;
- urgency;
- language;
- fixed fixture date labeled `Synthetic Demo`;
- agent mode controls;
- Resolve or Reopen;
- Details on tablet and mobile.

Messages distinguish patient, staff, synthetic agent, and system roles.

Non-English messages show an English gloss when present.

A synthetic voice-transcript channel shows a transcript label and does not imply audio. A live
Telegram voice message additionally exposes playback and bounded staff recovery controls, without
implying permanent local audio storage.

Message and queue timestamps use the fixed fixture timeline and show absolute date and time when
space allows. They never use `today`, `just now`, or other copy that implies live audit history.

Agent mode has two states: Autonomous demo agent and Staff only.

- Changing mode updates only the selected conversation.
- Emergency escalation forces Staff only.
- Resolved conversations show the saved mode but disable the control.
- A successful change appends a system audit row.
- A failed change leaves the prior mode selected and shows persistent inline feedback.

### 7.7 Composer

The composer supports:

- patient-facing reply;
- internal note;
- send button;
- platform keyboard send shortcut.

Rules:

- trim whitespace before sending;
- reject an empty message;
- store an internal note as a system message with an explicit internal prefix;
- block sending while the conversation is resolved;
- clear draft text and reset to Reply when the selected conversation changes;
- never allow a draft for patient A to be sent to patient B.

### 7.8 Resolve and reopen

Resolve:

- sets the workflow to resolved;
- records a resolved timestamp;
- disables the composer;
- moves the conversation to Done.

Reopen:

- is available only for a resolved conversation;
- restores in-progress status;
- clears the resolved timestamp;
- re-enables the composer.

### 7.9 Patient rail

The rail contains:

- patient details;
- editable name, phone, and preferred language;
- triage guidance;
- booking information and actions;
- labels;
- emergency escalation when applicable;
- Eval and Knowledge links.

Changing conversations cancels an unfinished patient edit. Saving must never apply patient A's
form values to patient B.

Patient edit:

- Edit reveals Save and Cancel in the rail heading.
- Name and phone cannot be empty after trimming.
- Save shows a local running state and commits all valid fields together.
- Validation or save failure leaves the draft visible and the saved record unchanged.
- Cancel restores the saved values.

Triage guidance:

- comes only from the selected synthetic patient fixture;
- is read-only and labeled `Synthetic triage guidance`;
- never claims to be a clinical protocol or live recommendation;
- shows `No synthetic triage guidance for this patient.` when absent.

Labels:

- Add Label opens a bounded picker inside the rail.
- Adding an existing label is a no-op with explanatory copy.
- Removing a label requires no confirmation but remains reversible until the local mutation commits.
- A failed add or remove preserves the stored labels and shows inline feedback.

### 7.10 Booking

A booking has a slot, reason, revision, and one of four states: pending, approved,
rejected, or cancelled. The revision rejects an edit when the booking changed after the editor
opened.

Approve, Reject, Edit, and Cancel:

- preview the exact patient-visible message before a consequential decision or edit;
- update status or details and increment revision;
- append one patient-visible staff message in the patient's preferred language, defaulting to
  English when the preference is missing or unknown;
- retain an English gloss for staff when that message is not English;
- append a separate system audit message;
- format the slot in the `Asia/Kuala_Lumpur` time zone;
- preserve the prior conversation;
- commit no partial state when validation, stale revision, or notification preview fails.

The edit action is **Save and notify** and remains disabled until a patient-facing fact changes.
A pending edit is described as an updated request. An approved slot change is described as a
reschedule. An approved reason change is described as updated appointment details.
Reject applies only to a pending request. Cancel applies only to an approved appointment.
Every booking action that uses "notify" adds a message to the local synthetic thread only. It does
not claim delivery through WhatsApp, Telegram, SMS, email, or any external patient channel.

Rejected and cancelled bookings do not appear in Schedule. Pending and approved bookings do.

### 7.11 Emergency escalation

Escalation is available only for an emergency conversation.

Before commit, confirmation states: "This turns off the synthetic agent and keeps the thread with
staff. This demo does not contact a nurse, ambulance, 999, or any external service."

It:

- turns the synthetic agent off;
- keeps the conversation active for staff;
- appends a system audit message;
- never claims that a nurse, ambulance, or external service was actually contacted.

The safety copy tells staff to escalate emergencies and not promise medication without chart
review. It is demo guidance, not a clinical protocol.

### 7.12 Schedule

Schedule is a seven-day demo board. Google Calendar may filter its candidate slots and receive
persisted Telegram booking changes when an admin has connected it.

It:

- starts from the fixed demo week;
- shows either `Demo schedule fallback` or `Google Calendar synced` beside the selected day;
- groups visible bookings by day;
- shows time, patient, and status;
- labels empty days honestly;
- opens the selected conversation when a patient is chosen;
- excludes rejected and cancelled bookings.

### 7.13 Simulate Patient

Simulation:

- opens an accessible dialog;
- clearly states that the data is synthetic;
- appends one deterministic conversation;
- clears search;
- resets the filter to All;
- returns to Inbox;
- selects the new conversation;
- opens the thread pane on mobile;
- shows a short success status.

## 8. Evaluation Lab contract

This section owns observable Eval UI, case types, generation boundary, and staff behavior.
Candidate Ready gates and activation prerequisites live in section 16.

### 8.1 Purpose

The Evaluation Lab compares a synthetic candidate response with:

- explicit natural-language scoring rules;
- a human HITL reference response.

It provides sandbox evidence. Candidate generation remains synthetic and deterministic. Judging
uses the same-origin server endpoint: configured local runs call OpenAI, while automated tests
inject a simulated judge and label its metadata as simulated.

### 8.2 Case types

Supported types:

- emergency triage;
- booking;
- prescription;
- lab follow-up;
- general.

New HITL imports infer a type from conversation labels and urgency.

### 8.3 Generation boundary

The redacted case input may contain:

- case identifier;
- title;
- type;
- language;
- input conversation;
- criterion identifiers.

The generator receives the candidate version but does not receive scoring-rule instructions,
examples, or hidden reference text.

It must not receive:

- expected human response;
- previous synthetic output;
- previous grade;
- judge rationale;
- scoring-rule instructions or examples.

The generation boundary must reject forbidden fields rather than silently ignore them.

### 8.4 Scoring-rule resolution

Each case can name scoring-rule identifiers.

- When identifiers are present, only those criteria apply.
- When the list is empty, all dataset criteria apply.
- New imported cases receive type-relevant scoring rules.
- A scoring rule cannot be deleted while any case references it.
- Scoring-rule names and instructions cannot be empty after trimming.
- A semantic edit increments the scoring-rule version.
- Each scoring rule can be required to pass and can include optional good and bad examples.

### 8.5 Semantic LLM judge

For one case:

1. Generate the candidate without the expected response or scoring-rule text.
2. Build a bounded request containing the conversation, candidate, hidden expected response, case
   metadata, and selected versioned scoring rules.
3. Ask the server-side LLM judge for one Pass, Fail, or Uncertain result per rule.
4. Validate that every selected rule appears exactly once.
5. Validate every non-null evidence quote against the candidate response.
6. Derive Fail when any required rule fails.
7. Derive Needs review when no required rule fails and at least one required rule is uncertain.
8. Otherwise derive Pass.
9. Persist the overall verdict, numeric supporting score, rationale, per-rule evidence, and judge
   metadata only after the full response validates.

No regular expression, substring, exact phrase, token overlap, or embedding threshold decides
semantic response quality. The score is supporting evidence, not a clinical-quality metric.

### 8.6 Dataset metrics

All metrics refer to the currently selected dataset and latest grade stored on each case.

| Metric | Source | Predicate | Grain | State window | Negative boundary |
|---|---|---|---|---|---|
| Overall pass | Selected dataset cases | latest grade exists and pass is true | case | Current stored case state | Ungraded cases remain in the denominator and count as not passed |
| Train pass | Selected dataset train cases | latest grade exists and pass is true | train case | Current stored case state | Does not include holdout |
| Holdout pass | Selected dataset holdout cases | latest grade exists and pass is true | holdout case | Current stored case state | Never generates proposals; gates release readiness |
| Mean judge score | Selected dataset cases | latest grade exists | graded case | Current stored case state | Ungraded cases are excluded |
| Last run delta | Selected dataset suite snapshots | latest overall pass percent minus prior | snapshot pair | Latest two snapshots | Not available before two snapshots |

Pass percentages are rounded whole percentages.

### 8.7 Case run

Run Case:

- loads the frozen case and runs the shared agent in sandbox mode;
- grades the resulting candidate;
- appends an immutable attempt only after the agent and judge artifacts validate;
- blocks other evaluation mutations while the request is active;
- exposes Cancel while running;
- preserves prior attempts when canceled;
- aborts the judge request when Cancel, Reset, route unmount, or dataset change invalidates it;
- shows a persistent, retryable error when the judge is unavailable or returns invalid evidence.

### 8.8 Suite run

Run all cases:

- freezes the selected case, rubric, playbook, agent, and judge configuration into one suite
  snapshot;
- sends one bounded case request at a time from the browser;
- appends one immutable attempt after each completed case;
- shows completed-case progress from committed attempts;
- prevents duplicate concurrent requests for the same case;
- continues from the next unfinished case after a browser close or failed request.

Cancel aborts only the active request. Completed attempts remain.

### 8.9 Analyze failures

The current built path is the deterministic taxonomy fallback described in section 15. The input
and behavior below define the remaining LLM proposer target.

Input:

- committed failed train attempts from the selected suite;
- their structured judge evidence and pinned playbook versions.

Behavior:

1. Read the committed failed train evidence without rerunning the agent or judge.
2. Ask a dedicated LLM correction proposer for one structured exact-anchor edit with rationale and
   evidence.
3. Validate the schema, target playbook version, evidence references, and exactly one `oldText`
   match.
4. Use the deterministic failure taxonomy when the proposer times out or returns an invalid or
   unsafe patch.
5. Create or find pending Knowledge corrections with source-case and source-run evidence.
6. Commit the pending corrections atomically.

Analyze failures has no target pass rate, iteration count, suite rerun, candidate-version change,
accepted playbook edit, or activation step. The proposer may draft a pending edit, but the visitor
still owns Accept, Reject, Check saved text, Activate, and Rollback. Holdout cases never generate
proposals.

Proposal generation:

- only uses failed train cases;
- returns one bounded replacement rather than a full-file rewrite;
- includes `fileId`, `oldText`, `newText`, rationale, and evidence;
- skips unsupported case types when no deterministic fallback exists;
- deduplicates by correction identifier and source case;
- never auto-accepts or activates a correction.

### 8.10 HITL import

An import candidate is a resolved conversation with at least one staff reply. The import dialog
uses a checkbox list, not a select dropdown. The user may choose one, several, or all available
conversations before one import action.

Import uses:

- the latest staff message as expected human output;
- all preceding non-system messages as input;
- Train split, stored as `train`;
- staff message language;
- type inferred from labels and urgency;
- type-relevant scoring rules;
- source conversation identifier.

The source conversation identifier and the same input-message identifiers plus expected staff text
guard against duplicates. Re-importing the same conversation or HITL example is rejected.

Import states:

- unresolved: row is disabled and says **Resolve in Chat**;
- no staff reply: row is disabled and says **No staff reply**;
- already imported: row remains visible, is disabled, and says **Already imported**;
- ready: row is selectable and says **Ready**;
- submitting: Import is replaced by Importing and cannot submit twice;
- duplicate: persistent inline copy identifies the existing case;
- canceled: dialog closes and no case is created;
- one imported: dialog closes, selects the new test, and opens its evidence;
- several imported: dialog closes and returns to the unselected test list.

Batch import is atomic. If any selected conversation becomes invalid before commit, none of the
selected conversations imports.

### 8.11 Dataset, scoring-rule, and case CRUD

Dataset:

- create empty synthetic dataset at candidate version 1;
- rename;
- delete only when it is not the protected seed and not the last dataset;
- confirm before delete;
- deleting a dataset removes its run history.

Scoring rule, stored as a criterion:

- add;
- edit;
- describe what a good reply should do in plain language;
- choose whether the rule is required to pass;
- optionally add good and bad examples under Advanced;
- optionally scope the rule to case types;
- increment its version when semantic behavior changes;
- show how many tests use the rule;
- delete only when no test references it;
- reject empty names and instructions;
- keep stored values unchanged when validation fails;
- show an inline error when deletion is blocked.

Test, stored as a case:

- create one single-message manual replay;
- edit;
- duplicate;
- delete through an explicit confirmation.

**New manual test** shows the flow before input:

```text
Conversation input -> synthetic reply -> expected staff reply + scoring rules
```

Importing a resolved conversation preserves its earlier message sequence. The manual test dialog
states that its input is one message.

Duplicating a case clears synthetic output and grade.

Editing a case clears its previous grade. Actual synthetic output, grade, and rationale remain
read-only run evidence.

Deleting a case:

- removes dataset-scoped run history for that case;
- removes pending Knowledge corrections sourced from the case;
- preserves decided corrections but clears their source-case link;
- names these consequences before confirmation;
- changes nothing when canceled.

### 8.12 Evaluation Lab presentation

Desktop provides:

- dataset selector;
- metrics;
- suite history chart;
- search;
- split, language, and result filters;
- sortable case table;
- row actions;
- case detail drawer.

Split, language, and result controls use compact fixed columns on desktop and fit their full
selected labels. Holdout, expected human HITL, actual synthetic output, Input, Type, and every case
type expose short definitions on hover and keyboard focus without explanation panels. Tooltip
content renders in a body-level portal so dense table and pane boundaries cannot clip it.

The table columns are:

1. Item.
2. Type.
3. Language.
4. Input.
5. Expected human HITL output.
6. Actual agent output.
7. Testing criteria.
8. Grading result: score and rationale.
9. Actions.

Truncated values retain full text through the case detail drawer or a named Show full control. A
tooltip or `title` attribute alone does not satisfy recovery.

The detail drawer shows:

- full input;
- full expected output;
- full actual output;
- criteria;
- full grade rationale;
- linked Knowledge corrections;
- last five case runs.

Drawer anatomy:

```text
+----------------------------------------------+
| 48px case title | split | grade | Close      |
+----------------------------------------------+
| Input                                        |
| full conversation                            |
|                                              |
| Expected human HITL                          |
| full reference, visually separate            |
|                                              |
| Actual synthetic agent                       |
| full candidate output                        |
|                                              |
| Criteria and grade rationale                 |
| linked Knowledge corrections | last five runs    |
+----------------------------------------------+
| 52px actions: Run Case | Edit | More         |
+----------------------------------------------+
```

The drawer is approximately 480px wide at desktop and starts below the shell. At 390px and 320px
it becomes the one visible content pane below the shell, not a modal over squeezed cards. Expected
human HITL and Actual synthetic agent never share a single unlabeled diff block.

Analyze failures opens a non-modal evidence drawer because failed-run diagnosis is a primary
workflow:

- approximately 520px wide at desktop and the one visible content pane on mobile;
- failed train cases and judge evidence appear above proposed Knowledge corrections;
- starting analysis replaces the action with a bounded progress state;
- a failed request creates no corrections;
- the case table or case cards remain the route's underlying artifact.

#### 1440px reference frame

```text
+--------------------------------------------------------------------------------+
| 46px: Evaluation Lab | dataset | Add | Run all cases | Analyze failures | Import | More|
+----------------------------------------------------------+---------------------+
| raw case workspace, minmax(0, 1fr)                       | support rail 280px  |
| 44px search | split | language | result                  | score summary 132px |
+----------------------------------------------------------+---------------------+
| grouped sticky header, 56px                              | suite history 120px |
| metadata | sample | testing | actions                    | 0-100%, no animation|
+----------------------------------------------------------+---------------------+
| raw case rows scroll                                     | selected context    |
| input | expected human HITL | actual synthetic agent     | and run legend      |
| criteria | grade rationale | Run/Edit/Duplicate/Delete   | rail body scrolls   |
| at least one complete row appears in the first viewport  |                     |
+----------------------------------------------------------+---------------------+
| workbench height = calc(100dvh - 100px)                                        |
+--------------------------------------------------------------------------------+
```

The raw case table is the dominant surface. The chart and score summary explain the rows; they
never replace them.

At 1200px and wider:

- the main case work uses the remaining width;
- the score-summary rail is 280px;
- filters and the grouped table header stay above the case rows;
- the score summary and 120px history chart stay in the supporting rail;
- the table owns vertical scroll;
- opening a case uses a right-side detail drawer, approximately 480px wide, without changing
  the selected dataset.

Desktop reading order is toolbar, filters, first raw case, its expected and actual outputs,
criteria and grade, then the supporting score summary and history. The toolbar, filters, grouped
table header, score summary, and chart stay fixed within the workbench. Case rows and the lower
support-rail context own the two vertical scroll regions.

#### Conforming target from 900px to 1199px

```text
+------------------------------------------------------------------------+
| 46px toolbar                                                           |
+------------------------------------------------------------------------+
| 56px summary: overall | train | holdout | mean | delta                |
+------------------------------------------------------------------------+
| 96px history chart                                                     |
+------------------------------------------------------------------------+
| 44px filters                                                           |
+------------------------------------------------------------------------+
| sticky grouped header + scrollable raw case rows                       |
| first complete row remains visible in the first viewport               |
+------------------------------------------------------------------------+
```

The score rail becomes one compact horizontal summary. It does not become five large dashboard
cards.

At this width the reading order is route actions, compact score summary, history, filters, then the
first raw case. The summary, history, filters, and grouped header remain fixed inside the
workbench. Raw case rows own vertical scroll.

#### 390px reference frame

```text
+------------------------------------------+ 390px
| 54px: K | C | D | E | Demo | Reset      |
+------------------------------------------+
| 44px: Evaluation Lab | dataset           |
| 44px: + Test | Run all cases | Analyze | More|
+------------------------------------------+
| 72px score summary, 2 rows | History     |
+--------------------+---------------------+
| 44px search        | 44px split          |
| 44px language      | 44px result         |
+--------------------+---------------------+
| case cards scroll                        |
| title + grade                            |
| split | type | language                  |
| Input                                    |
| Expected human HITL                      |
| Actual synthetic agent                   |
| Checks | rationale                       |
| Run | Edit | Duplicate | Delete           |
+------------------------------------------+
```

At 390px, all four case actions fit one 44px-tall action row. Import conversations and dataset or
scoring-rule maintenance live in More. At least one complete case card appears at the initial
scroll position.

#### 320px reference frame

```text
+----------------------------------+ 320px
| 54px: K|C|D|E|Demo|Reset         |
+----------------------------------+
| 44px: Evaluation Lab | dataset   |
|44px:+Test|Suite|Analyze|More     |
+----------------------------------+
|44px:Overall|Train|Hold|History   |
+----------------------------------+
|44px:Search              |Filters |
+----------------------------------+
| case cards scroll                |
| title + grade                    |
| metadata                         |
| Input | Show full                |
| Expected human HITL | Show full  |
| Actual synthetic agent | Show full|
| checks + rationale               |
| Run        | Edit                |
| Duplicate  | Delete              |
+----------------------------------+
```

The 320px action rows are explicit 2-by-2 grids with 44px minimum targets. They never compress four
text actions into one row.

The mobile case list is one column. It is not a two-column card grid and it is not the desktop
table squeezed into the viewport.

At 320px, `+ Test`, `Run all cases`, `Analyze`, and `More` share the toolbar row.
Their accessible names remain `New manual test`, `Run all cases`, `Analyze failures`, and `More`. The
compact summary shows regression guard and open failures. The chart lives in History.
Filters opens split, language, and result choices without removing the search field.

Mobile reading order is route context, direct actions, compact score context, filters, then raw
cases. History opens the supporting suite-context drawer below the shell; it contains the
non-animated chart and run labels without replacing or navigating away from the cards. The shell,
route toolbar, summary, and filters stay fixed within their regions; case cards own the route's
vertical scroll.

#### Score-summary anatomy

Each metric contains:

1. the exact metric label;
2. the count and denominator when the metric is a pass rate;
3. the percentage or mean value;
4. the prior-run delta when available;
5. muted explanatory text when no prior run exists.

The summary uses one region with internal separators. It does not use icons, shadows, sparklines,
comparison bars, baseline markers, standard deviation, improved/regressed case counts, or
oversized KPI typography. Those reference-workbench elements require data KaunterAI does not
store.

At 1200px and wider, the summary sits in the 280px support rail. From 900px to 1199px, the
two-metric summary is one 56px row above the 96px history chart. At 390px and 320px, the
same regression-guard and open-failure metrics sit above the case cards. Labels use 11px muted
text; values use 13px tabular figures. Hairlines separate metrics. Metrics never become floating
cards.

#### Table anatomy

The desktop table uses four visual groups:

```text
+----------------------+------------------------------------+-------------------------+---------+
| item metadata        | sample                             | testing                 | actions |
| item | type | lang   | input | expected HITL | actual    | criteria | grade         |         |
+----------------------+------------------------------------+-------------------------+---------+
```

Row rules:

- Item contains the case title and train or holdout split.
- Type and language remain compact metadata.
- Input, expected, and actual show two to three readable lines before truncation.
- Full text remains available by opening the row's detail drawer. A `title` attribute alone does
  not satisfy recovery.
- Criteria show the applicable human-readable labels, not raw identifiers.
- Grade shows Pass, Fail, or Not run; score; and one rationale line.
- Run is the first row action.
- Edit, Duplicate, and Delete follow in that order.
- Rows use separators, not floating cards.
- Horizontal overflow belongs to the table region, never the document.

Sorting is intentionally limited:

- fixture order is the default;
- Item and Grade are the only interactive column headers;
- each sortable header cycles ascending, descending, then fixture order;
- Type, Language, Input, Expected, Actual, Criteria, and Actions are plain text headers;
- no resize, pin, export, column picker, or decorative sort chevron appears.

#### Mobile-card anatomy

- Header: title on the left; Pass, Fail, or Not run plus score on the right.
- Metadata line: split, type, and language.
- Body: labeled Input, Expected, Actual, Criteria, and Rationale fields.
- Input, Expected, and Actual may truncate, but each exposes a named Show full control.
- Action row at 390px: Run, Edit, Duplicate, Delete in one row.
- Action rows at 320px: Run and Edit, then Duplicate and Delete.
- The initial 320px card is at most 330px tall; one-line evidence previews and Show full preserve
  a complete card inside the 320 by 568 release frame.
- Tapping the card body opens the detail drawer; action buttons do not.

#### Toolbar action order

Desktop:

1. With no selected case, Run all cases is the primary action.
2. With a selected case, the row or drawer's Run Case is primary and Run all cases becomes secondary.
3. New manual test, Analyze failures, and Import conversations remain direct secondary actions.
4. New Dataset, Rename Dataset, Delete Dataset, and Scoring rules live in a named maintenance
   menu.

Below 900px:

1. New manual test, Run all cases, and Analyze failures remain direct.
2. Import conversations, dataset maintenance, and Scoring rules move to More.
3. Cancel replaces the owning Run Case or active Run all cases case request.
4. `Analyze` is the compact visible label; its accessible name remains `Analyze failures`.

There is no desktop hamburger for task actions and no toolbar button without a working flow.

#### Scroll and region ownership

| Region | Fixed within the region | Scroll owner |
|---|---|---|
| Main case work | Filters and grouped table header | Case rows |
| Support rail | Score summary and suite history | Selected context and run legend |
| Case drawer | Drawer heading and close action | Full case evidence and run history |
| Analyze drawer | Drawer heading and failure summary | Failed cases, judge evidence, and proposed corrections |
| Dialog | Title and explicit final actions | Form body when taller than viewport |

#### State presentation

| State | Required presentation |
|---|---|
| Route loading | Shell and case workspace show a labeled inline status; no full-page skeleton |
| No suite snapshots | Chart region says "Run all cases to create history."; axes and fake points are absent |
| No cases | Case region names the empty dataset and keeps New manual test and Import conversations reachable |
| Filters have no matches | Case region says no cases match; dataset metrics remain unchanged |
| One case running | Only that case shows the active semantic judge request and Cancel; live or simulated mode appears only after result metadata validates |
| One case canceled | Prior output, grade, and history remain unchanged |
| One case error | Case keeps prior evidence and shows a persistent Run again action |
| Suite running | Visible completed/total progress and Cancel Run |
| Suite canceled | Prior case evidence, history, and snapshots remain unchanged |
| Analyze running | Non-modal drawer states that committed failures are being classified; no model or judge rerun is implied |
| Analyze has no failures | Drawer states that the selected suite has no failed train cases |
| Analyze complete | Pending corrections appear atomically; cases, scores, attempts, and suite snapshots remain unchanged |
| Conversation import unavailable | Each row names unresolved, no-staff-reply, or already-imported status |
| HITL duplicate or invalid | Persistent inline error identifies the duplicate or field; no case is created |
| HITL import canceled | Dialog closes and no case is created |
| Stale grade after edit | Grade clears immediately and case reads Not run until the next explicit run |
| Delete requested | Confirmation names run-history and correction effects |
| Dataset delete blocked | Protected seed or last-dataset reason appears beside Delete |
| Invalid criterion mutation | Inline error remains beside the criterion; stored value remains unchanged |
| Required judge result is uncertain | Case reads Needs review and exposes the per-rule reason and evidence |
| Judge server unavailable or malformed | Prior evidence stays unchanged and the Run action remains available |

#### Causal-boundary copy placement

- Analyze failures drawer: "Analysis creates review proposals from committed train failures. It
  does not rerun or improve the agent."
- Case drawer when a correction exists: "This case produced review evidence, not an active
  playbook change."
- Knowledge saved-text dock: "Check saved text verifies the exact replacement. It does not change this Eval
  score."

These statements are persistent in their owning surfaces and are not replaced by a temporary
toast.

#### Forbidden substitutions

Global anti-generic rules live in `SOUL.md` section 13. Eval-specific bans:

- No analytics-home KPI wall.
- No pie or donut chart.
- No generic data-grid settings, export, pinning, or column-builder controls.
- No hidden human reference passed to generation.
- No multi-column mobile card grid.
- No score without its case-level evidence.
- No silent case, dataset, or criterion deletion.

### 8.13 History chart

The chart shows:

- overall pass percentage;
- train pass percentage;
- holdout pass percentage;
- a 0 to 100 percent vertical scale;
- short non-overlapping run labels;
- full run detail in the tooltip.

The plot reserves edge padding so the first and last points are visible. Animation is disabled
for deterministic screenshots and tests.

Below 900px, History opens a supporting drawer below the shell. The drawer keeps dataset and case
selection unchanged, owns the chart and run-detail scroll, and returns focus to History when
closed. With no snapshots it shows the declared empty copy and no fake axes or points.

### 8.14 Mobile Evaluation Lab

A conforming implementation below 900px:

- New manual test, Run all cases, and Analyze remain direct actions;
- secondary actions move into More;
- 390px and 320px show regression guard and open failures;
- History opens a supporting drawer with the suite chart and run labels;
- 390px filters use a two-column grid;
- 320px keeps Search direct and opens split, language, and result in Filters;
- the 320px Filters drawer applies choices immediately, exposes Clear filters, and returns focus to
  Filters when closed;
- cases render as readable cards;
- each card exposes Run, Edit, Duplicate, and Delete;
- truncated input, expected, and actual values preserve full text;
- the detail drawer starts below the shell and does not block route navigation;
- controls meet the 44 by 44 CSS pixel target.

### 8.15 Evaluation deep links

- `dataset` selects a valid dataset.
- `case` selects the case's owning dataset and opens its detail drawer.
- `import` opens HITL import and prioritizes the matching conversation.
- Supported parameters are consumed and removed from the URL.
- A new supported query on an already-open Eval route must run again.

## 9. Knowledge contract

This section owns observable Knowledge UI, spatial frames, and staff behavior. Inactive candidate,
replay, Activate, and one-step Rollback contracts live in section 16.

### Build-state boundary

| State | Correction decision | Check saved text | Active playbook |
|---|---|---|---|
| `BUILT` local fallback | Approve replaces saved text when no release server is configured | Checks saved-text presence | No version pointer |
| `BUILT` release workflow | Accept, save, or import creates an inactive immutable candidate | Replays affected train cases, then all train and holdout cases | Separate Activate after Ready; Rollback restores a prior immutable SOP |

Sections 9.2 through 9.9 describe the spatial contract used by both paths. Accept never changes
the active playbook directly.

### 9.1 Purpose

Knowledge is the human review surface for playbook files and pending corrections.

It provides:

- file selection and editing;
- correction evidence;
- correction review and decision;
- focused line review;
- saved-text verification through Check saved text;
- candidate activation and one-step Rollback in the approved POC;
- links back to source evaluation cases.

### 9.2 Layout

Wide layout shows:

- file explorer;
- playbook editor;
- changes rail;
- test dock when open.

Below 1000px, Knowledge shows one pane at a time:

- Files;
- Editor;
- Changes.

The pane selector is a keyboard-operable tablist. Inactive panes are hidden from rendering and
the accessibility tree.

#### 1440px reference frame

```text
+--------------------------------------------------------------------------------+
| 46px toolbar: Knowledge | path | pending | saved state | Save | Check saved text | More|
+--------------+--------------------------------------------+--------------------+
| files 230px  | editable playbook, minmax(0, 1fr)          | changes 320px      |
| 38px head    | 38px file status                           | 56px counters      |
|              | 48px gutter + editor                       |                    |
| folder tree  | line numbers | editable Markdown           | evidence           |
| pending count| editor scrolls                             | old text           |
| list scrolls | focused-line and diff decoration           | proposed new text  |
|              |                                            | cards scroll       |
|              +--------------------------------------------+                    |
|              | Check saved text dock, max 40% editor height   |                    |
+--------------+--------------------------------------------+--------------------+
| workbench height = calc(100dvh - 100px)                                        |
+--------------------------------------------------------------------------------+
```

The editor receives all width left after the two fixed context rails and remains the dominant
region. The page does not distribute three equal cards.

Desktop reading order is selected file, saved text, correction evidence, old text, proposed new
text, then Reject or Approve. Clicking the correction body focuses its editor line. The shell, route toolbar, pane headings, file status,
changes counters, and dock heading remain fixed. The file list, editor text, correction list, and
dock results own separate scroll.

#### Conforming target from 1000px to 1199px

```text
+-----------------------------------------------------------------------+
| 46px toolbar                                                          |
+------------+------------------------------------------+---------------+
| files     | editable playbook, minimum 480px          | changes       |
| 190px     | editor owns remaining width               | 280px         |
| list      | text scrolls; dock stays below editor     | cards scroll  |
+------------+------------------------------------------+---------------+
```

The rails do not shrink below these widths. If the 480px editor floor cannot fit, Knowledge switches
to the one-pane Files, Editor, and Changes choreography.

#### 390px reference frame

```text
+------------------------------------------+ 390px
| 54px: K | C | D | E | Demo | Reset      |
+------------------------------------------+
| 44px: Knowledge | pending | saved state      |
| 44px: Save | Check saved text | More         |
+------------------------------------------+
| 44px: Files      | Editor      | Changes |
+------------------------------------------+
| one rendered pane                        |
| Files: 52px head + folder tree scroll    |
| Editor: 38px status + text scroll        |
| Changes: 56px counters + cards scroll    |
|                                          |
+------------------------------------------+
| Editor only: Test dock, max 50dvh        |
+------------------------------------------+
```

#### 320px reference frame

```text
+----------------------------------+ 320px
| 54px: K|C|D|E|Demo|Reset         |
+----------------------------------+
| 44px: Knowledge | pending | state    |
| 44px: Save        | Check saved text |
| 44px: More                     |
+----------------------------------+
| 56px: Active SOP | Candidate     |
+----------------------------------+
| 44px: Files | Editor | Changes   |
+----------------------------------+
| one rendered pane                |
| Files: nested folder and file rows|
| Editor: 40px gutter + text       |
| Changes: stacked old then new    |
| Whole card focuses editor line   |
| Reject       | Approve           |
+----------------------------------+
| Editor: dock, max 50dvh          |
+----------------------------------+
```

At 320px, New File, Rename, Delete, and Discard stay in More. When a candidate exists, Replay all eval cases,
Activate, and Discard candidate also move to More so Save, Check saved text, and Replay affected train cases leave
the Files pane reachable. Pending correction decisions stay in Changes and never move to More.
The compact release gate shows the active SOP and candidate state; the descriptive release-path row is omitted.

Mobile reading order is selected file, saved-state text, current pane tabs, pane content, then the
owning actions. In Changes, each card reads evidence, exact old text, exact new text, Reject, then
Approve. Clicking the correction body returns to its editor line. In Editor, the Check saved text dock
follows the visible saved text.

The pane selector is a real tablist at 390px and 320px:

- Left and Right Arrow move one tab.
- Home selects Files.
- End selects Changes.
- Only the selected panel is rendered and focusable.
- A file selection opens Editor.
- A correction deep link opens Changes.
- Clicking a correction returns to Editor and places focus at the resolved line.

#### Scroll and region ownership

| Region | Fixed within the region | Scroll owner |
|---|---|---|
| Files | 44px explorer heading and New File action | Flat file list |
| Editor | 38px file status row | Playbook text |
| Changes | 56px changes heading, counters, and dirty warning | Correction cards |
| Test dock | Dock heading, summary, close action | Per-correction results |

The test dock is a bottom panel inside the editor column. It never becomes a fourth column,
full-page overlay, or separate route.

#### Toolbar action order

Desktop:

1. Save is enabled only for a dirty selected file.
2. Check saved text remains a direct action.
3. New File, New Folder, Rename, Delete, and Discard are secondary file actions.
4. Current path, pending count, and Saved or Unsaved state remain readable but do not look like
   buttons.
5. Path, pending count, and saved state are non-interactive status text and are not tab stops.

Below 1000px:

1. Save, Check saved text, and Replay affected train cases remain direct while a candidate exists.
2. Rename, Delete, Discard, Replay all eval cases, Activate, and Discard candidate move to More. New File
   and New Folder remain in the Files pane.
3. No autonomous Knowledge Cycle control appears; corrections, Check saved text, activation, and rollback
   remain explicit visitor actions.

#### File-explorer anatomy

```text
+--------------------------------+
| v playbooks                    |
|   > data                       |
|   playbook title         [2]   |
|   example.md                   |
+--------------------------------+
```

- Folder rows expand and collapse in place. File rows remain compact and path-derived.
- The selected file uses an accent edge and wash. A selected folder uses the wash only.
- New File and New Folder create inside the selected folder.
- Pending count is visible without opening the file.
- Paths use compact monospace text and ellipsize only when the full path remains recoverable.

#### Correction-card anatomy

Pending correction:

```text
+--------------------------------+
| Pending                 Line 9 |
| evidence sentence              |
| Source: linked eval case       |
| - exact old text               |
| + exact new text               |
| Reject            | Approve    |
+--------------------------------+
```

Rules:

- Removed and added text are stacked, not a side-by-side diff that narrows both fragments.
- Diff colors pair with `-` and `+`; redundant remove and add labels are omitted.
- Evidence appears directly below the proposal claim and before old or new text.
- Evidence uses 12px muted text and exposes the full source-case link in place. It never moves to
  a detached Sources dialog.
- Pending cards remain expanded.
- Approved and rejected cards compress to state, line, and one-line old/new summary.
- A stale correction cannot focus the editor; adjacent copy says
  `Saved text no longer contains this line.`
- A dirty draft places one warning above the list and disables pending decisions.
- Approve is the primary action only inside a pending card.

#### Editor correction treatment

The editor keeps the saved Markdown editable while showing the selected correction as
non-destructive visual decoration:

```text
  21  surrounding saved text
- 22  exact old text                         pending source line
+     proposed new text                      visual preview, not saved content
  23  surrounding saved text
```

Rules:

- The editor gutter is 48px at desktop and 40px at 320px; line numbers use tabular monospace text.
- Editor lines use a 22px line height.
- Pending old text has a warning-colored line marker and a muted remove treatment.
- Proposed new text appears directly below as a non-editable add preview.
- Approve replaces the saved old text, removes the preview, and marks the resulting line
  approved.
- Reject removes the add preview, leaves saved text unchanged, and marks the source line
  rejected.
- Editing the file remains normal Markdown editing; decoration text never enters the draft.
- Approve and Reject stay in the Changes rail. The editor does not duplicate decision buttons.
- Clicking the correction scrolls this treatment into view and places the caret at the saved source
  line.

#### Test dock anatomy

The dock opens below the editor and shows:

1. preparing or running status;
2. completed and total progress;
3. passed, evaluated, pending, and rejected counts;
4. one row per correction with Before, After, current line, result, and Why;
5. Run Again;
6. a link to the relevant Eval dataset;
7. the Check saved text versus Eval-score boundary.

At wide sizes the dock uses at most 40% of the editor-column height. Below 1000px it uses at most
50% of the viewport height. The editor remains visible above it.

#### State presentation

| State | Required presentation |
|---|---|
| Route loading | Shell and editor pane show a labeled inline status; no full-page skeleton |
| No file selected | Files remain available; editor says "Select a playbook file to edit."; Changes asks for a file |
| File has no corrections | Changes says no corrections for this file; no empty illustration |
| Dirty draft | Unsaved state in toolbar; Save and Discard available; review decisions blocked |
| Save running | Save becomes Saving; duplicate Save is blocked and the draft remains visible |
| Save error | Draft remains intact; persistent inline copy names the failure and offers Save again |
| New or rename invalid | Inline field error names invalid path, extension, or collision; stored file remains unchanged |
| Discard requested | Confirmation names the selected file and that only its unsaved draft will be removed |
| Discard canceled | Draft and editor remain unchanged |
| Stale proposal | Persistent feedback names that saved text no longer matches |
| Test preparing or running | Dock remains open with progress; old run cannot commit |
| Test canceled | Closing or rerunning cancels old timers; no partial result commits |
| Test error | Dock names the failure and keeps Run Again reachable |
| Test complete | Counts and per-correction results remain until closed or rerun |
| Test stale after save | Dock marks prior results stale and requires a fresh run |
| File deletion blocked | Dialog names protected seed or correction history |
| File deletion requested | Confirmation names the path and selects the first remaining file only after commit |

#### Forbidden substitutions

Global anti-generic rules live in `SOUL.md` section 13. Knowledge-specific bans:

- No document-card gallery.
- No preview-first editor.
- No Replay tab or route.
- No terminal, source control, extensions, or generic IDE activity rail.
- No whole-file Approve All.
- No correction wizard that hides the file.
- No dead Knowledge Cycle button.
- No test-result toast replacing the dock.

### 9.3 File model and paths

Each file has stable identifier, path, title, saved Markdown content, and update timestamp.

Valid paths:

- start with `playbooks/`;
- end with `.md`;
- contain a non-empty filename.

The three seed files are protected from deletion.

A file with any correction history is protected from deletion.

### 9.4 File CRUD

Create:

- validates identifier and path uniqueness;
- validates path and extension;
- selects the new file.

Rename:

- changes path and title without changing stable identity;
- preserves content, draft, and correction links.

Delete:

- requires confirmation;
- blocks protected seed files;
- blocks any file with correction history;
- selects the first remaining file.

### 9.5 Draft and save

- Editing writes immediately to the selected file's draft.
- Switching files preserves each file's draft.
- Save copies the draft into saved content and removes the draft.
- Discard removes the draft and restores saved content.
- Save is disabled when there is no dirty draft.
- The save keyboard shortcut is active only inside the editor.
- A save shortcut must not fire while focus is inside a dialog.

### 9.6 Editor status and line review

The editor shows:

- filename;
- Saved or Unsaved state;
- line count;
- word count;
- one accessible textbox name.

Correction highlights update when correction state changes, even when document text did not
change through the editor.

Line lookup:

- pending and rejected corrections locate old text;
- approved corrections locate new text;
- unresolved text keeps the correction visible but disables focus with the stale-source reason;
- approved text remains focusable after replacement.

Every correction click creates a new focus request, including repeated clicks on the same line.
The editor scrolls the line into view, places the caret at its start, and receives focus.

### 9.7 Correction review

The changes rail is scoped to the selected file.

Each pending card shows:

- removed text;
- added text;
- evidence;
- source case or Manual correction;
- Reject;
- Approve.

When the file has an unsaved draft:

- warn the user;
- disable pending correction focus, Reject, and Approve actions;
- enforce the approve block at the domain boundary as well as the UI.

Approve:

1. Requires a pending correction.
2. Requires no dirty draft.
3. Requires saved content to contain old text.
4. Replaces the first matching old-text occurrence with new text.
5. Marks the correction approved.
6. Updates the saved timestamp.
7. Keeps the correction linked to its source case.

Reject:

- marks the correction rejected;
- leaves saved file content unchanged;
- prevents later approval.

Already-approved or already-rejected corrections cannot be decided again.

Failure feedback must distinguish:

- stale proposal text;
- dirty draft;
- correction not found;
- correction already decided.

### 9.8 Check saved text dock

Check saved text is a saved-text verification.

For each correction:

- approved passes when the saved file contains new text;
- approved fails when new text is missing;
- rejected is skipped;
- pending remains pending.

The dock shows:

- preparing;
- running progress;
- complete summary;
- passed, evaluated, pending, and rejected counts;
- per-correction Before text, After text, current saved line, result, and plain-language Why;
- Run Again;
- link to the Evaluation Lab.

Every run request starts a fresh run even while the dock remains open.

Starting a new run, closing the dock, or unmounting the page cancels all timers from the old run.
Only the latest run may commit results.

The dock states clearly that Check saved text and Evaluation Lab scores are separate evidence. A
saved-text pass does not claim that an Eval passed before or after the correction.

### 9.9 Knowledge deep links

- `file` selects a valid file and opens Editor on narrow layouts.
- `correction` selects the correction's file and opens Changes on narrow layouts.
- Query parameters are consumed and removed from the URL.
- A new query on an already-open Knowledge route must run again.

## 10. Cross-route workflows

### 10.1 Conversation to HITL evaluation

```text
staff sends or already has a reply
  -> staff resolves the conversation
  -> patient rail enables Add to Evals
  -> /eval opens Import resolved conversations with that row preselected
  -> staff imports one or several ready conversations
  -> new Train test appears with latest staff text as expected output
```

If the conversation is unresolved or has no staff reply, the action remains unavailable and
explains why. The import dialog keeps already imported conversations visible but disabled.

### 10.2 Evaluation failure to Knowledge review

```text
run case or suite
  -> structured semantic judge evidence
  -> committed failed train case
  -> Analyze failures creates or finds pending correction
  -> open linked Knowledge correction
  -> human accepts or rejects
  -> acceptance creates an inactive candidate
  -> Replay affected train cases validates the candidate against linked failures
  -> Replay all eval cases reruns affected train cases first, then reaches Ready after every train and holdout case passes
  -> visitor activates the candidate
```

The correction source links back to the Evaluation Lab case.
No score, suite result, or generated proposal skips the human decision.

### 10.3 Conversation to relevant playbook

Conversation routing:

- booking label or booking record -> Malay booking playbook;
- prescription label -> Mandarin prescription playbook;
- emergency or triage label -> triage playbook;
- otherwise -> triage playbook.

### 10.4 Schedule to conversation

Selecting a patient from Schedule returns to Inbox and selects that conversation.

### 10.5 Cross-route mobile restoration

- Chat -> Eval import preserves the selected conversation and thread pane. Back returns to that
  thread unless a new supported deep link overrides it.
- Eval -> Knowledge correction preserves the selected dataset and case drawer. Back returns to that
  case evidence.
- Knowledge -> Eval source case preserves the selected file and Changes pane. Back returns to that
  correction.
- Schedule -> conversation switches Chat to Inbox and opens thread.
- Each route stores only its latest valid local selection. Deleted or filtered entities reconcile
  to the first valid item or the route's empty state.

## 11. Review-derived failure prevention

These acceptance requirements capture the defects that a happy-path build tends to miss. They are
mandatory for a conforming rebuild, not optional polish.

### 11.1 Data integrity and causality

| Failure mode | Required invariant |
|---|---|
| Human reference leaks into generated output | Generation input excludes expected output, actual output, grades, and rationale |
| Seed appears graded before a run | Ungraded cases have no actual output and no grade |
| Duplicated case inherits a pass | Duplicate clears output and grade |
| Edited case keeps a stale grade | Editing clears the previous grade before another run |
| Criterion delete silently broadens judging | Deletion is blocked while any case references the criterion |
| Invalid criterion text partially commits | Criterion edits validate locally and leave stored values unchanged on failure |
| Case deletion silently removes related evidence | Confirmation names run-history and correction effects before commit |
| Legacy persistence is wiped during migration | Valid version 1 through 3 product data migrates to version 4; incompatible exact-text grades are cleared |
| Selection points to a deleted entity | Reconcile every persisted selection after load and migration |
| Failure analysis looks like model improvement | Analyze failures changes no case, score, attempt, suite, or candidate version |
| Partial analysis leaks into Knowledge | Pending corrections commit atomically after all selected failures validate |
| Uncommitted evidence generates proposals | Analyze failures reads committed failed train attempts only |
| Holdout drives proposals | Holdout gates release readiness but never generates corrections |
| Duplicate HITL examples accumulate | Persist the source conversation ID and fingerprint input message identifiers plus expected staff text |
| Deleted case leaves broken links | Pending corrections are removed; decided corrections lose the missing source link |

### 11.2 UI state and asynchronous work

| Failure mode | Required invariant |
|---|---|
| Filter hides selected row but stale thread remains | Reselect first visible row or null |
| New simulated row is immediately hidden | Simulation clears search and resets filter to All |
| Composer draft crosses patients | Conversation change clears draft and mode |
| Patient edit crosses patients | Conversation change cancels edit state |
| Resolved thread still accepts sends | UI and domain boundary reject sends until reopen |
| Closed booking still appears in schedule | Rejected and cancelled bookings are excluded |
| Case or suite double-click creates duplicate history | Per-operation lock allows one commit |
| Cancel still mutates state | An aborted case request commits no attempt; completed suite attempts remain immutable |
| Late judge response commits after cancel | Abort the request and reject any result after cancel, reset, dataset switch, or unmount |
| Same-route query runs only once | Process every new supported query value, not only first mount |
| Repeated correction click does nothing | Add a unique request identifier per click |
| Save shortcut fires from a dialog | Scope shortcut to the editor |
| Correction highlight stays stale | Decorations react to correction state as well as document text |
| Stale approval fails silently | Show the exact conflict reason |
| Reset paints a route-wide success strip | Reset stays quiet after confirmation and restores canonical state without a persistent highlight |
| Unresolved conversation imports as reference data | Import is disabled until the conversation is resolved and contains a staff reply |
| Batch import partially commits | Validate and commit the selected conversation set atomically |

### 11.3 Responsive and accessibility

| Failure mode | Required invariant |
|---|---|
| Shell hides overflow while a child remains wider than the viewport | Browser release matrix measures critical child bounding boxes, not document scroll width alone |
| 320px grid track expands to min-content width | Mobile tracks use shrinkable columns and children allow shrinking |
| Patient names consume timestamp space | Names ellipsize; timestamps do not shrink |
| Mobile toolbar collisions | Use explicit layout areas, not accidental wrapping |
| Hidden Knowledge pane remains keyboard-focusable | Hide inactive pane from rendering and accessibility tree |
| Eval drawer blocks global navigation | Keep non-modal drawer below shell on mobile |
| Touch controls are visually small | Every mobile interactive target is at least 44 by 44 CSS pixels |
| Scrollable metrics cannot receive keyboard focus | Name and focus the region |
| Sort state is visual only | Expose sort direction semantically |
| Truncated text has no recovery | Preserve full text through title, accessible label, or detail drawer |
| Tooltip is the only full-text recovery | Eval rows open a drawer and mobile fields expose Show full |
| Tooltip clips inside a table or pane | Render tooltip content in a body-level portal and reposition it on scroll and resize |
| Chart edge point clips | Reserve horizontal plot padding |
| Screenshot catches mid-animation chart | Disable chart animation |
| Accent text nearly meets contrast but fails | Test actual foreground and background pairs against WCAG AA |
| Code editor lacks a usable name | Expose one named textbox |

### 11.4 Performance and product honesty

| Failure mode | Required invariant |
|---|---|
| Editor dependency loads on Chat Control | Heavy route code stays in its owning route |
| Route loading appears blank | Provide accessible loading status |
| Simulated judge reads like a live model | Persist and display simulated versus live LLM metadata |
| Numeric judge score reads as the decision | Lead with Pass, Fail, or Needs review and keep score secondary |
| Synthetic transcript reads like live audio | Label the fixture as transcript-only; distinguish live Telegram voice controls |
| Knowledge Check saved text reads like eval success | State that the two checks are separate |
| Empty chart looks broken | Show an honest no-runs state |
| Fake fixed timestamps read like audit time | Keep fixture mode labeled; do not claim wall-clock audit history |
| Mobile looks like a live clinic product | Keep the compact Demo label visible at every width |

### 11.5 Product critique ledger

| Critique or blocker | Durable product rule |
|---|---|
| **Import HITL case** sounds like one technical record | Use **Import conversations** and show one selectable row per conversation |
| A dropdown hides batch selection | Use explicit checkboxes, select all available, a selected count, and one batch action |
| Import allows duplicates | Keep imported rows visible but disabled; guard with source ID and content fingerprint |
| An unresolved or staff-less row fails without explanation | Show the blocking reason on that row before the user acts |
| **Add Case** does not explain what is created | Use **New manual test** and show the replay flow before input |
| **Edit Criteria** does not explain scoring | Use **Scoring rules** and ask what a good reply should do; keep examples under Advanced |
| HITL and split terminology requires domain knowledge | Define each term at first use and provide a hover or focus glossary without adding permanent panels |
| Tooltip is obscured by a dense workbench boundary | Portal it outside clipping containers and keep it keyboard reachable |
| Check saved text reports pass or fail without evidence | Show Before, After, current line, and Why per correction |
| Saved-text verification is mistaken for agent quality | Keep Knowledge saved-text verification separate from Eval behavioral runs |
| Manual tests cannot represent long conversations | State the single-message limitation; use imported frozen replay bundles for message history |
| Imported replay does not model tool calls or injected context | Treat tool calls, tool results, and injected context as a future typed trace; do not imply the current message-only fixture captures them |
| Booking changes create only an internal audit row | Preview the exact patient message, then commit the booking, patient-visible reply, and internal audit as one action |
| Rejected and cancelled bookings are treated as one state | Keep a rejected pending request separate from cancellation of an approved appointment |
| Exact text checks reject valid paraphrases | Use reusable natural-language rubrics and one semantic judge verdict per rubric; no pattern match decides response quality |
| A browser-only judge would expose provider credentials | Run the judge behind a server endpoint; never place model credentials in the client |
| A model judge is forced to guess when evidence is weak | Support an uncertain verdict that routes the case to human review and never counts as a pass |

## 12. Non-functional requirements

These are acceptance targets for a conforming rebuild. Section 16 records what remains outside the
synthetic product boundary.

### 12.1 Determinism

- Reset produces the same seed.
- Fixture timestamps are stable.
- Synthetic candidate output is versioned and reproducible.
- Automated tests inject deterministic judge responses and label them simulated.
- Configured live judge runs record provider, model, prompt, rubric, run, latency, and token
  metadata so the evidence can be traced even though model output is not deterministic.
- Chart animation is disabled.
- Browser screenshots do not depend on external network services.

### 12.2 Accessibility

- All routes expose meaningful landmarks and control names.
- Route loading and transient feedback use polite live regions.
- Dialogs have a title, description when needed, Cancel, and explicit primary action.
- Tabs support arrow keys, Home, and End.
- Sortable headers expose sort direction.
- Scrollable non-document regions are keyboard reachable.
- Text contrast meets WCAG AA on every declared background.
- Mobile targets are at least 44 by 44 CSS pixels.
- Automated accessibility checks report zero violations for the declared browser matrix.

Automated checks do not replace a real screen-reader review before production.

### 12.3 Responsive behavior

Required browser frames:

- 1440 by 900 CSS pixels, desktop;
- 390 by 844 CSS pixels, mobile;
- 320 by 568 CSS pixels, narrow mobile.

For every route and width:

- no document horizontal overflow;
- no clipped critical child;
- no control under the mobile touch-target minimum;
- no unreadable overlap;
- no shell navigation blockage;
- no console error;
- no page error.

### 12.4 Recoverability

- Cancel means no durable mutation.
- Reset restores the canonical synthetic seed and preserves server-backed Telegram data and
  imported real Eval cases after workspace refresh.
- Invalid persisted state reseeds, persists the recovered state, and tells the operator.
- Valid older state migrates.
- Stale selections reconcile.
- Stale correction text produces a recoverable conflict.
- Destructive actions identify their effect before confirmation.

### 12.5 Maintainability

- Domain calculations remain independent from rendering.
- Storage remains behind a load and save repository boundary.
- Runtime domain types derive from transport schemas instead of repeating object shapes.
- Backend-bound domain-state serialization validates and excludes client-only selections.
- Route orchestration remains thin.
- Conversation, Knowledge, and Eval mutations remain grouped by domain.
- Large page files split when orchestration obscures behavior.
- No business rule exists only in a click handler.
- Every review-derived invariant has a focused regression test.

## 13. Target demo script

### Beat 0: Reset and orient

1. Choose Reset Demo.
2. Open Chat Control.
3. Point out Emergency, Booking details, Autonomous agent, and Done.
4. State that all data is synthetic.

### Beat 1: Emergency handoff

1. Select Ahmad bin Hassan.
2. Read the chest-pain message and synthetic urgent reply.
3. Open Details.
4. Choose Escalate emergency.
5. Confirm the agent switches off and a system audit appears.
6. Open the triage playbook in Knowledge.

Do not claim that an external nurse or emergency service was contacted.

### Beat 2: Multilingual booking

1. Select Nurul Aisyah.
2. Show Malay text and English gloss.
3. Point out that the autonomous agent asks only for the missing date and time; a live Telegram
   booking uses the server-owned availability and booking tools without a staff approval step.
4. Generate the deterministic demo response to show the action trace surface.
5. Return to Inbox.

### Beat 3: Synthetic transcript-only Mandarin flow

1. Select Mei Lin Tan.
2. Show the Voice transcript label.
3. Show the Mandarin message and English gloss.
4. State that this fixture does not invoke audio, while live Telegram voice uses the separately
   verified transcription flow.

### Beat 4: Conversation to evaluation

1. Add a short human-reviewed correction to Nurul's autonomous response.
2. Resolve Nurul's conversation.
3. Choose Add to Evals.
4. Confirm Nurul is preselected in Import resolved conversations.
5. Import the conversation.
6. Reopen import and confirm Nurul remains visible as Already imported and cannot be selected.

### Beat 5: Evaluation evidence

1. Open the seed dataset.
2. Run one case.
3. Inspect actual output, pass or fail, score, and full rationale.
4. Select Run all cases.
5. Inspect regression-guard coverage, open failures, and all-case pass-rate history.
6. Choose Analyze failures.
7. Explain that it creates review proposals without rerunning or improving the agent.

### Beat 6: Human-activated playbook change

1. Open the linked Knowledge correction.
2. Review removed text, added text, evidence, and source case.
3. Accept the correction and show that it created an inactive candidate.
4. Run Check saved text to verify the exact saved replacement.
5. Replay affected train cases and inspect the behavioral evidence.
6. Run Replay all eval cases; it reruns affected train cases first, then all train and holdout cases.
7. Activate only after the candidate is Ready.
8. Show that the prior active version is archived.

### Beat 7: Responsive and reset proof

1. Open the three routes at mobile width.
2. Show single-pane Knowledge navigation and Eval cards.
3. Return to Chat Control.
4. Reset Demo and confirm the canonical seed returns without a persistent success highlight.

## 14. Acceptance checklist

### Acceptance grains

| Grain | What it proves | Home |
|---|---|---|
| Local synthetic workbench | Domain, browser matrix, spatial, a11y | This section |
| Built verify evidence | What already passes `npm run verify` | Section 15 |
| POC live walkthrough | Live providers, activation, rollback | Section 16 |

Proof lanes are separate:

- Domain checks prove deterministic rules and mutation boundaries once per build.
- Browser checks prove visible behavior, layout, and accessibility in each route-width combination.
- Delivery checks prove route isolation and size from build or network artifacts.
- A passing browser matrix does not prove domain or delivery checks, and the reverse is also true.

### 14.1 Shared data and persistence

- [ ] Canonical seed deep-clones before mutation.
- [ ] Schema version is 4.
- [ ] Version 1 migrates.
- [ ] Version 2 migrates without wiping valid custom data.
- [ ] Unknown or malformed data reseeds, persists recovery, and surfaces a one-time notice.
- [ ] Conversation, file, and dataset selections reconcile.
- [ ] Seed identifiers are unique.
- [ ] Correction file identifiers exist.
- [ ] Correction source-case identifiers exist when present.
- [ ] Criterion identifiers belong to their dataset.
- [ ] Only resolved conversations have a resolved timestamp.
- [ ] Ungraded seed cases have no actual output.
- [ ] Reset clears drafts, runs, snapshots, and temporary selection drift.
- [ ] Reset does not leave a route-wide success highlight.

### 14.2 Chat Control

- [ ] Four seed conversations render in correct groups.
- [ ] Search checks name, label, message, and gloss.
- [ ] Filter count equals visible conversation count.
- [ ] Hidden selected conversation reconciles.
- [ ] Empty result clears thread selection.
- [ ] Reply and internal note have distinct roles.
- [ ] Empty and resolved sends are blocked.
- [ ] Send running, cancel-on-context-change, and error preserve the draft and prevent duplicate commit.
- [ ] Conversation switch clears composer draft.
- [ ] Conversation switch cancels patient edit.
- [ ] Patient Save, Cancel, validation, and failure affect only the selected patient.
- [ ] Agent mode changes append an audit and emergency escalation forces Staff only.
- [ ] Label add, duplicate, remove, and failure preserve declared state.
- [ ] Resolve disables composer.
- [ ] Reopen restores sending.
- [ ] Booking approve, reject, edit, and cancel preview a patient-visible message and append a
      separate system audit.
- [ ] Booking edits reject a stale revision and commit no partial state.
- [ ] Rejected and cancelled bookings disappear from Schedule.
- [ ] Emergency escalation turns agent off and records an audit.
- [ ] An inbound Telegram voice message stays visible while STT is running.
- [ ] Successful STT keeps the original-language transcript, detected language, and English staff
      gloss together.
- [ ] Failed STT supports retry or a manual transcript without duplicating the message.
- [ ] Text, Voice, and Both require one final visitor action.
- [ ] Text success plus voice failure shows Partially sent and retries voice only.
- [ ] Simulation clears search and filter, selects the new row, and shows status.
- [ ] Schedule patient selection returns to the correct thread.
- [ ] 320px rows and timestamps fit the viewport.

### 14.3 Evaluation Lab

- [ ] Generation input contains no human reference or prior grade.
- [ ] Generation boundary rejects leaked fields.
- [ ] Generation input contains no scoring-rule instructions or examples.
- [ ] Natural-language scoring rules expose no regular-expression or exact-text controls.
- [ ] Required failure produces Fail and required uncertainty produces Needs review.
- [ ] Judge evidence includes one result per selected scoring rule and candidate-only quotes.
- [ ] Live and simulated judge results are labeled from persisted metadata.
- [ ] Metrics use the declared denominators.
- [ ] Run Case appends one run.
- [ ] Cancel Run Case preserves prior output, grade, and history.
- [ ] Run all cases appends one snapshot and one run per case.
- [ ] Cancel leaves persistent state unchanged.
- [ ] Duplicate run controls permit one commit.
- [ ] Analyze failures accepts committed failed train attempts only.
- [ ] Analyze failures has no target rate, iteration count, suite rerun, or candidate-version change.
- [ ] Failed train cases drive one structured LLM exact-anchor proposal with rationale and evidence.
- [ ] Invalid or unsafe model output uses the deterministic fallback or manual edit path.
- [ ] No model proposal auto-accepts, activates, or changes the active playbook.
- [ ] Failed analysis exposes no new Knowledge correction.
- [ ] Completed analysis publishes pending corrections atomically.
- [ ] Holdout cases never drive proposals.
- [ ] Proposals deduplicate.
- [ ] Only resolved conversations with a staff reply are available for HITL import.
- [ ] Import supports individual, non-contiguous, and select-all conversation selection.
- [ ] HITL import uses latest staff reply.
- [ ] HITL import excludes prior system messages.
- [ ] HITL import is idempotent by source conversation and content fingerprint.
- [ ] Already imported conversations remain visible and disabled.
- [ ] Batch import commits all selected conversations or none.
- [ ] HITL import unavailable, duplicate, cancel, and success states follow section 8.10.
- [ ] New manual test states its one-message input limitation and replay flow.
- [ ] Scoring rules explain the natural-language instruction, required-to-pass effect, examples,
      version, and use count.
- [ ] Duplicate case clears output and grade.
- [ ] Editing a case clears its previous grade.
- [ ] Invalid criterion edits leave stored values unchanged.
- [ ] In-use criterion cannot be deleted.
- [ ] Case delete confirmation names cascade effects.
- [ ] Cancel case delete preserves all state.
- [ ] Confirm case delete removes scoped history and pending corrections.
- [ ] Same-route case deep link changes the drawer.
- [ ] Full table and card text remains recoverable.
- [ ] Full text recovery uses the case drawer or Show full, not a tooltip alone.
- [ ] Glossary tooltips remain visible outside table and pane clipping boundaries.
- [ ] Chart first and last points remain visible.
- [ ] Mobile metrics, filters, cards, drawer, and toolbar fit.

### 14.4 Knowledge

- [ ] Three seed playbooks render.
- [ ] Per-file drafts survive file switches.
- [ ] Save and discard affect only the selected file.
- [ ] Save error retains the draft and stale Check saved text results require rerun.
- [ ] Editor save shortcut is editor-scoped.
- [ ] File path validation rejects invalid paths and extensions.
- [ ] Seed files cannot be deleted.
- [ ] Files with correction history cannot be deleted.
- [ ] Dirty draft blocks pending review actions.
- [ ] Accept fails when old text has zero or multiple matches.
- [ ] Accept creates an inactive immutable candidate and marks the correction accepted.
- [ ] Accept leaves the active playbook pointer unchanged.
- [ ] Reject leaves saved content unchanged.
- [ ] A decided correction cannot be decided again.
- [ ] Accepted-line lookup uses candidate text.
- [ ] Repeated correction-focus requests fire.
- [ ] Highlights update when state changes.
- [ ] Source case links to Evals.
- [ ] Check saved text verifies the exact replacement without running Eval.
- [ ] Check saved text cancel and error commit no partial result and keep Run Again reachable.
- [ ] Each Check saved text result shows before and after saved text.
- [ ] A targeted pass keeps the version inactive.
- [ ] A full train and holdout suite is required for Ready.
- [ ] Activate is available only for Ready and stores the prior active version as the one rollback
      target.
- [ ] Rollback accepts only that target and creates a new active version.
- [ ] Rollback preserves every existing version, conversation, booking, and Eval artifact.
- [ ] Dirty drafts, current candidates, running replay, stale revisions, and invalid hashes block
      Rollback without partial state.
- [ ] An in-flight agent run keeps its pinned version; the next run loads the rolled-back version.
- [ ] Rollback after a file rename or deletion restores the complete target file tree.
- [ ] Successful Rollback clears the target and stays unavailable until another activation.
- [ ] Knowledge exposes no history picker, arbitrary restore target, redo, or per-file rollback.
- [ ] Knowledge states clearly that acceptance and activation are separate actions.
- [ ] Mobile tablist supports arrows, Home, and End.
- [ ] Inactive mobile panes are hidden from accessibility.
- [ ] Mobile controls meet the touch-target minimum.

### 14.5 Integration

- [ ] Control links the latest staff reply into Eval import.
- [ ] Control links each conversation to the correct playbook.
- [ ] Eval case links to its Knowledge correction.
- [ ] Knowledge correction links to its Eval source case.
- [ ] Accepted correction creates an inactive candidate before Check saved text runs.
- [ ] Full-suite Ready evidence is required before activation changes the active playbook.
- [ ] One Rollback action restores the immediately previous active bundle as a new version, clears
      its target, and makes the next Chat run pin the new active version.
- [ ] Cross-route mobile return restores the prior valid pane and selection.
- [ ] Deep links work on first load.
- [ ] Deep links work again on same-route query changes.
- [ ] Consumed query parameters are removed.
- [ ] Eval drawer does not block shell navigation on mobile.
- [ ] Route loading status is accessible.
- [ ] Knowledge-only and Eval-only delivery assets are absent from the initial Chat Control payload.

### 14.6 Browser release matrix

Run Chat Control, Knowledge, and Evals at 1440 by 900, 390 by 844, and 320 by 568 CSS pixels.

All nine route-width combinations must report:

- [ ] zero automated accessibility violations;
- [ ] zero document horizontal overflow;
- [ ] zero clipped critical elements;
- [ ] zero mobile interactive targets below 44 by 44 CSS pixels;
- [ ] zero console errors;
- [ ] zero page errors.

### 14.7 Spatial and anti-generic release gate

Compare each release screenshot with the page frames in sections 7.2, 8.12, and 9.2 and the
principles in `SOUL.md`.

- [ ] Each route opens directly on its working artifact, with no welcome or KPI wall.
- [ ] Each route has exactly one level-one heading inside its route toolbar.
- [ ] Synthetic Demo or Demo remains visible at every width.
- [ ] Light surfaces and semantic colors match `SOUL.md` section 7.1.
- [ ] Base type, metadata type, and compact density match `SOUL.md` section 7.2.
- [ ] Hairline separators, spacing, and restrained radii match `SOUL.md` section 7.3.
- [ ] Chat Control uses 300px queue, flexible thread, and 300px context rail at 1440px.
- [ ] Chat Control uses distinct 390px and 320px toolbar and More rules.
- [ ] Chat transcript rows, role labels, selection edge, fixed composer, and timestamp priority match section 7.2.
- [ ] A no-match Chat filter shows explicit copy and no stale patient.
- [ ] Knowledge uses 230px files, flexible editor, and 320px changes at 1440px.
- [ ] Knowledge test results open below the editor and do not cover the changes rail.
- [ ] Knowledge uses distinct 390px and 320px frames and renders only the selected Files, Editor, or Changes pane.
- [ ] Evals uses a 280px score-summary rail at 1200px and wider.
- [ ] Evals places the raw case table before supporting summary and chart content at 1440px.
- [ ] Evals uses one 56px compact summary and 96px chart above the table from 900px to 1199px.
- [ ] Eval uses distinct 390px and 320px case-card and action layouts.
- [ ] Eval mobile cases use one column and expose the four declared row actions at 44px minimum.
- [ ] Eval mobile History opens the supporting chart drawer without replacing case state.
- [ ] At least one complete Eval case row or card appears at the initial scroll position.
- [ ] Eval desktop columns read as item metadata, sample, testing, and actions groups.
- [ ] Every pane has one clear vertical scroll owner.
- [ ] Primary task actions remain direct; maintenance actions follow the declared overflow rules.
- [ ] Primary workflows stay in panes, rails, drawers, or docks instead of modal dialogs.
- [ ] Every visible control completes one defined flow.
- [ ] No route uses a generic sidebar, hero, equal-card grid, decorative chart, or dead control.
- [ ] Synthetic, sandbox, transcript-only, and Check saved text boundaries appear in the owning surface.

## 15. Verification status

Capability matrix (BUILT / PARTIAL / DESIGN): section 16. This section is the narrative of what
the local verify gate has proven.

The local synthetic implementation, server persistence wedge, mocked Telegram text round trip,
shared Chat and Eval runner, immutable server Eval evidence, release command service, and
browser-triggered synthetic reset pass the built-baseline acceptance gates in section 14. As of
2026-07-15, the same fixed workspace is deployed on DigitalOcean App Platform, `/healthz` and
`/readyz` return 200, the Telegram webhook secret is accepted by the deployed endpoint, and a live
Telegram text message plus a live English voice note were persisted through Supabase. The voice
note reached a ready `whisper-1` artifact. On 2026-07-16, a controlled smoke test against the
owner's existing Telegram chat proved direct-OpenAI drafting, five configured Eval cases, an exact
pending SOP proposal, outbound translation, and Telegram text, TTS voice, and recorded-voice
provider acceptance. The production build currently omits accepted outbound voices from the
reloadable thread and cannot project a live Telegram record into Knowledge/Eval; the repository fixes
have passed the full local gate and still need deployment:

- The complete automated contract, domain, server, store, component, route, and regression suite
  passes.
- Static type checking and linting pass with no reported errors or warnings.
- The production build passes. Every route delivery artifact remains below the 500 kB
  uncompressed budget.
- 20 browser tests pass. Seven entries are intentionally skipped because one cross-route causal
  flow runs only on desktop and some checks apply only to their owning viewport.
- Chat Control, Knowledge, and Evaluation Lab pass at 1440 by 900, 390 by 844, and 320 by 568 CSS
  pixels.
- Automated Axe scans report no serious or critical violations.
- Browser checks report no document horizontal overflow, undersized mobile target, console error,
  or page error.
- Browser import checks cover unresolved, ready, selected, imported, and duplicate-disabled
  conversation states at 1440px, 390px, and 320px.
- Completed async Eval actions preserve newer Chat and Knowledge changes. A concurrent change to the
  same top-level Eval field returns a retry error instead of replacing newer state.
- Analyze failures reads latest failed active-bundle train evidence and, with an LLM configured,
  persists one exact pending Knowledge correction without activating it. The no-provider path remains
  deterministic.
- Shared schemas validate the approved API error body, backend-owned state without client route
  selections, workspace compare-and-swap success and conflict results, positive revisions, inbound
  speech artifacts, and playbook bundle pointers. The judge endpoint uses the shared API error
  contract for every tested failure path.
- The three-table migration enforces workspace revisions, Telegram update and delivery
  idempotency, explicit statuses, row-level security, and server-only service-role access.
- Fixed-workspace load, save, bootstrap, and synthetic reset validate server state. Save and reset
  use revision compare-and-swap; reset preserves Telegram conversations, Telegram speech artifacts,
  imported HITL cases, manual cases, and non-synthetic run history.
- Telegram text verification covers secret rejection, malformed payloads, unsupported updates,
  payload-hash mismatch, failed-event retry, duplicate webhook delivery, concurrent outbound
  requests, provider failure, accepted-delivery reconciliation, reload-safe browser metadata, and
  exact visitor-approved send across all three browser widths. Automatic-reply tests additionally
  prove one agent run and one delivery for a new inbound text update, no duplicate model run or
  send for a replayed update, automatic handoff acknowledgement, and booking/calendar delivery
  revision handoff.
- Agent contracts reject judge-only fields, invalid pins, invalid or excessive tool traces, and inconsistent
  handoff output. One server-owned prompt builder delimits pinned Knowledge content, bounded context,
  ordered messages, and the strict output schema for both live and sandbox modes.
- Eval artifact contracts separate agent-visible generation inputs from judge-only evidence, pin
  all suite dependencies, require complete agent and judge artifacts per committed attempt, and
  reject broken aggregate references or duplicate attempts.
- Server state defaults absent legacy Eval artifacts safely, freezes selected catalog cases only
  when a suite starts, persists deterministic manifests through the JSONB repository boundary, and
  removes seed suites plus dependent evidence without deleting pure HITL/manual suites.
- The server Eval path runs one frozen case through the shared sandbox agent and internal judge,
  validates both evidence sets, and appends one complete attempt only after the workspace revision
  check succeeds.
- Manual visual inspection covers the Eval import dialog at desktop and mobile widths and the
  Knowledge Before, After, line, and Why result at desktop width.
- Chat Control does not request Knowledge editor or Evaluation Lab delivery assets.
- Domain and service tests cover correction to inactive candidate, affected replay, full Ready gate,
  activation changing the Chat pin, rollback, dataset synchronization, and redacted LLM proposal
  input.
- Mobile route handoffs restore the last valid pane and selection.
- Independent behavior, design-specificity, causal-honesty, and code-quality review has no open
  blocker or important finding.

No known local static, unit, server, or production-build acceptance failure remains. Section 16
separates runtime configuration and post-POC work from the completed release workflow.

## 16. Remaining demo-runtime work

### Built supervision release loop

- Markdown-only SOP import into Knowledge; PDF and other source formats remain deferred.
- Server-backed LLM proposal of one exact, pending Knowledge diff from failed active-bundle train evidence.
- Inactive whole-playbook candidates from an accepted correction, a Knowledge draft, or imported Markdown.
- Affected train replay, then full train-plus-holdout replay, Ready gating, human activation, and
  immutable one-click rollback to the immediately prior SOP.
- Server dataset synchronization before frozen runs, allowing imported and manual cases in an existing
  Eval dataset to participate in the server replay.

### Still unproven or deferred

- Deploy and recheck the automatic Telegram text-reply path, outbound-voice transcript/playback,
  and live-Telegram Knowledge/Eval projection fixes. The local automated proof does not replace a
  provider-backed deployment smoke.
- A live Telegram-provider partial failure for Text + Voice. Deterministic fault injection proves
  that retry sends only the failed voice part; deliberately breaking a live delivery would be
  unsafe and would not improve the demo.
- Browser microphone permission and a freshly recorded staff-voice send on a physical microphone.
  The backend recorded-voice conversion and send path were verified using the owner's existing
  test audio.
- Dashboard authentication, authorization, clinic tenancy, and multi-user coordination before the
  public URL is shared beyond controlled demo use.
- DigitalOcean alert-recipient confirmation and a deliberate production-provider smoke-test record.
- Autonomous Telegram create/reschedule sends a publish `.ics`, and cancel sends a cancellation
  `.ics`, when calendar delivery is
  configured. Voice-originated agent replies now send concise text plus TTS voice after a saved
  transcription; live provider smoke and durable retry remain unproven.

### Decision record: no DigitalOcean model inference

Recorded 2026-07-17: the project will not migrate its agent or Eval text generation to
DigitalOcean Model Inference. Keep the existing direct OpenAI-compatible text provider, leave
`LLM_BASE_URL` empty for the OpenAI endpoint, and do not add or maintain a DigitalOcean inference
key. ElevenLabs remains an independent speech-only provider for STT and TTS.

This removes the extra model-access scope, model-availability, and function-continuation smoke
from the production checklist. DigitalOcean App Platform may still host the web service; hosting
and model inference are separate decisions.

### MVP completion order

Distilled from the former `docs/DEMO-DAY-IMPLEMENTATION-SPEC.md` (2026-07-14 fold). Full TypeScript
API shapes, Telegram sequence diagrams, and timeboxes remain recoverable from git history.

```text
0. Completed core supervision loop
  -> 1. configure Supabase and an LLM provider
    -> 2. prove Telegram text, then STT with English gloss
      -> 3. deploy the fixed workspace
        -> 4. optional voice, hosting, and demo-polish slices
```

The order is binding. Chat and Eval share the runner, and activation remains invalid before the
candidate's immutable full-suite evidence is Ready.

### Capability matrix

| Area | Current state | Required demo state |
|---|---|---|
| Chat, Knowledge, Eval routes | `BUILT` synthetic workbenches | Preserve layouts; connect real data and states |
| Booking changes and in-thread patient copy | `BUILT` synthetic controls plus autonomous Telegram create/reschedule/cancel tools and server-persisted Telegram Schedule edit/cancel | Deterministic fallback is always available; one admin may enable Google FreeBusy and event CRUD |
| Natural-language rubric editor and judge boundary | `BUILT` | Live judge needs API key; automated tests use simulated judge |
| Shared platform contracts | `BUILT` | API error body, aggregate CAS, Telegram voice/speech contracts, playbook pins |
| Analyze failures | `BUILT` with configured LLM; fallback without one | One pending exact diff, human review, and no optimization loop |
| Conversation source | `SIMULATED` | Seed data and local patient simulation |
| Translation | `BUILT` adapter, automated proof, and controlled live Malay translation | Output quality still requires human review by clinic staff |
| Telegram | `PARTIAL` protected inbound text/Whisper transcription, staff-approved text/voice delivery, and automatic reply for newly persisted live-agent text or transcribed voice when both live switches are enabled | Deploy and smoke the automatic path; partial provider failure remains deterministic-test-only |
| Candidate reply generation | `BUILT` Chat and five-seed Eval paths plus webhook-triggered live-agent text and transcribed-voice replies with autonomous booking tools under mocked proof | Broader live-provider quality validation remains unproven |
| Agent generation / shared runner | `BUILT` shared Chat and five-seed Eval runner with mocked proof plus durable automatic text/voice reply and function-call orchestration | Broader live-provider quality validation remains |
| Knowledge playbook influence | `BUILT` active-version pins for Chat and server Eval | Imported/manual cases in an existing dataset synchronize before frozen replay |
| Judge | `BUILT` server boundary | Internal semantic service used by Eval |
| Persistence | `BUILT` workspace CAS, delivery records, narrow outbox, and optional Google sync ledger | Live Supabase migration and owner credentials still require deployment smoke |
| Shared server data | `BUILT` fixed-workspace APIs with live Supabase persistence | Authentication, tenancy, and broader aggregate design remain deferred |
| Check saved text | `PARTIAL` local saved-text check | Candidate behavioral replay is available through the release controls |
| Knowledge changes | `BUILT` server-authoritative candidates, replay, activation, rollback | Live provider and shared-user authorization proof remain |
| Eval runs / production-path Eval | `BUILT` frozen server path with mocked-provider proof | Imported/manual cases synchronize into an existing dataset before server replay; live-provider proof remains |
| DigitalOcean App Platform runtime | `BUILT` deployed Docker service with healthy public readiness endpoints | Alert-recipient confirmation and ongoing monitoring are operational follow-up |

### Explicitly deferred

| Deferred item | Reason |
|---|---|
| WhatsApp and Twilio | Telegram must prove the channel-neutral flow first |
| Outlook/Calendly provider alternatives | Google is intentionally the single optional provider; do not add a second scheduler in the hackathon window |
| Additional booking tools | Four typed tools cover availability, create, reschedule, and cancellation without a broad scheduler |
| Human judge calibration dataset | Manual review is enough for the hackathon claim |
| Fully normalized conversations and Eval definitions | A revisioned workspace aggregate is faster and replaceable |
| Authentication, onboarding, and role management | One visitor opens the fixed demo workspace |
| Patient accounts | Messaging identity is enough for the first slice |
| EHR or clinic-management-system integration | Communication supervision first, not clinical-system replacement |
| EHR/PMS or multi-calendar scheduling engine | The MVP uses deterministic fallback plus one optional Google Calendar; clinic authority is post-demo |
| Vector database | Two to twenty playbook files fit deterministic routing and full-text search |
| Multi-agent orchestration | One autonomous agent with clear tool traces is easier to inspect |
| Fine-tuning | Playbooks, prompts, traces, and evals must work first |
| Real clinical advice | Administrative work only; clinical questions hand off to staff |
| Full analytics suite | Run traces and a small release scorecard are enough |
| Production capacity claims | The demo proves behavior, not load or clinic readiness |
| Browser Realtime proof, inbound calls, and outbound dispatch | Decision deferred; no build commitment exists |

### Proposer, replay, activation, and rollback

Without an LLM provider, deterministic Analyze failures remains the fallback. With one configured,
the server-side structured-output proposer receives the active pinned SOP files, the selected failed
train case identifier, failed criteria, and a generic redacted candidate summary. It never receives
holdout cases, hidden expected responses, or patient identifiers. The returned old text must occur
exactly once in the selected active file before a pending correction is stored.

Behavioral replay runs the shared sandbox agent against an inactive candidate. It starts with
affected train cases, then runs the full train and holdout suite. A passing replay keeps every case
as regression evidence; it does not claim that a failure is permanently solved. Text presence remains
a unit test only. It is never the user-facing behavior verdict.

```text
active version
  -> edit or accepted correction
  -> inactive candidate
  -> affected train replay
  -> full train + holdout suite
  -> Ready
  -> human Activate
  -> prior active becomes the one rollback target
```

Activation requires a matching workspace revision, the current candidate pointer, a candidate-pinned
full-suite snapshot, and Ready release status. Activation performs
one atomic write: the current active version becomes `rollbackTargetVersionId`, the ready candidate
becomes active, and the candidate pointer clears.

Rollback has no target picker. It can only use the current `rollbackTargetVersionId`; the Knowledge UI
disables it while a draft is dirty or a release request is in flight, and the server rejects a
current candidate or missing target.

```text
validate the one rollback target
  -> copy its complete file tree into a new immutable version
  -> parentVersionId = current active version
  -> restoredFromVersionId = rollback target
  -> kind = restore
  -> activate the new version
  -> set the prior active version as the next rollback target
  -> increment workspace revision
```

All versions remain in internal history. Existing conversations, sent messages, bookings, and
committed Eval evidence never change. An in-flight agent request finishes with its pinned version;
the next request loads the new active version.

| Situation | Required behavior |
|---|---|
| No rollback target exists | Hide or disable Rollback |
| Dirty draft exists | Knowledge UI disables rollback until Save or Discard |
| Candidate exists | Block until Activate or Discard |
| Eval replay is running | Block until completion or cancellation |
| Server write fails | Commit nothing |

Knowledge retrieval for live runs:

| Playbook count | Retrieval |
|---|---|
| 1 to 5 | Deterministic case-type mapping; inject the complete approved file |
| 6 to 20 | Match scope, language, and tags; inject at most three complete approved files |
| 21 to 2,000 | Postgres full-text search over approved files, then pin the exact returned versions |

No draft, rejected correction, or unapproved file enters a live run.

### Post-MVP backlog

1. **Read-only KaunterAI MCP:** expose conversation, Eval, active-playbook, pending-correction, and
   release-status evidence to operator clients such as ChatGPT and Codex. It reads the current
   revisioned workspace aggregate; normalized domain tables are not required.
2. **Later backlog:** full messaging expansion and calendar integration remain optional after the
   demo loop is complete.
3. **Decision deferred:** browser Realtime latency proof, inbound phone calls, and outbound
   dispatch have no committed design or build order.
4. **Text provider:** keep direct OpenAI-compatible generation; a DigitalOcean inference migration
   is explicitly out of scope for this MVP.

### Post-POC complete-target gaps

These are future product considerations, not committed hackathon work:

- Authentication, roles, clinic tenancy, and multi-user conflict handling.
- Normalized domain tables, durable audit, backup, disaster recovery, observability, and capacity
  proof.
- WhatsApp, SMS, email, clinic calendar, medication, chart, and clinical-system integrations.
- Durable queues, background retry scheduling, judge calibration, statistical confidence, and
  experiment tracking.
- Collaborative editing, semantic merge, and production permission boundaries for playbook
  changes.
- Real assistive-technology testing, full localization audit, browser-support policy, and offline
  installation.

## 17. Post-POC channel, hosting, and complete-target path

Distilled from the former `PRODUCTION-ROADMAP.md` (2026-07-14 fold). Option-space matrices and
full Meta comparison tables remain recoverable from git history. Deploy topology and env vars live
in `README.md`.

This path is reference material only. It is not the hackathon backlog. Section 16 owns the locked
MVP sequence and the first post-MVP item.

### Later channel backlog

After the supervision MVP, these channel slices may be added one by one. Do not start this table
before the MVP. Do not start WhatsApp until the Telegram path in this table passes.

| Priority | Slice | User-visible result | Exit gate |
|---|---|---|---|
| P0 | Telegram text vertical slice | A message from any chat appears in Chat; a live-agent text conversation can receive one automatic reply | Duplicate webhook delivery creates one message; duplicate update creates no second agent run or delivery |
| P0 | Inbound voice transcription | A patient voice note becomes an original-language transcript plus English staff gloss | Audio failure keeps the message and supports retry or a manual transcript |
| P0 | Real agent draft with Knowledge grounding | Visitor requests a draft produced from the approved playbook version and conversation | Every draft records model, prompt, playbook version, input messages, latency, and stop reason |
| P0 | Visitor-approved multilingual send | Visitor writes English, edits the patient-language preview, then sends Text, Voice, or Both | Staff-triggered delivery requires a final visitor action; automatic reply is a separate inbound-text path |
| P0 | Production-path Eval | Eval runs the same agent runner with side effects disabled | The case stores the full run artifact and separate judge artifact |
| P1b | Booking calendar attachment | A confirmed or rescheduled Telegram booking includes an add-to-calendar file | Reschedule uses the same event identity and a higher revision |
| P1c | WhatsApp adapter after the P0 gate | The same draft, approval, voice, and trace flow works on WhatsApp | Direct Meta and Twilio probes decide the provider; no Chat UI rewrite |

### Telegram first

Telegram is the first channel because its Bot API supports webhooks, text, voice, and documents. A
bot cannot start a private conversation; the test patient must message or open the bot first. Use
long polling for local smoke tests, an HTTPS App Platform webhook with secret for deploy, `update_id`
uniqueness for duplicates, `sendVoice` for voice, and `sendDocument` for `.ics`.

If a process crashes while delivery is `sending`, fail closed. Do not auto-resend. Telegram Bot API
has no request idempotency key that makes automatic resend safe.

### WhatsApp second

Prefer direct Meta Cloud API if native voice-note UX matters (`voice: true`, mono OGG/Opus). Twilio
is useful for sandbox setup but adds a per-message fee; native voice-note rendering via Twilio is
unverified until a device probe. Free-form WhatsApp service messages sit inside the open 24-hour
customer service window; outside it, approved templates are required. Meta Business Agent currently
excludes the Health business vertical. Ordinary WhatsApp Cloud API can still support healthcare
services that do not transact restricted healthcare products, with patient opt-in, local law, clinic
policy, consent, and Meta account approval.

### Voice and translation

1. Load the patient's saved language preference; missing or unknown means English.
2. Visitor writes English.
3. The server generates a patient-language translation.
4. Visitor edits the translation.
5. Visitor chooses Text, Voice, or Both.
6. The server generates speech.
7. Visitor plays the exact audio.
8. Visitor sends.

Telegram `sendVoice` requires OGG with Opus. The adapter must request and validate Opus before
preview. Both sends text first, then voice. Text success plus voice failure shows Partially sent
and retries voice only. Disclose that the voice is AI-generated. Use a separate TTS adapter even
when OpenAI is selected.

### Booking calendar

A calendar projection stores stable `calendar_uid`, integer `calendar_sequence`, timestamp,
timezone, start, end, location, and status. Reschedule keeps the same `UID` and raises `SEQUENCE`.
Cancellation uses `METHOD:CANCEL` and another sequence increment. Telegram can carry `.ics` as a
document. WhatsApp does not guarantee `.ics`; send a secure expiring Add-to-calendar link instead.
This is calendar convenience, not clinic calendar integration.

### Privacy boundary

Malaysia treats health information as sensitive personal data. The first live slice uses synthetic
health details and the operator's own Telegram account, collects no identity-card number,
diagnosis, medical record, payment, or insurance data, shows a consent notice, provides deletion
and export before external pilot use, keeps clinical and urgent cases in human handoff, records who
approved each external send, and completes legal and clinic-policy review before real patient use.

### Meta Business Agent response

Meta already covers live channels, multilingual support, knowledge, connectors, handoff, agent
test, and agent eval. KaunterAI should own clinic workflow state, consent evidence, audit history,
staff approval of translated text and generated audio, SOP versions, promotion, rollback, production
replay, train/holdout governance, human calibration, and provider-neutral channel and agent
boundaries. Rent WhatsApp transport, model generation, translation, transcription, speech, and
commodity connectors. If Meta Business Agent becomes Health-eligible, treat it as an optional
agent provider behind KaunterAI approval and release gates, never as the system of record for clinic
policy.

### Complete-target dependency order

After the approved POC, build the complete target in this order because each later step depends on
the earlier contract:

1. **Identity and tenancy**
   - Define clinic, staff, role, and authorization boundaries.
   - Separate read, patient-visible write, booking mutation, and playbook approval permissions.

2. **Authoritative persistence**
   - Move conversations, playbooks, evals, runs, and decisions to a shared server store.
   - Validate every request and response against a versioned transport schema.
   - Keep route selections, open panes, and other client-only state outside server-owned records.
   - Add migrations, backups, retention, and tenant isolation.

3. **Concurrency and audit**
   - Version every mutable playbook and evaluation entity.
   - Reject stale writes.
   - Record actor, before, after, reason, and time for consequential changes.

4. **Messaging and clinic integrations**
   - Connect one patient channel first.
   - Add idempotent inbound message handling.
   - Process one inbound message through one bounded run.
   - Stop each run on the next question, final reply, handoff, urgent escalation, or max-step
     limit.
   - Persist the decision trace before sending a reply or creating a handoff.
   - Connect scheduling only after booking state transitions are proven.

5. **Model gateway**
   - Keep generation input separate from grading reference data.
   - Version prompts, tools, and model configuration.
   - Normalize provider output behind one internal decision contract.
   - Let the model propose actions; let application policy authorize tools and side effects.
   - Return typed tool failures instead of raw exceptions.
   - Log latency, cost, failure, and fallback.

6. **Evaluation service**
   - Run cases outside the browser.
   - Preserve immutable run artifacts.
   - Calibrate the model judge against human labels and keep deterministic fixtures for regression
     tests.
   - Keep train and holdout governance explicit.

7. **Production Knowledge**
   - Generate proposed deltas against versioned playbooks.
   - Require human evidence review.
   - Use semantic or line-addressed patches rather than first-match replacement.
   - Stage, run offline regression replay, canary, and rollback before broad promotion.

8. **Operational readiness**
   - Real screen-reader review.
   - Security review and threat model.
   - Load and failure testing.
   - Monitoring, alerts, support runbooks, and incident rollback.

## 18. Update protocol

This is the canonical product contract.

When behavior or page design changes:

1. Read `SOUL.md` before changing visual hierarchy or page geometry.
2. Update the relevant route contract and ASCII frame in present tense.
3. Update `SOUL.md` only when the product's attention model, visual posture, or reference rules
   change.
4. Update the fixture inventory when seed data changes.
5. Update the source-of-truth or migration section when persisted shape changes.
6. Add every new regression lesson to Review-derived failure prevention.
7. Add or update its acceptance checkbox.
8. Re-run the full automated suite and browser matrix.
9. Update `last_updated`, `last_verified`, and verification status with fresh evidence.
10. Keep implementation libraries out of normative requirements.
11. Put exact framework commands, source paths, and package choices in implementation docs, not
   this product contract.
12. Never claim a production integration exists because the synthetic demo models it.
13. Keep provider capability, eligibility, pricing, and competitive comparisons in section 17;
    keep stack-specific runbook detail in `README.md`.

The document is complete only when a cold implementer can rebuild the same user behavior,
failure handling, data integrity, route handoffs, responsive layouts, and verification gates
without knowing the current stack.

## 19. Booking notifications and semantic judging

This section defines the detailed local behavior behind sections 7.10 and 8.5. Patient messaging
remains inside the synthetic conversation. The judge can use OpenAI only when the local server has
provider credentials; automated tests use an explicitly simulated judge.

### 19.1 Booking events

The booking lifecycle distinguishes:

- pending request;
- approved appointment;
- rejected pending request;
- cancelled approved appointment.

The user-visible event depends on the before and after booking state:

| Before | Change | Patient-visible event |
|---|---|---|
| Pending | Staff approves the request | Appointment confirmed |
| Pending | Staff changes requested details | Appointment request updated |
| Pending | Staff rejects the request | Requested appointment could not be confirmed |
| Approved | Slot changes | Appointment rescheduled |
| Approved | Provider or other non-time details change | Appointment details updated |
| Approved | Staff cancels the appointment | Appointment cancelled |

The application does not describe a pending request as rescheduled and does not describe a
rejected pending request as a cancelled appointment.

### 19.2 Save and notify

Every booking mutation that changes patient-facing facts shows the exact simulated patient message
before commit. The primary edit action is **Save and notify**.

Commit is one product action:

1. Re-read the current booking and reject a stale edit.
2. Save the booking transition.
3. Append one patient-visible staff message.
4. Append one separate system audit message containing the event, fixture time, and relevant
   booking facts. Edit audits also contain before and after details.
5. Update Schedule.

If the booking did not change, Save and notify remains disabled. The notification cannot be
silently turned off. The core date, time, reason, and event wording come from the saved booking;
staff cannot edit those facts into disagreement with the booking.

The patient message:

- uses the patient's preferred language, defaulting to English when missing or unknown;
- retains an English gloss for staff when the patient language is not English;
- includes local date and local time;
- excludes the booking reason by default;
- ends with one reply path for corrections or help;
- remains a local conversation message and never claims external delivery.

Examples:

- confirmed: "Your appointment is confirmed for Thu, 9 Jul at 9:00 AM.
  Reply here if anything is incorrect.";
- rescheduled: "Your appointment has been rescheduled to Fri, 10 Jul at 2:30 PM.
  Reply here if this does not work for you.";
- details updated: "Your appointment details were updated for Fri, 10 Jul at 2:30 PM.
  Reply here if anything is incorrect.";
- rejected request: "We could not confirm your requested appointment for Thu, 9 Jul at 9:00 AM.
  Reply here and we will help find another slot.";
- cancelled: "Your appointment on Thu, 9 Jul at 9:00 AM has been cancelled.
  Reply here if you need help booking another time."

### 19.3 Natural-language rubric

A rubric is one reusable natural-language description of what a good reply must do.

It contains:

- identifier;
- short name;
- instruction in plain language;
- required-to-pass flag;
- optional case-type scope;
- optional good and bad examples;
- version.

The default editor shows only:

1. **Rule name**.
2. **What should a good reply do?**
3. **Required to pass**.

Good and bad examples live under Advanced. The editor does not expose text-to-check, must-include,
must-not-include, regular-expression, token-overlap, or similarity-threshold controls.

### 19.4 Judge boundary

The generator cannot read the expected staff response, prior grade, judge rationale, or judge
prompt. The judge receives:

- ordered conversation input;
- candidate response;
- hidden expected staff response;
- selected rubric versions;
- optional good and bad rubric examples.

Conversation content, candidate text, and expected text are data, not judge instructions. The
judge follows one versioned server-owned prompt and returns structured data:

- overall verdict: pass, fail, or needs review;
- score from 0 through 1;
- one pass, fail, or uncertain verdict per rubric;
- one short reason per rubric;
- one candidate-response evidence quote per rubric when that response contains supporting text;
- provider, model, prompt version, rubric versions, run identifier, latency, and token metadata.

The server validates the structured response before persistence. Malformed output, timeout, or
provider failure produces an error and commits no new case evidence.

Application policy derives the overall state:

- any required rubric fails -> Fail;
- any required rubric is uncertain -> Needs review;
- every required rubric passes -> Pass.

No regular expression, exact phrase, substring, token overlap, or embedding threshold decides
semantic response quality.

### 19.5 Secure server execution

The browser sends one bounded judge request to a server endpoint. Provider credentials remain on
the server. The endpoint:

- applies per-address rate limiting;
- applies a 64 KiB request limit and 30-second timeout;
- treats all conversation content as untrusted data;
- returns validated structured output;
- records model, prompt, rubric, latency, and token metadata for successful runs;
- does not expose provider credentials or the full server prompt.

Authentication, authorization, and tenant access remain production gaps. Telegram automatic replies
and Google Calendar synchronization now use durable, fenced Postgres jobs with provider-failure
records. The UI owns judging, complete, needs-review, error, retry, and cancelled states.
Cancellation prevents a late result from committing. A successful rerun appends a new immutable
history row while replacing the case's latest evidence.

### 19.6 Calibration and release boundary

Model judging is not a clinical correctness claim. Before a model judge can gate a production
release:

1. Human reviewers label a representative calibration set.
2. The judge is compared with those labels by rubric, case type, and language.
3. False passes, false failures, and uncertain cases are reviewed.
4. Model, prompt, and rubric versions are pinned for each run.
5. A changed model, prompt, or rubric reruns calibration before becoming the default.
6. Uncertain results and safety-sensitive disagreements require human review.

The synthetic application may mock the server response for deterministic tests, but the UI must
label a mocked result as simulated and never present it as a live LLM verdict.

### 19.7 Acceptance gates

- [ ] Booking confirmation, update, reschedule, rejection, and cancellation produce distinct
      patient-visible messages.
- [ ] Save and notify previews the exact message and commits no change when the booking is stale.
- [ ] Booking mutation, patient message, audit, and schedule update are atomic at the product
      boundary.
- [ ] Scoring-rule authoring uses plain-language rubrics with no pattern controls.
- [ ] Each judge result shows per-rubric verdict, reason, and evidence.
- [ ] Required rubric failure produces Fail; required uncertainty produces Needs review.
- [ ] Provider credentials never enter the browser bundle or persisted client state.
- [ ] Malformed, timed-out, cancelled, or late judge responses never commit as Pass.
- [ ] Every persisted judge result records model, prompt, rubric, run, latency, and available token
      metadata.
- [ ] Deterministic tests use explicit mocked judge responses labeled as simulated.
