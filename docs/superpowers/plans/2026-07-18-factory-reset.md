# Factory Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Reset action fully clear demo activity and restore the compiled canonical seed while preserving credentials.

**Architecture:** Keep `POST /api/demo/reset` as the browser boundary. Move destructive database cleanup into one transactional Supabase RPC, with server-owned Google Calendar and voice-object cleanup around it. Replace client merge-reset behavior with authoritative state replacement and cache clearing.

**Tech Stack:** TypeScript, React, Zustand, Fastify, Supabase/Postgres, Vitest, Playwright.

## Global Constraints

- Preserve `google_calendar_connections`, `demo_seed_templates`, schema, and environment credentials.
- Delete all workspace activity, including Telegram audit rows and sent deliveries.
- Validate the compiled seed before any destructive step.
- Require the literal confirmation text `RESET`.
- Do not commit changes unless explicitly requested.

---

### Task 1: Transactional database factory reset

**Files:**
- Create: `supabase/migrations/20260718020000_factory_reset_demo_workspace.sql`
- Modify: `server/supabase.ts`
- Test: `tests/server/demo-seed-builder.test.ts`

**Interfaces:**
- Consumes: compiled row in `public.demo_seed_templates`.
- Produces: RPC `reset_demo_workspace(p_workspace_id text, p_seed_key text, p_expected_revision bigint)` returning reset counts, new revision, and credential-preservation flags.

- [ ] **Step 1: Write the failing migration contract test**

Assert the migration deletes `outbox_jobs`, `google_calendar_events`, `calendar_deliveries`, `telegram_deliveries`, and `telegram_events`; replaces `demo_state.state` from the compiled template; checks expected revision; and does not delete `google_calendar_connections`.

- [ ] **Step 2: Run the contract test**

Run: `npm test -- tests/server/demo-seed-builder.test.ts`

Expected: FAIL because the new migration and full-delete assertions are absent.

- [ ] **Step 3: Implement the RPC**

Use a single `plpgsql` function transaction:

```sql
if v_workspace.revision <> p_expected_revision then
  raise exception 'revision_conflict';
end if;

delete from public.outbox_jobs where workspace_id = p_workspace_id;
delete from public.google_calendar_events where workspace_id = p_workspace_id;
delete from public.calendar_deliveries where workspace_id = p_workspace_id;
delete from public.telegram_deliveries where workspace_id = p_workspace_id;
delete from public.telegram_events where workspace_id = p_workspace_id;

update public.demo_state
set state = v_template.state,
    revision = revision + 1,
    updated_at = now()
where workspace_id = p_workspace_id;
```

Return deleted row counts and `oauth_preserved = true`.

- [ ] **Step 4: Add the typed Supabase adapter**

Expose a data-source method that calls the RPC with workspace, seed, and expected revision and maps revision conflicts into the existing `SaveWorkspaceResult` conflict shape.

- [ ] **Step 5: Verify**

Run: `npm test -- tests/server/demo-seed-builder.test.ts tests/server/workspace-endpoint.test.ts`

Expected: PASS.

### Task 2: Server reset orchestration and external cleanup

**Files:**
- Modify: `server/index.ts`
- Modify: `server/demo-reset.ts`
- Modify: `server/google-calendar-service.ts`
- Modify: `server/voice-artifact-store.ts`
- Test: `tests/server/workspace-endpoint.test.ts`
- Test: `tests/server/google-calendar-service.test.ts`

**Interfaces:**
- Consumes: `expectedRevision`, compiled seed, tracked Google event IDs, and workspace voice prefix.
- Produces: one authoritative reset response with the new workspace revision.

- [ ] **Step 1: Write failing endpoint tests**

Cover:

```typescript
expect(resetRpc).toHaveBeenCalledWith("demo", "msme-aircon-v1", 12);
expect(deleteGoogleEvent).toHaveBeenCalledForEachTrackedEvent();
expect(clearWorkspaceVoiceArtifacts).toHaveBeenCalledWith("demo");
expect(response.workspace.state).toEqual(compiledSeed);
```

Also assert missing seed, stale revision, active reset, Google cleanup failure, and voice cleanup failure return explicit errors without silently falling back to a local reset.

- [ ] **Step 2: Add cleanup interfaces**

Add:

```typescript
type VoiceArtifactStore = {
  clearWorkspace(workspaceId: string): Promise<void>;
};

type GoogleCalendarService = {
  deleteTrackedEvents(workspaceId: string, signal?: AbortSignal): Promise<void>;
};
```

- [ ] **Step 3: Unify CLI and HTTP orchestration**

Extract one factory-reset service used by both `npm run demo:reset` and `/api/demo/reset`. Validate the compiled seed first, acquire a per-workspace in-process lock, run Google cleanup, invoke the RPC, clear voice artifacts, then load and return the new workspace.

- [ ] **Step 4: Remove HTTP merge behavior**

Do not call `mergeSyntheticReset` from the global endpoint. Do not preserve Telegram or imported Eval data in the returned state.

- [ ] **Step 5: Verify**

Run: `npm test -- tests/server/workspace-endpoint.test.ts tests/server/google-calendar-service.test.ts`

Expected: PASS.

### Task 3: Destructive Reset UI and authoritative client replacement

**Files:**
- Modify: `src/app/app-shell.tsx`
- Modify: `src/store/use-app-store.ts`
- Modify: `src/services/api-client.ts`
- Test: `tests/app/app-shell.test.tsx`
- Test: `tests/store/app-store.test.ts`
- Test: `tests/services/api-client.test.ts`

**Interfaces:**
- Consumes: literal confirmation `RESET` and current workspace revision.
- Produces: cleared local caches and the server-returned canonical workspace.

- [ ] **Step 1: Write failing UI and store tests**

Assert:

```typescript
expect(confirmButton).toBeDisabled();
await user.type(confirmInput, "RESET");
expect(confirmButton).toBeEnabled();
```

After success, assert synthetic-only canonical conversations, no Telegram conversations, no imported Eval cases, `knowledgeRelease === null`, reset route state, and updated workspace revision. Assert server failures do not fall back to a misleading local-only success.

- [ ] **Step 2: Replace dialog copy and confirmation**

List deleted data directly in the alert dialog and require a controlled input whose exact trimmed value is `RESET`.

- [ ] **Step 3: Replace merge projection**

On success, project the server canonical state as authoritative, clear Telegram workspace caches, reset route UI, increment `resetVersion`, and store the returned revision. Remove the global reset call to `mergeTelegramWorkspaceState` and `projectEvalWorkspaceArtifacts`.

- [ ] **Step 4: Preserve per-chat reset**

Keep “Reset this chat” local and synthetic-only. Its copy and behavior must remain unchanged.

- [ ] **Step 5: Verify**

Run: `npm test -- tests/app/app-shell.test.tsx tests/store/app-store.test.ts tests/services/api-client.test.ts`

Expected: PASS.

### Task 4: Documentation and full-system verification

**Files:**
- Modify: `README.md`
- Modify: `PROJECT.md`
- Modify: `docs/calendar-outbox.md`
- Modify: `e2e/integration.spec.ts`

**Interfaces:**
- Consumes: completed factory reset behavior.
- Produces: documented operator contract and end-to-end proof.

- [ ] **Step 1: Add the end-to-end reset proof**

Dirty Chat, Knowledge, Eval, Telegram, and Calendar-linked state; execute Reset with `RESET`; assert canonical conversations, Knowledge v1, empty Eval history, empty side-table projections, preserved Google connection, and disabled rollback.

- [ ] **Step 2: Document irreversible semantics**

State that global Reset is destructive, preserves credentials only, and differs from per-chat reset.

- [ ] **Step 3: Run full verification**

Run: `npm run verify`

Expected: lint, all Vitest suites, typecheck, build, and Playwright pass.

- [ ] **Step 4: Inspect repository state**

Run: `git status --short`

Expected: only intended factory-reset files plus pre-existing untracked `.tmp` pitch-deck artifacts. Do not commit.

