---
status: in-progress
created_at: 2026-07-16T00:38:22+08:00
last_updated: 2026-07-16T00:46:00+08:00
source_transcript: C:\Users\wbrya\.codex\sessions\2026\07\14\rollout-2026-07-14T21-44-44-019f60df-6521-7643-905f-845cf8800df3.jsonl
scope: session handoff, not canonical product truth
owner: Bryan Lai
repos:
  - path: C:\Users\wbrya\OneDrive\Documents\GitHub\codex-july-hackathon-official
    branch: main
    head: c8fda1f61719657d3c753beced09eff0c3bfb07e
---

# KaunterAI Live Delivery Closeout Handoff

## Answer First

- The deployed app has live Supabase persistence, protected Telegram inbound delivery, and a controlled owner-chat smoke for text, voice, agent, translation, and Eval provider paths.
- Two root-cause fixes are locally verified but not deployed: persist accepted outbound voice messages across reload, and project live Telegram records into Dream and Eval.
- Booking changes are deliberately synthetic only. The UI now says no Telegram message was sent; no `.ics`, `sendDocument`, booking-dispatch endpoint, or provider reconciliation exists.
- Full local verification passed: lint, typecheck, build, 430 automated tests, and 18 Playwright executions with 3 intentional skips.
- Do not commit, push, deploy, rotate keys, or send further patient-facing/provider messages unless the operator explicitly asks.

## Mission

Finish and ship the smallest truthful KaunterAI demo slice: live Telegram intake and staff-approved outbound delivery, durable conversation evidence, Dream-to-Eval release flow, and clear operational status. Preserve a hard distinction between synthetic, deterministic fault-injection, provider-accepted, and end-to-end live proof.

## Repos And SHAs

| Repo | Branch | HEAD | Dirty? | Why it matters |
|---|---|---|---|---|
| `codex-july-hackathon-official` | `main` | `c8fda1f61719657d3c753beced09eff0c3bfb07e` | Yes | Contains the uncommitted reliability and truthfulness fixes described below. |

## Locked Decisions

1. Keep the current single-service Docker/App Platform architecture. Do not add a server, queue, tenancy model, or dashboard authentication in this demo slice.
2. Live provider proof uses only the operator's approved Telegram test chat. Do not test on clinic patients.
3. Do not deliberately sabotage live Telegram credentials or send uncertain duplicate messages to create a partial failure. Deterministic fault injection is valid only as a clearly labelled evidence lane.
4. Bookings remain synthetic until a real provider adapter, calendar attachment generation, and delivery reconciliation are implemented.
5. Do not switch to DigitalOcean inference until a model-scoped key exists and synthetic text and TTS smoke tests pass. Keep the documented base URL and Responses API TODO.

## Verified Facts

| Fact | Proof | Caveat |
|---|---|---|
| Direct provider Chat draft, live translation, five-case Eval run, and exact SOP proposal completed | Controlled owner-chat smoke recorded in `PROJECT.md` and `README.md` | This is a narrow smoke, not quality validation across languages or clinical cases. |
| Telegram text, AI TTS, and recorded-voice sends were provider-accepted | Controlled owner-chat smoke | Text + Voice partial failure was only tested through deterministic fault injection. |
| Accepted outbound voice did not appear after reload | Root cause in `server/telegram-outbound-service.ts` omitted the conversation message append | Fixed locally, not deployed. |
| Live Telegram data did not surface in Dream/Eval | Client-only domain parser rejected live nullable fields and `live_agent` | Fixed locally by merging live Telegram state before evaluation workspace projection, not deployed. |
| Booking UI must not imply patient notification | No provider booking-dispatch or calendar-file path exists | UI copy is corrected locally; actual calendar integration remains unbuilt. |
| Local code gate passed | `npm run verify`: 430 tests; Playwright 18 passed / 3 intentional skips | This does not replace a redeployed production smoke. |

## Unverified Or Assumed

| Claim | Why not proven yet | Next proof step |
|---|---|---|
| Deployment contains the two local reliability fixes | Changes are uncommitted and undeployed | Review, commit, push, let App Platform deploy, then run a controlled reload/Dream/Eval smoke. |
| A real Telegram Text + Voice partial failure can recover safely | Only deterministic fault injection was used | Test against a provider-recognized failure that cannot create duplicate patient messages, or retain this explicitly as deterministic-only proof. |
| Fresh staff microphone recording works in a real browser/device | Recorded-voice proof reused the operator's existing test clip | Use a physical microphone in the approved test chat. |
| App Platform alert recipients and policy are configured | Not independently verified | Check the App Platform alert-policy UI and record evidence. |

## Open Items

1. Review the uncommitted diff and deploy only after explicit operator authorization.
2. After deploy, send one controlled outbound voice to the approved test chat, reload Chat, and verify playback plus Dream/Eval visibility.
3. Add dashboard authentication, authorization, and clinic tenancy before making the dashboard public or exposing an MCP surface.
4. Build booking dispatch only as a dedicated slice: real booking source, `.ics`, Telegram document send, provider update/cancel trigger, and durable delivery reconciliation.
5. Complete the deferred DigitalOcean inference switch only after a separate model-scoped key and synthetic smoke tests.

## Do Not Touch

- Do not read, echo, commit, or rotate secret values. The operator already rotated relevant keys.
- Do not touch unrelated existing `.gitignore` or untracked `.agents/` work except the small rule fold explicitly requested in this closeout.
- Do not claim a live partial-failure proof from deterministic fault injection.
- Do not represent booking status mutations as external patient notification.

## Pattern Ledger

| Pattern | Evidence | Existing home | Action |
|---|---|---|---|
| Evidence must label synthetic, deterministic, provider-accepted, and end-to-end proof separately | Controlled partial-failure and provider smoke scope | `CLAUDE.md` core vows | Folded into the global evidence rule. |
| External sends need post-reload durable UI/audit proof | Accepted voice disappeared after Chat refresh | `CLAUDE.md` core vows | Folded into the same evidence rule. |
| Server-only variants must survive every UI projection | Live Telegram `null` fields / `live_agent` failed Dream/Eval projection | `CLAUDE.md` global invariants | Folded into the server-to-client boundary rule. |
| Unsupported integrations must be described truthfully | Booking UI implied patient update without any dispatch path | `CLAUDE.md` core vows | Folded into the product-copy claim rule. |
| Dream-cycle extraction must support the local agent runtime | The original distiller found zero Codex transcripts and then failed on Windows output encoding | `dream-cycle` bundled distiller | Folded into the existing script and workflow guidance; no new skill. |
| Canonical knowledge promotion | No `KNOWLEDGE_INDEX.md`, `RESOLVER.md`, `FOR_AGENTS.md`, or knowledge meta home exists in this repo or local gstack project | No canonical knowledge repository is configured | No action; the durable operator rules belong in `.agents/CLAUDE.md` and the session facts remain in this handoff. |

## File Anchors

- `server/telegram-outbound-service.ts:155` - stable outbound voice message ID.
- `server/telegram-outbound-service.ts:356` - accepted voice persistence and conversation synchronization.
- `src/domain/telegram.ts:231` - durable outbound voice conversation shape.
- `src/routes/chat/thread-pane.tsx:777` - reload-safe outbound voice playback controls.
- `src/domain/eval-workspace.ts:26` - merge live Telegram records into Dream/Eval workspace projection.
- `src/store/chat-slice.ts:56` - truthful synthetic-only booking status text.
- `PROJECT.md:2732` - remaining proof boundaries and deployment work.
- `PROJECT.md:2744` - deferred DigitalOcean inference provider switch.

## Next Agent Move

Read this handoff, inspect `git diff`, and wait for explicit authorization before any commit/push/deploy. If authorization arrives, deploy the two local fixes and run the controlled reload plus Dream/Eval smoke before saying the production experience works.
