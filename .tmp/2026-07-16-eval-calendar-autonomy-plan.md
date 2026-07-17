# KaunterAI: Eval, calendar, and agent truth plan

## Product sentence

KaunterAI turns multilingual Telegram clinic requests into staff-supervised operational work: triage, patient reply, booking, and a review loop that converts repeat mistakes into a gated SOP improvement.

## What is now proven locally

- Eval is a case workbench, not a dashboard: Case, Patient context, Result, Actions.
- A resolved staff conversation can be imported as an Eval case. The staff reply is grading evidence only; the replaying agent never receives it.
- A row opens a scrollable case-details dialog. Run, edit, duplicate, and delete controls are icon-only; mutating controls are disabled during an active suite.
- A suite marks its active case `Replaying...` and commits each finished local case immediately, rather than appearing idle until the entire suite ends.
- The only Eval summary cards are **Regression guard** (held-out pass rate) and **Open failures** (work needing review). This replaces generic score, delta, and duplicate history surfaces.
- Eval checks server capability before enabling a server run. A missing evaluator is displayed as unavailable, instead of failing after a user starts a suite.
- Dream uses explicit success/failure state. A stale correction says only that the saved text changed; it does not falsely claim an approval caused it.

## Verification completed on 2026-07-16

- `npm run lint` passed.
- `npm run typecheck` passed.
- `npm run test` passed: 62 files, 440 tests.
- `npm run build` passed.
- `npm run test:e2e` passed: 20 browser tests across 1440px, 390px, and 320px; 7 viewport-scoped tests skipped by design.
- Read-only live probe: `/readyz` returned 200 at workspace revision 48. The live deployment returned 404 for `/api/eval/capability`, so it is still the prior build and has not received these changes.

## Two useful Eval measures

1. **Regression guard pass rate**: held-out cases that still pass after an SOP change.
2. **Open failures**: the concrete review queue.

They answer the two staff decisions: "Did the change break anything?" and "What do I need to fix?" Do not lead with mean judge score, text similarity, or latest delta. For a future stronger quality metric, add `approvalEnvelope` and `handoffRequired` evidence to each case, then report supervisor-ready rate and handoff F2.

## Current capability boundary

| Area | Current truth | Not built |
| --- | --- | --- |
| Telegram | Inbound text/voice ingestion, manual staff delivery, TTS receipt path | Unattended reply loop |
| Agent | Manual draft generation from active playbooks and selected conversation | Tools, availability lookup, autonomous booking/closure |
| Booking | Existing booking display/edit state | Server-authoritative create/change command and availability provider |
| Calendar | No `.ics` generation or delivery | Calendar fields, idempotent ledger, Telegram document send |
| Eval | Local and configured-server replay paths, judge evidence, Dream link | Live provider credential proof in the deployed environment |

The synthetic-agent selector is not a live autonomous worker. Do not demo it as one.

## Minimal calendar implementation

Build this only after a durable booking command exists.

1. Add confirmed-booking calendar data: `uid`, `sequence`, `startsAt`, `endsAt`, `timeZone`, and `location`.
2. Add `calendar_deliveries` with booking/conversation IDs, booking revision, event UID/sequence, event type, content hash, status, provider receipt, and idempotency key. Enforce uniqueness on `(workspace_id, uid, sequence, event_kind)`.
3. Generate standards-compliant ICS with `ical-generator`; use a stable UID and increase sequence on edits/cancelations.
4. Send the ICS through Telegram `sendDocument` only for a confirmed future booking with patient consent. Never put medical reason or MRN in the event.
5. Automatically dispatch after an agent-created booking commits. Add `Send calendar` to each staff Schedule row for manual bookings. Unknown provider outcomes stay `unknown`; do not blindly retry.

Required additions: one library (`ical-generator`), one booking command, one delivery endpoint, one Supabase migration, and Telegram `sendDocument`. Do not add Google/Outlook integrations or an availability provider to the hackathon MVP.

## Safe autonomous-agent increment

1. Keep clinical/emergency, medication, and ambiguity cases as staff handoff only.
2. Allow autonomous replies only for an explicit narrow policy: clinic hours, location, and booking information gathering.
3. Add read tools for approved playbooks, clinic facts, and availability; add one write tool for a draft booking with idempotency key.
4. Require policy version, tool audit row, confidence/handoff reason, and a staff-visible transcript receipt.
5. Enable automatic calendar sending only after the booking write is durable and the patient consent rule passes.

## Twenty implementation options considered

| # | Option | Decision |
| --- | --- | --- |
| 1 | Hand-write ICS strings | Reject: fragile escaping and recurrence handling. |
| 2 | `ical-generator` | Select: small, standards-oriented dependency. |
| 3 | Google Calendar first | Reject: OAuth/demo scope bloat. |
| 4 | Outlook Calendar first | Reject: same bloat. |
| 5 | Email an invite | Reject: email identity is not the Telegram user. |
| 6 | Telegram `sendDocument` | Select: reaches the exact booking user. |
| 7 | Send a calendar URL | Reject: not an attachable calendar event. |
| 8 | Send ICS as chat text | Reject: poor mobile import. |
| 9 | Zip the ICS | Reject: needless friction. |
| 10 | One new UID per edit | Reject: duplicates events. |
| 11 | Stable UID plus sequence | Select: normal calendar update semantics. |
| 12 | No delivery ledger | Reject: retries can duplicate bookings. |
| 13 | Idempotent delivery ledger | Select: auditability and safe retry. |
| 14 | Synchronous agent send before commit | Reject: orphaned calendar events. |
| 15 | Send only after durable commit | Select. |
| 16 | Always auto-send staff bookings | Reject: staff may not want it. |
| 17 | Schedule-row `Send calendar` | Select for staff bookings. |
| 18 | Put reason/MRN in ICS | Reject: privacy leak. |
| 19 | Appointment-only ICS fields | Select. |
| 20 | Broad autonomous clinic agent | Reject for MVP; add one policy slice at a time. |

## Demo sequence

1. Incoming multilingual request -> agent draft and staff approval.
2. A reply or booking problem -> import/resolved case -> Eval row visibly replays.
3. Open failed evidence -> one Dream correction -> replay -> candidate ready.
4. After calendar phase: booking committed -> Telegram receives `.ics` -> staff Schedule row shows delivery receipt.

Each transition gives a visible state change within roughly 15-20 seconds. Never represent deterministic test fixtures, a manual draft, or an unconfigured provider as autonomous live execution.

## Sources

- Anthropic, [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- OpenAI, [Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)
- RFC 5545, [UID](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.8.4.7) and [SEQUENCE](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.8.7.4)
- Telegram, [sendDocument](https://core.telegram.org/bots/api#senddocument)
