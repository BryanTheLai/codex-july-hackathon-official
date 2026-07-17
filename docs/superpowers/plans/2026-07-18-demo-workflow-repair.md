# Demo Workflow Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Execute inline with `minimal-root-cause-patch`; do not dispatch subagents.

**Goal:** Make conversation-owned booking, Eval validation, Knowledge activation, failure analysis, and the affected UI surfaces explicit and reliable without adding standalone customers or new infrastructure.

**Architecture:** Preserve the existing Supabase workspace aggregate and conversation-owned booking relationship. Add only the missing booking address field, make ownership visible, retry one malformed sandbox response, and safely append frozen Eval artifacts after unrelated compare-and-swap revisions when their suite pins remain valid.

**Tech Stack:** React 19, TypeScript, Zod, Zustand, Express, Supabase workspace aggregate, Vitest, Testing Library, Playwright.

## Global Constraints

- Existing customer conversations remain the only booking owners.
- No standalone booking, CRM, normalized booking tables, dependency additions, or schema loosening.
- Telegram and Calendar external effects remain separately controlled.
- Provider output must still pass the strict agent schema.
- Tests are written or tightened before each root-cause patch.

---

### Task 1: Make booking ownership and service location explicit

**Files:**
- Modify: `src/contracts/domain-primitives.ts`
- Modify: `src/domain/types.ts`
- Modify: `src/domain/chat.ts`
- Modify: `src/routes/chat/schedule-pane.tsx`
- Modify: `src/routes/chat/booking-dialog.tsx`
- Modify: `server/google-calendar-service.ts`
- Test: `tests/domain/chat.test.ts`
- Test: `tests/routes/chat-route.test.tsx`
- Test: `tests/server/google-calendar-service.test.ts`

**Interfaces:**
- `CreateBookingInput` requires `serviceAddress`.
- Existing stored bookings may omit `serviceAddress`; UI and calendar use an explicit fallback only for legacy state.
- Booking ownership remains `Conversation.id -> Conversation.booking`.

- [ ] Add failing tests proving creation requires an address and remains attached to the selected conversation.
- [ ] Add a visible “Book for” selector label and customer identity summary in the dialog.
- [ ] Require service address in new booking input and use it as Calendar location.
- [ ] Run focused booking/domain/calendar tests.

### Task 2: Remove the misleading UI states

**Files:**
- Modify: `src/routes/chat/chat.css`
- Modify: `src/routes/chat/patient-rail.tsx`
- Modify: `src/routes/eval/eval.css`
- Modify: `src/routes/eval/eval-filters.tsx`
- Modify: `src/routes/knowledge/knowledge-toolbar.tsx`
- Test: `tests/routes/chat-route.test.tsx`
- Test: `tests/routes/knowledge-route.test.tsx`
- Test: `e2e/chat.spec.ts`
- Test: `e2e/eval.spec.ts`

**Interfaces:**
- Channel identity is rendered once in the thread header.
- Schedule status badges size to content.
- Disabled release actions expose their prerequisite in visible copy.

- [ ] Add assertions for visible booking ownership, no redundant Telegram system label, compact status, and unclipped filters.
- [ ] Apply the smallest markup/CSS changes.
- [ ] Run route tests and responsive Playwright cases.

### Task 3: Recover once from transient malformed sandbox output

**Files:**
- Modify: `server/agent-service.ts`
- Test: `tests/server/agent-service.test.ts`

**Interfaces:**
- Live agent behavior is unchanged.
- Sandbox Eval retries exactly once only when final provider text fails strict parsing.
- The second invalid result remains a retryable provider failure with a sanitized reason.

- [ ] Add a failing test where sandbox output is malformed once and valid on retry.
- [ ] Add a control test proving live mode does not duplicate provider calls.
- [ ] Implement the one-retry sandbox boundary.
- [ ] Run agent service tests.

### Task 4: Preserve valid Eval work across unrelated workspace revisions

**Files:**
- Modify: `server/eval-service.ts`
- Test: `tests/server/eval-service.test.ts`

**Interfaces:**
- Frozen suite manifest, case, Knowledge bundle, and provider config must still match.
- On compare-and-swap conflict, reload and append the completed artifact to current state.
- Retry is bounded; changed/deleted suite state still fails.

- [ ] Add a failing test that mutates unrelated workspace state while agent/judge run.
- [ ] Add a failing test where suite pins change and commit is rejected.
- [ ] Implement a bounded frozen-artifact append retry.
- [ ] Run Eval service tests.

### Task 5: Make Analyze and Activate prerequisites explicit

**Files:**
- Modify: `src/routes/eval/eval-route.tsx`
- Modify: `src/routes/eval/eval-toolbar.tsx`
- Modify: `src/routes/eval/eval-drawers.tsx`
- Modify: `src/routes/knowledge/knowledge-toolbar.tsx`
- Test: `tests/routes/knowledge-route.test.tsx`
- Test: `e2e/eval.spec.ts`
- Test: `e2e/knowledge.spec.ts`

**Interfaces:**
- Analyze is actionable only with a committed failed train case.
- Activate is actionable only after complete passing candidate validation.
- Blocked controls state the exact next action.

- [ ] Add failing UI assertions for empty-failure and unready-candidate states.
- [ ] Replace empty drawers and mystery disabled controls with prerequisite copy.
- [ ] Run focused route and E2E tests.

### Task 6: Verify, review, document, and ship

**Files:**
- Modify: `README.md`
- Modify: `PROJECT.md`

- [ ] Confirm reset instructions include stop worker, migration, seed, guarded reset, and restart.
- [ ] Run `npm run verify`.
- [ ] Run lint diagnostics on changed files.
- [ ] Review the full diff for scope creep, schema compatibility, secrets, and stale clinic copy.
- [ ] Commit with proof-focused message and push `fix/demo-workflow-root-causes`.
- [ ] Report the remaining external reset as unproven until executed with owner credentials.
