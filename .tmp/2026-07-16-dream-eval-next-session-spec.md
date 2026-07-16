---
status: proposed
created_at: 2026-07-16T01:05:00+08:00
scope: product and UX follow-up; no implementation in this artifact
owner: Bryan Lai
repo: C:\Users\wbrya\OneDrive\Documents\GitHub\codex-july-hackathon-official
branch: main
source: operator feedback plus local code inspection on 2026-07-16
---

# Dream, Eval, and Live Chat Follow-up

## Answer First

1. **No, `Analyze failures` is not a Codex-session Dream cycle.** It analyzes committed failed Eval cases and proposes exact SOP corrections. It must stay a clinical/product loop.
2. **A Codex-session miner is feasible only as a local developer tool.** Codex transcripts live on the developer machine under `~/.codex/sessions`; a deployed browser app on DigitalOcean cannot read them. Do not make a public dashboard button that silently mines them.
3. **The strongest demo remains Eval -> exact Dream correction -> replay -> Ready -> Activate -> next Chat reply.** That is the clinical wow moment. Session mining is supporting developer tooling, not the core patient-workflow story.
4. The Chinese voice report is a real quality gap, but the current inspection does not prove one root cause. The next session must reproduce it with a controlled message and inspect the exact translated text passed to TTS before changing code.

## Verified Current State

| Area | What exists | Evidence | Gap |
|---|---|---|---|
| Eval failure analysis | `Analyze failures` opens a proposal drawer and can route a correction into Dream | `src/routes/eval/eval-drawers.tsx:41`, `src/routes/eval/eval-route.tsx:428` | It is not a session-memory miner. |
| Dream workbench | Playbook files, pending corrections, candidate replay, activation, rollback | `src/routes/dream/dream-route.tsx:339`, `:364`, `:400`, `:426` | The value hierarchy is spread across panes rather than one obvious release path. |
| Live translation | Composer selects a language and calls `/api/translation` before send | `src/routes/chat/thread-pane.tsx:609`, `:623`, `:376`; `src/store/telegram-slice.ts:674` | No durable translated-preview state makes it hard to prove what text TTS will speak. |
| Outbound voice | Send passes the approved text and target language into voice preparation | `src/store/telegram-slice.ts:374`; `server/telegram-outbound-service.ts:488` | The UI does not show the exact text/language being synthesized or persist a clear voice-input audit field. |
| Patient identity | Live Telegram domain permits null phone and MRN values | `src/contracts/app-state.ts:302` | Telegram does not provide a phone number automatically; the UI renders blank fields rather than an honest unavailable state. |
| Labels | Labels can be added/removed and influence routing | `src/routes/chat/patient-rail.tsx`, `src/domain/telegram.ts`, `src/domain/eval-workspace.ts:26` | Do not assume every live conversation receives an automatic clinical label or a label provenance. |
| Progress feedback | Composer has local generating/translating/sending state; Dream has loading/pending surfaces | `src/routes/chat/thread-pane.tsx:271`, `:373`, `:630`; `src/routes/dream/dream-route.tsx:512` | There is no shared, durable operation-status model across Chat, Eval, and Dream. |

## Product Decisions

### A. Keep two meanings of Dream separate

| Name | Input | Output | Where it runs | Recommendation |
|---|---|---|---|---|
| **Clinical Dream loop** | Failed Eval evidence + active SOP | Exact inactive SOP candidate | KaunterAI server | Build/polish now. This is the demo. |
| **Developer session miner** | Explicitly selected Codex transcripts or exported session corpus | Suggested operating rules and a Markdown handoff | Local dev tool only | Backlog it. Do not put it in the public clinic product yet. |

Do not rename `Analyze failures` to “Dream cycle.” Its truth is: **propose an SOP correction from failed tests; it changes nothing until a human accepts and activates it.**

### B. Patient identity is intentionally incomplete

- **MRN** means *medical record number*: a clinic-assigned identifier, not a Telegram identifier.
- A Telegram bot does not receive a patient's phone number by default. It can receive a contact only if the person explicitly shares one.
- Never infer a phone number or MRN from a Telegram handle, display name, or chat ID.

Minimal UI change:

```text
Phone  Not provided by patient
MRN    Not assigned
```

Keep “Edit patient” for staff entry. A later identity-integration slice can add “Link clinic record,” but that is not required for the demo.

### C. Labels need provenance before claiming they are automatic

Use two visible groups:

```text
System labels: Telegram · Booking candidate
Staff labels:  Follow-up
```

Each system label needs a source (`channel`, `route`, `risk detector`, or `manual import`). Do not silently convert an LLM guess into a clinical routing fact. The first minimal version can keep current labels and add source text only to auto-assigned labels.

## Proposed Work, Ordered

### P0 — Make active work visible everywhere

Create one small operation-status contract, not separate ad hoc spinners:

```ts
type OperationStatus = {
  scope: "draft" | "translation" | "delivery" | "eval" | "proposal" | "replay" | "activation";
  state: "idle" | "running" | "succeeded" | "failed";
  message: string;
  startedAt?: string;
  retry?: { label: string; action: "retry" | "open" };
};
```

UI rules:

1. Disable only the control whose operation is running; keep context readable.
2. Show a verb, object, and next state: `Generating draft…`, `Translating to Mandarin…`, `Preparing Mandarin voice…`, `Running 5 Eval cases…`, `Replaying affected cases…`.
3. On failure, name the failed operation and preserve a retry/open action. Never show only a spinner or generic “something went wrong.”
4. On success, leave a short durable receipt: `Voice sent`, `1 candidate created`, `4/5 train passed`.

Acceptance criteria:

- Every Draft, Translate, Send, Run case, Run suite, Analyze failures, Replay, Activate, and Rollback action exposes `running`, `succeeded`, or `failed` UI.
- Browser refresh never converts a known submitted delivery into an ambiguous idle state.

### P0 — Fix and prove translated TTS before expanding voice

Observed symptom: English staff text was intended to become Mandarin voice, but the received voice appeared to speak English.

Do not guess which layer failed. Reproduce only in the approved owner test chat with a harmless fixed sentence.

Required trace:

```text
English draft
  -> translation response: target language + translated text
  -> staff-visible preview and approval
  -> voice-preparation request: exact text + requested language
  -> TTS artifact metadata: language + text hash
  -> Telegram voice receipt
```

Minimal product fix after reproduction:

1. Store a `translatedPreview` separately from the editable English draft.
2. Require an explicit “Use Mandarin preview for delivery” state before enabling Voice or Text + Voice.
3. Show `Voice will speak Mandarin` and the exact non-English preview beside Send.
4. Persist `spokenTextHash`, `spokenLanguage`, and TTS model in the existing delivery record. Do not persist raw sensitive text twice if the existing approved text is sufficient.
5. Add one integration test that asserts the TTS provider receives the translated text, not the original draft.

Acceptance criteria:

- English input translated to Mandarin renders Chinese characters in the approval preview.
- Voice-only and Text + Voice both send the same translated text to TTS.
- The delivery receipt shows target language and a staff-verifiable text preview/hash.
- If translation fails or has not been approved, voice delivery is blocked with a clear reason.

### P0 — Make Eval the demo’s control tower

Simplify the Eval page around one question: **Did the active SOP handle this safely, and what is the controlled next move?**

Top section, in this order:

```text
Active SOP: v1                         Latest suite: 3/5 passed
1 failed safety criterion              [Analyze failure]
```

Case list:

- Large PASS / FAIL chip, not color alone.
- Failed criterion named in the list row.
- One selected-case panel: Patient input -> Expected behaviour -> Actual reply -> Failed criterion -> Why.
- `Analyze failure` copy: “Proposes an inactive SOP edit. It does not change the live agent.”

The Analyze drawer should end with one clear action:

```text
Exact SOP correction proposed  ->  [Review in Dream]
```

Acceptance criteria:

- A viewer can identify the failed case and criterion in under five seconds.
- A viewer can explain that Analyze does not retrain or activate anything.
- One click from a failed case opens the exact correction in Dream.

### P0 — Make Dream the release gate, not a file browser

Dream’s hero state should be the candidate’s lifecycle:

```text
Candidate v2 — Inactive
Created from: Eval case “booking language clarity”
Affected replay: 1/1 improved
Full suite: 5/5 train · 2/2 holdout
Status: Ready                         [Activate v2]
```

Keep file navigation, but subordinate it beneath the release story. The order is:

1. Exact diff: current SOP text vs proposed text.
2. Why: linked failed criterion and Eval evidence.
3. Proof: affected before/after, then full train and holdout.
4. Human decision: accept candidate, activate, or discard.
5. Safety: visible one-step rollback to the prior active version.

Acceptance criteria:

- “Inactive”, “Needs replay”, “Ready”, and “Active” are text labels, not inferred from color.
- Activate is disabled with the exact missing gate named.
- After activation, Chat visibly identifies the active SOP version used for the next draft.
- Rollback says exactly which version will become active.

### P1 — Local developer session-miner command

Implement only after P0. Do not add it to the public app shell.

Shape:

```text
Local command: npm run dream:mine -- --session <path-or-id>
Input: one explicitly chosen Codex transcript or exported corpus
Output: .tmp/<date>-operator-session-insights.md
Contents: pattern ledger, candidate rule homes, candidate skill homes, no-op duplicates, and approval-needed changes
```

Use the existing `dream-cycle` distiller, which now understands Codex Desktop transcript files. It must:

- read only explicitly selected local transcript paths;
- redact secrets before writing output;
- never upload raw transcript text;
- propose changes first; require human approval to patch rules or skills;
- never be reachable from the deployed dashboard.

The popup requested by the operator belongs to this local tool, not the clinic app:

```text
Session insights ready — 3 patterns found, 1 proposed rule, 0 new skills.
[Open Markdown] [Open Dream notes]
```

## Deliberately Out of Scope

- Public dashboard access to `~/.codex/sessions` or any developer filesystem.
- Automatically writing skills/rules from a deployed app.
- Inferred patient identity, automatic MRN creation, or phone-number scraping.
- Real clinic integration, appointment `.ics` sending, or new external infrastructure.
- Replacing the existing Dream-to-Eval workflow with generic “agent memory.”

## Dependency Order

```text
Operation status ---------------------> clearer Chat / Eval / Dream feedback
Translated-preview trace -------------> trustworthy Mandarin TTS proof
Eval control-tower hierarchy ---------> obvious failure -> Analyze action
Dream lifecycle hierarchy ------------> replay -> Ready -> Activate -> Rollback demo
All P0 proof complete ----------------> optional local developer session miner
```

## First Next-Session Move

1. Reproduce the Mandarin TTS failure with one approved harmless message and capture each value in the required trace.
2. Inspect the current Eval and Dream screenshots/routes against the P0 acceptance criteria.
3. Implement P0 in two focused changes: operation-status feedback first, then translated-preview/TTS correctness.
4. Run the full test gate and only then update the demo script.

## Questions To Resolve Before Coding

1. Should the display language say **Mandarin** or **Chinese (Mandarin)**? Recommendation: `Chinese (Mandarin)` in patient-facing staff UI; language code `zh` internally.
2. Does the voice failure mean English words were audible, or that Mandarin words used an English-sounding voice? Save the received Telegram voice note and inspect the translated text before diagnosing TTS.
3. For demo pace, should the Eval suite be five cases (credible) or three cases (faster)? Recommendation: keep five but show the affected replay first, then full-suite result.
