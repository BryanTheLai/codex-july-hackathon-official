import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ServerDomainStatePayload } from "../../src/contracts/app-state";
import { SCHEMA_VERSION } from "../../src/contracts/constants";
import { createCanonicalServerState } from "../../src/domain";
import { DEFAULT_DEMO_SEED_KEY } from "../../server/bootstrap-demo";
import {
  assertWorkspaceMutationAllowed,
  createFactoryResetService,
  type FactoryResetService,
} from "../../server/factory-reset-service";
import type { GoogleCalendarService } from "../../server/google-calendar-service";
import { createJudgeApp } from "../../server/index";
import type { ResetDemoWorkspaceResult } from "../../server/supabase";
import type { VoiceArtifactStore } from "../../server/voice-artifact-store";
import { beginWorkspaceReset } from "../../server/workspace-reset-lock";
import { createWorkspaceRepository } from "../../server/workspace-repository";
import { InMemoryWorkspaceDataSource } from "./fixtures/workspace-data-source";

const servers: Array<ReturnType<ReturnType<typeof createJudgeApp>["listen"]>> =
  [];

async function start(
  options?: Parameters<typeof createJudgeApp>[0],
): Promise<string> {
  const server = createJudgeApp(options).listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function configuredServer(state?: ServerDomainStatePayload) {
  const dataSource = new InMemoryWorkspaceDataSource();
  const repository = createWorkspaceRepository(dataSource);
  await repository.bootstrap(
    "demo",
    state ?? (await createCanonicalServerState()),
  );
  const baseUrl = await start({
    workspace: {
      workspaceId: "demo",
      repository,
      createCanonicalState: createCanonicalServerState,
    },
  });
  return { baseUrl, dataSource, repository };
}

type ResetHarnessOptions = {
  dirtyState?: ServerDomainStatePayload;
  expectedRevision?: number;
  resetResult?: ResetDemoWorkspaceResult;
  loadCompiledSeed?: (seedKey: string) => Promise<ServerDomainStatePayload | null>;
  googleCalendar?: GoogleCalendarService | null;
  voiceArtifactStore?: VoiceArtifactStore;
  bootstrapWorkspace?: boolean;
};

async function configuredResetServer(options: ResetHarnessOptions = {}) {
  const compiledSeed = await createCanonicalServerState();
  const dirty = options.dirtyState ?? structuredClone(compiledSeed);
  dirty.playbookFiles[0]!.savedContent = "Dirty synthetic content";
  const dataSource = new InMemoryWorkspaceDataSource();
  const repository = createWorkspaceRepository(dataSource, {
    mutationGuard: assertWorkspaceMutationAllowed,
  });
  const revision = options.expectedRevision ?? 12;
  if (options.bootstrapWorkspace !== false) {
    dataSource.records.set("demo", {
      workspaceId: "demo",
      schemaVersion: SCHEMA_VERSION,
      revision,
      state: dirty,
    });
  }
  const resetRpc = vi.fn(
    async (): Promise<ResetDemoWorkspaceResult> =>
      options.resetResult ?? {
        ok: true,
        workspace: {
          workspaceId: "demo",
          revision: revision + 1,
          state: compiledSeed,
        },
        summary: {
          seedKey: DEFAULT_DEMO_SEED_KEY,
          previousRevision: revision,
          newRevision: revision + 1,
          outboxRowsRemoved: 0,
          googleEventsRemoved: 0,
          calendarDeliveriesRemoved: 0,
          telegramDeliveriesRemoved: 0,
          telegramEventsRemoved: 0,
          oauthPreserved: true,
        },
      },
  );
  const deleteTrackedEvents = vi.fn(async () => {});
  const clearWorkspace = vi.fn(async () => {});
  const loadCompiledSeed =
    options.loadCompiledSeed ?? (async () => structuredClone(compiledSeed));
  const googleCalendar =
    options.googleCalendar === null
      ? null
      : (options.googleCalendar ?? {
          deleteTrackedEvents,
        } as unknown as GoogleCalendarService);
  const voiceArtifactStore =
    options.voiceArtifactStore ??
    ({
      clearWorkspace,
    } as unknown as VoiceArtifactStore);
  const factoryReset: FactoryResetService = createFactoryResetService({
    workspaceId: "demo",
    seedKey: DEFAULT_DEMO_SEED_KEY,
    workspaceRepository: repository,
    loadCompiledSeed,
    resetDataSource: { reset: resetRpc },
    googleCalendar,
    voiceArtifactStore,
  });
  const baseUrl = await start({
    workspace: {
      workspaceId: "demo",
      repository,
      createCanonicalState: createCanonicalServerState,
    },
    factoryReset,
  });
  return {
    baseUrl,
    clearWorkspace,
    compiledSeed,
    deleteTrackedEvents,
    dirty,
    repository,
    resetRpc,
    revision,
  };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  const { endWorkspaceReset } = await import("../../server/workspace-reset-lock");
  endWorkspaceReset("demo");
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  );
});

describe("workspace endpoints", () => {
  it("returns a typed feature-disabled error without server storage config", async () => {
    const baseUrl = await start({ workspace: null });

    const response = await fetch(`${baseUrl}/api/workspace/state`);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: "feature_disabled",
      error: "Workspace persistence is not configured.",
      retryable: false,
    });
  });

  it("keeps the server available when Supabase config is partial", async () => {
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");

    const baseUrl = await start();
    const response = await fetch(`${baseUrl}/api/workspace/state`);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "feature_disabled",
    });
  });

  it("loads state, saves one matching revision, and returns truth on conflict", async () => {
    const { baseUrl } = await configuredServer();
    const loaded = await fetch(`${baseUrl}/api/workspace/state`);
    const initial = await loaded.json();
    const savedState = {
      ...initial.state,
      fixtureTime: "2026-07-13T18:00:00.000Z",
    };

    const saved = await fetch(`${baseUrl}/api/workspace/state`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 1,
        state: savedState,
      }),
    });
    const conflict = await fetch(`${baseUrl}/api/workspace/state`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 1,
        state: {
          ...savedState,
          fixtureTime: "2026-07-13T19:00:00.000Z",
        },
      }),
    });

    expect(loaded.status).toBe(200);
    expect(initial.revision).toBe(1);
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      ok: true,
      workspace: {
        revision: 2,
        state: { fixtureTime: "2026-07-13T18:00:00.000Z" },
      },
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      ok: false,
      code: "revision_conflict",
      workspace: {
        revision: 2,
        state: { fixtureTime: "2026-07-13T18:00:00.000Z" },
      },
    });
  });

  it("rejects an invalid save before touching storage", async () => {
    const { baseUrl, dataSource } = await configuredServer();

    const response = await fetch(`${baseUrl}/api/workspace/state`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 0,
        state: {},
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "invalid_request",
      error: "Workspace save request is invalid.",
      retryable: false,
    });
    expect(dataSource.records.get("demo")?.revision).toBe(1);
  });

  describe("factory reset", () => {
    it("orchestrates Google cleanup, RPC reset, and voice cleanup", async () => {
      const {
        baseUrl,
        clearWorkspace,
        compiledSeed,
        deleteTrackedEvents,
        dirty,
        resetRpc,
        revision,
      } = await configuredResetServer();

      const response = await fetch(`${baseUrl}/api/demo/reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: revision }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(resetRpc).toHaveBeenCalledWith(
        "demo",
        DEFAULT_DEMO_SEED_KEY,
        revision,
      );
      expect(deleteTrackedEvents).toHaveBeenCalledWith("demo", expect.any(AbortSignal));
      expect(clearWorkspace).toHaveBeenCalledWith("demo");
      expect(body).toMatchObject({
        ok: true,
        workspace: {
          revision: revision + 1,
        },
      });
      expect(body.workspace.state).toEqual(compiledSeed);
      expect(body.workspace.state.playbookFiles[0].savedContent).not.toBe(
        dirty.playbookFiles[0]!.savedContent,
      );
      expect(
        body.workspace.state.conversations.every(
          (conversation: { source: string }) => conversation.source === "synthetic",
        ),
      ).toBe(true);
    });

    it("returns an explicit error when the compiled seed is missing", async () => {
      const { baseUrl, resetRpc, revision } = await configuredResetServer({
        loadCompiledSeed: async () => null,
      });

      const response = await fetch(`${baseUrl}/api/demo/reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: revision }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: "invalid_request",
        retryable: false,
      });
      expect(resetRpc).not.toHaveBeenCalled();
    });

    it("returns revision_conflict without running cleanup when the revision is stale", async () => {
      const { baseUrl, deleteTrackedEvents, resetRpc, revision } =
        await configuredResetServer();

      const response = await fetch(`${baseUrl}/api/demo/reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: revision - 1 }),
      });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        code: "revision_conflict",
        workspace: { revision },
      });
      expect(deleteTrackedEvents).not.toHaveBeenCalled();
      expect(resetRpc).not.toHaveBeenCalled();
    });

    it("returns not_found when the workspace does not exist", async () => {
      const compiledSeed = await createCanonicalServerState();
      const dataSource = new InMemoryWorkspaceDataSource();
      const repository = createWorkspaceRepository(dataSource, {
        mutationGuard: assertWorkspaceMutationAllowed,
      });
      const resetRpc = vi.fn();
      const baseUrl = await start({
        workspace: {
          workspaceId: "demo",
          repository,
          createCanonicalState: createCanonicalServerState,
        },
        factoryReset: createFactoryResetService({
          workspaceId: "demo",
          seedKey: DEFAULT_DEMO_SEED_KEY,
          workspaceRepository: repository,
          loadCompiledSeed: async () => structuredClone(compiledSeed),
          resetDataSource: { reset: resetRpc },
          googleCalendar: {
            deleteTrackedEvents: vi.fn(),
          } as unknown as GoogleCalendarService,
          voiceArtifactStore: {
            clearWorkspace: vi.fn(),
          } as unknown as VoiceArtifactStore,
        }),
      });

      const response = await fetch(`${baseUrl}/api/demo/reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: 1 }),
      });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        code: "not_found",
        retryable: false,
      });
      expect(resetRpc).not.toHaveBeenCalled();
    });

    it("rejects concurrent resets for the same workspace", async () => {
      beginWorkspaceReset("demo");
      const { baseUrl, revision } = await configuredResetServer();

      const response = await fetch(`${baseUrl}/api/demo/reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: revision }),
      });

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        code: "provider_failed",
        error: expect.stringContaining("already running"),
        retryable: true,
      });
    });

    it("blocks workspace saves while factory reset is in progress", async () => {
      const { baseUrl, repository, revision } = await configuredResetServer();
      const loaded = await repository.load("demo");
      const savedState = {
        ...loaded!.state,
        fixtureTime: "2026-07-13T18:00:00.000Z",
      };
      beginWorkspaceReset("demo");

      const response = await fetch(`${baseUrl}/api/workspace/state`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedRevision: revision,
          state: savedState,
        }),
      });

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        code: "provider_failed",
        error: expect.stringContaining("factory reset"),
        retryable: true,
      });
    });

    it("returns an explicit error when Google cleanup fails", async () => {
      const { GoogleCalendarError } = await import(
        "../../server/google-calendar-service"
      );
      const { baseUrl, resetRpc, revision } = await configuredResetServer({
        googleCalendar: {
          deleteTrackedEvents: vi.fn(async () => {
            throw new GoogleCalendarError("Google cleanup failed.", true);
          }),
        } as unknown as GoogleCalendarService,
      });

      const response = await fetch(`${baseUrl}/api/demo/reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: revision }),
      });

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toMatchObject({
        code: "provider_failed",
        error: "Google cleanup failed.",
        retryable: true,
      });
      expect(resetRpc).not.toHaveBeenCalled();
    });

    it("returns an explicit error when voice cleanup fails after the RPC reset", async () => {
      const { VoiceArtifactStoreError } = await import(
        "../../server/voice-artifact-store"
      );
      const { baseUrl, resetRpc, revision } = await configuredResetServer({
        voiceArtifactStore: {
          clearWorkspace: vi.fn(async () => {
            throw new VoiceArtifactStoreError("Voice artifact cleanup failed");
          }),
        } as unknown as VoiceArtifactStore,
      });

      const response = await fetch(`${baseUrl}/api/demo/reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: revision }),
      });

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toMatchObject({
        code: "provider_failed",
        error: expect.stringContaining("voice artifact cleanup failed"),
        retryable: true,
      });
      expect(resetRpc).toHaveBeenCalled();
    });
  });
});
