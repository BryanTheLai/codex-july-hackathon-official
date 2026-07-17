import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createCanonicalSeed,
  createCanonicalServerState,
  freezeEvalSuiteSnapshot,
  mergeTelegramInboundText,
  serializeAppState,
  sendStaffReply,
  type AppState,
  type ConversationId,
} from "../../src/domain";
import { projectAuthoritativeWorkspace } from "../../src/domain/telegram-workspace";
import type { WorkspaceClient } from "../../src/services/api-client";
import { ApiClientError } from "../../src/services/api-client";
import {
  TELEGRAM_WORKSPACE_STORAGE_KEY,
} from "../../src/store/telegram-workspace-repository";
import {
  LEGACY_STORAGE_KEY,
  STORAGE_KEY,
  createLocalAppStateRepository,
  loadAppState,
  saveAppState,
} from "../../src/store/repository";
import { createAppStore, type AppStore } from "../../src/store/use-app-store";
import { createFixtureJudgeClient } from "../fixtures/judge-client";

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

function seedConversationId(state: AppState): ConversationId {
  return state.conversations[0]!.id;
}

describe("repository", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("load returns canonical seed when storage is empty", () => {
    const state = loadAppState(storage);
    expect(state).toEqual(createCanonicalSeed());
  });

  it("save and load round-trip through serialize and hydrate", () => {
    const seed = createCanonicalSeed();
    const mutated = sendStaffReply(seed, {
      conversationId: seedConversationId(seed),
      text: "Persist me",
      kind: "reply",
    });
    expect(mutated.ok).toBe(true);
    if (!mutated.ok) return;

    saveAppState(storage, mutated.state);
    const raw = storage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();

    const envelope = JSON.parse(raw!);
    expect(envelope).toEqual(serializeAppState(mutated.state));

    const loaded = loadAppState(storage);
    expect(loaded).toEqual(mutated.state);
    expect(loaded).not.toBe(mutated.state);
  });

  it("falls back to canonical seed on malformed storage payload", () => {
    storage.setItem(STORAGE_KEY, "{not-json");
    expect(loadAppState(storage)).toEqual(createCanonicalSeed());

    storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 99 }));
    expect(loadAppState(storage)).toEqual(createCanonicalSeed());
  });

  it("surfaces and persists recovery after unreadable saved data", () => {
    storage.setItem(STORAGE_KEY, "{not-json");

    const recoveredStore = createAppStore(storage);

    expect(recoveredStore.getState().state).toEqual(createCanonicalSeed());
    expect(recoveredStore.getState().lastFeedback).toContain("could not be read");
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).schemaVersion).toBe(4);
  });

  it("surfaces a one-time notice and persists state after a legacy scoring migration", () => {
    const current = serializeAppState(createCanonicalSeed());
    storage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify({
        ...current,
        schemaVersion: 3,
        state: { ...current.state, schemaVersion: 3 },
      }),
    );

    const migratedStore = createAppStore(storage);
    expect(migratedStore.getState().lastFeedback).toContain(
      "Legacy evaluation grades and run history were cleared",
    );
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).schemaVersion).toBe(4);
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBeNull();

    const reloadedStore = createAppStore(storage);
    expect(reloadedStore.getState().lastFeedback).toBe("");
  });

  it("moves a current payload from the legacy storage key without showing a schema notice", () => {
    storage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify(serializeAppState(createCanonicalSeed())),
    );

    const migratedStore = createAppStore(storage);

    expect(migratedStore.getState().lastFeedback).toBe("");
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });

  it("persists store mutations through an injected state repository", () => {
    const repository = createLocalAppStateRepository(storage);
    const save = vi.spyOn(repository, "save");
    const injectedStore = createAppStore(storage, { stateRepository: repository });

    injectedStore.getState().sendStaffReply({
      conversationId: seedConversationId(injectedStore.getState().state),
      text: "Repository boundary",
      kind: "reply",
    });

    expect(save).toHaveBeenCalledOnce();
  });
});

describe("app store", () => {
  let storage: MemoryStorage;
  let store: AppStore;

  beforeEach(() => {
    storage = new MemoryStorage();
    store = createAppStore(storage);
  });

  it("fails closed before a server revision is loaded", () => {
    const seed = createCanonicalSeed();
    const convoId = seedConversationId(seed);
    store.getState().sendStaffReply({
      conversationId: convoId,
      text: "Mutation before reset",
      kind: "reply",
    });
    store.getState().selectConversation("convo-aircon-booking");
    store.getState().updateRouteUi({
      chatMobilePane: "details",
      knowledgeCorrectionId: "corr-booking-confirmation",
      knowledgePane: "changes",
      evalCaseId: "case-aircon-selection-train",
      evalDrawer: "evidence",
    });
    const before = structuredClone(store.getState().state);

    const result = store.getState().resetDemo();

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringMatching(/server workspace finishes loading/i),
    });
    expect(store.getState().state).toEqual(before);
    expect(store.getState().resetVersion).toBe(0);
    expect(store.getState().routeUi).toEqual({
      chatMobilePane: "details",
      knowledgeCorrectionId: "corr-booking-confirmation",
      knowledgePane: "changes",
      evalCaseId: "case-aircon-selection-train",
      evalDrawer: "evidence",
    });
  });

  it("factory reset adopts authoritative server state and clears local caches", async () => {
    const inbound = mergeTelegramInboundText(
      await createCanonicalServerState(),
      {
        channel: "telegram",
        externalEventId: "1001",
        externalConversationId: "-10042",
        externalMessageId: "88",
        sender: {
          externalId: "42",
          displayName: "Aina Zulkifli",
        },
        message: {
          kind: "text",
          text: "Boleh saya buat temujanji?",
          language: "ms",
        },
        receivedAt: "2026-07-13T12:00:00.000Z",
      },
    );
    expect(inbound.ok).toBe(true);
    if (!inbound.ok) {
      return;
    }
    const canonicalServer = await createCanonicalServerState();
    const canonicalProjection = projectAuthoritativeWorkspace(canonicalServer);
    expect(canonicalProjection.ok).toBe(true);
    if (!canonicalProjection.ok) {
      return;
    }
    const workspaceClient: WorkspaceClient = {
      load: vi.fn().mockResolvedValue({
        workspaceId: "demo",
        revision: 7,
        state: inbound.state,
      }),
      reset: vi.fn().mockResolvedValue({
        ok: true,
        workspace: {
          workspaceId: "demo",
          revision: 8,
          state: canonicalServer,
        },
      }),
    };
    const serverStore = createAppStore(storage, { workspaceClient });
    await serverStore.getState().refreshTelegramWorkspace();
    serverStore.getState().updateRouteUi({
      chatMobilePane: "details",
      knowledgeCorrectionId: "corr-booking-confirmation",
      knowledgePane: "changes",
      evalCaseId: "case-aircon-selection-train",
      evalDrawer: "evidence",
    });

    const result = await serverStore.getState().resetDemo();

    expect(result.ok).toBe(true);
    expect(workspaceClient.reset).toHaveBeenCalledWith(7);
    expect(
      serverStore
        .getState()
        .state.conversations.some(
          (conversation) => conversation.id === "telegram-conversation:-10042",
        ),
    ).toBe(false);
    expect(serverStore.getState().state).toEqual(canonicalProjection.state);
    expect(serverStore.getState().knowledgeRelease).toBeNull();
    expect(serverStore.getState().resetVersion).toBe(1);
    expect(serverStore.getState().routeUi).toEqual({
      chatMobilePane: "list",
      knowledgeCorrectionId: null,
      knowledgePane: "files",
      evalCaseId: null,
      evalDrawer: null,
    });
    expect(serverStore.getState().telegramWorkspace).toMatchObject({
      status: "ready",
      workspaceRevision: 8,
      conversationRevisions: {},
      speechArtifacts: {},
      pendingDelivery: null,
      deliveryNotice: null,
    });
    const persistedTelegram = JSON.parse(
      storage.getItem(TELEGRAM_WORKSPACE_STORAGE_KEY)!,
    );
    expect(persistedTelegram.state.conversationRevisions).toEqual({});
    expect(persistedTelegram.state.speechArtifacts).toEqual({});
  });

  it("preserves state when factory reset returns revision_conflict", async () => {
    const dirtyServer = await createCanonicalServerState();
    const workspaceClient: WorkspaceClient = {
      load: vi.fn().mockResolvedValue({
        workspaceId: "demo",
        revision: 7,
        state: dirtyServer,
      }),
      reset: vi.fn().mockResolvedValue({
        ok: false,
        code: "revision_conflict",
        workspace: {
          workspaceId: "demo",
          revision: 8,
          state: await createCanonicalServerState(),
        },
      }),
    };
    const serverStore = createAppStore(storage, { workspaceClient });
    await serverStore.getState().refreshTelegramWorkspace();
    serverStore.getState().sendStaffReply({
      conversationId: seedConversationId(serverStore.getState().state),
      text: "Mutation before revision conflict",
      kind: "reply",
    });
    const before = structuredClone(serverStore.getState().state);

    const result = await serverStore.getState().resetDemo();

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatch(/workspace changed before reset/i);
    expect(serverStore.getState().state).toEqual(before);
    expect(serverStore.getState().lastFeedback).toMatch(/workspace changed before reset/i);
    expect(serverStore.getState().resetVersion).toBe(0);
  });

  it("does not fall back to local reset when factory reset is feature_disabled", async () => {
    const workspaceClient: WorkspaceClient = {
      load: vi.fn().mockResolvedValue({
        workspaceId: "demo",
        revision: 7,
        state: await createCanonicalServerState(),
      }),
      reset: vi.fn().mockRejectedValue(
        new ApiClientError(
          "feature_disabled",
          "Factory reset is not configured.",
          false,
        ),
      ),
    };
    const serverStore = createAppStore(storage, { workspaceClient });
    await serverStore.getState().refreshTelegramWorkspace();
    serverStore.getState().sendStaffReply({
      conversationId: seedConversationId(serverStore.getState().state),
      text: "Mutation before feature_disabled reset",
      kind: "reply",
    });
    const before = structuredClone(serverStore.getState().state);

    const result = await serverStore.getState().resetDemo();

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatch(/factory reset is not configured/i);
    expect(serverStore.getState().state).toEqual(before);
    expect(serverStore.getState().lastFeedback).toMatch(/factory reset is not configured/i);
  });

  it("does not fall back to local reset when the server factory reset fails", async () => {
    const workspaceClient: WorkspaceClient = {
      load: vi.fn().mockResolvedValue({
        workspaceId: "demo",
        revision: 7,
        state: await createCanonicalServerState(),
      }),
      reset: vi.fn().mockRejectedValue(
        new ApiClientError(
          "provider_failed",
          "Google cleanup failed.",
          true,
        ),
      ),
    };
    const serverStore = createAppStore(storage, { workspaceClient });
    await serverStore.getState().refreshTelegramWorkspace();
    serverStore.getState().sendStaffReply({
      conversationId: seedConversationId(serverStore.getState().state),
      text: "Mutation before failed reset",
      kind: "reply",
    });
    const before = structuredClone(serverStore.getState().state);

    const result = await serverStore.getState().resetDemo();

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatch(/google cleanup failed/i);
    expect(serverStore.getState().state).toEqual(before);
    expect(serverStore.getState().lastFeedback).toMatch(/google cleanup failed/i);
  });

  it("reloads authoritative workspace after voice cleanup fails post-RPC", async () => {
    const canonicalServer = await createCanonicalServerState();
    const canonicalProjection = projectAuthoritativeWorkspace(canonicalServer);
    expect(canonicalProjection.ok).toBe(true);
    if (!canonicalProjection.ok) {
      return;
    }
    const workspaceClient: WorkspaceClient = {
      load: vi
        .fn()
        .mockResolvedValueOnce({
          workspaceId: "demo",
          revision: 7,
          state: canonicalServer,
        })
        .mockResolvedValue({
          workspaceId: "demo",
          revision: 8,
          state: canonicalServer,
        }),
      reset: vi.fn().mockRejectedValue(
        new ApiClientError(
          "provider_failed",
          "Workspace reset completed but voice artifact cleanup failed.",
          true,
        ),
      ),
    };
    const serverStore = createAppStore(storage, { workspaceClient });
    await serverStore.getState().refreshTelegramWorkspace();
    serverStore.getState().sendStaffReply({
      conversationId: seedConversationId(serverStore.getState().state),
      text: "Mutation before partial reset",
      kind: "reply",
    });

    const result = await serverStore.getState().resetDemo();

    expect(result.ok).toBe(true);
    expect(workspaceClient.load).toHaveBeenCalled();
    expect(serverStore.getState().state).toEqual(canonicalProjection.state);
    expect(serverStore.getState().lastFeedback).toMatch(/voice artifact cleanup failed/i);
    expect(serverStore.getState().telegramWorkspace.workspaceRevision).toBe(8);
  });

  it("fails closed when voice cleanup errors but workspace revision did not advance", async () => {
    const canonicalServer = await createCanonicalServerState();
    const workspaceClient: WorkspaceClient = {
      load: vi.fn().mockResolvedValue({
        workspaceId: "demo",
        revision: 7,
        state: canonicalServer,
      }),
      reset: vi.fn().mockRejectedValue(
        new ApiClientError(
          "provider_failed",
          "Workspace reset completed but voice artifact cleanup failed.",
          true,
        ),
      ),
    };
    const serverStore = createAppStore(storage, { workspaceClient });
    await serverStore.getState().refreshTelegramWorkspace();
    serverStore.getState().sendStaffReply({
      conversationId: seedConversationId(serverStore.getState().state),
      text: "Mutation before unchanged revision recovery",
      kind: "reply",
    });
    const before = structuredClone(serverStore.getState().state);

    const result = await serverStore.getState().resetDemo();

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatch(/voice artifact cleanup failed/i);
    expect(serverStore.getState().state).toEqual(before);
    expect(serverStore.getState().lastFeedback).toMatch(/voice artifact cleanup failed/i);
    expect(serverStore.getState().resetVersion).toBe(0);
    expect(workspaceClient.load).toHaveBeenCalled();
  });

  it("clears imported manual Eval evidence after a successful factory reset", async () => {
    const dirtyServer = await createCanonicalServerState();
    const canonicalServer = await createCanonicalServerState();
    const canonicalProjection = projectAuthoritativeWorkspace(canonicalServer);
    expect(canonicalProjection.ok).toBe(true);
    if (!canonicalProjection.ok) {
      return;
    }
    const workspaceClient: WorkspaceClient = {
      load: vi.fn().mockResolvedValue({
        workspaceId: "demo",
        revision: 7,
        state: dirtyServer,
      }),
      reset: vi.fn().mockResolvedValue({
        ok: true,
        workspace: {
          workspaceId: "demo",
          revision: 8,
          state: canonicalServer,
        },
      }),
    };
    const serverStore = createAppStore(storage, {
      judgeClient: createFixtureJudgeClient(),
      workspaceClient,
    });
    await serverStore.getState().refreshTelegramWorkspace();
    const manualCase = serverStore.getState().addCase({
      datasetId: "dataset-aircon-ops",
      title: "Imported manual holdout",
      split: "holdout",
      type: "general",
      language: "English",
      inputConversation: {
        messages: [
          {
            id: "manual-case-input-1",
            role: "patient",
            text: "Can I get a discount?",
            sentAt: "2026-07-13T12:00:00.000Z",
          },
        ],
      },
      expectedHumanOutput: "No discounts are available.",
      criterionIds: ["crit-aircon-price"],
    });
    expect(manualCase.ok).toBe(true);
    const manualCaseId = serverStore
      .getState()
      .state.evalDatasets[0]!
      .cases.find((evalCase) => evalCase.source.kind === "manual")?.id;
    expect(manualCaseId).toBeTruthy();
    const evalRun = await serverStore.getState().runEvalCase("case-aircon-selection-train");
    expect(evalRun.ok).toBe(true);
    expect(
      serverStore
        .getState()
        .state.evalDatasets[0]!
        .cases.find((evalCase) => evalCase.id === "case-aircon-selection-train")?.grade,
    ).toBeDefined();

    const result = await serverStore.getState().resetDemo();

    expect(result.ok).toBe(true);
    expect(
      serverStore
        .getState()
        .state.evalDatasets[0]!
        .cases.some((evalCase) => evalCase.source.kind === "manual"),
    ).toBe(false);
    expect(
      serverStore
        .getState()
        .state.evalDatasets[0]!
        .cases.find((evalCase) => evalCase.id === "case-aircon-selection-train"),
    ).not.toHaveProperty("grade");
    expect(serverStore.getState().state).toEqual(canonicalProjection.state);
  });

  it("keeps authoritative release readiness when historical Eval projection fails", async () => {
    const server = await createCanonicalServerState();
    const suite = await freezeEvalSuiteSnapshot({
      state: server,
      suiteId: "suite-stale-projection",
      datasetId: "dataset-aircon-ops",
      caseIds: ["case-aircon-selection-train"],
      playbookVersionId: server.playbookHistory.activeVersionId,
      agentConfig: {
        modelId: "agent-model",
        apiMode: "responses",
        agentConfigVersion: "agent-config-v1",
        promptVersion: "agent-prompt-v1",
        toolPolicyVersion: "demo-no-tools-v1",
      },
      judgeConfig: {
        modelId: "judge-model",
        promptVersion: "judge-prompt-v1",
      },
      baselineSuiteId: null,
      createdAt: "2026-07-18T08:00:00+08:00",
    });
    server.evalArtifacts.suites.push(suite);
    server.evalArtifacts.runs.push({
      id: "eval-run-stale-projection",
      suiteId: suite.id,
      caseId: "case-aircon-selection-train",
      attempt: 1,
      candidateResponse: "Chemical wash is RM160.",
      agentResult: {
        runId: "agent-run-stale-projection",
        draft: {
          englishText: "Chemical wash is RM160.",
          patientLanguage: "English",
          patientText: "Chemical wash is RM160.",
        },
        proposedAction: "reply",
        handoffReason: null,
        evidence: [],
        toolCalls: [],
        stopReason: "completed",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        latencyMs: 10,
      },
      judgeResult: {
        overallVerdict: "pass",
        judgeScore: 1,
        rationale: "Pass",
        criterionResults: [
          {
            criterionId: "crit-aircon-selection",
            verdict: "pass",
            reason: "Pass",
            evidence: "Chemical wash is RM160.",
          },
        ],
        metadata: {
          provider: "test",
          model: "judge-model",
          promptVersion: "judge-prompt-v1",
          rubricVersions: {},
          runId: "judge-run-stale-projection",
          latencyMs: 10,
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          simulated: true,
        },
      },
      ranAt: "2026-07-18T08:00:00+08:00",
    });
    server.evalDatasets[0]!.cases = server.evalDatasets[0]!.cases.filter(
      (evalCase) => evalCase.id !== "case-aircon-selection-train",
    );
    const active = server.playbookHistory.versions[0]!;
    server.playbookHistory.versions.push({
      ...active,
      id: "knowledge-candidate-ready",
      sequence: 2,
      parentVersionId: active.id,
      kind: "correction",
      passingSuiteId: suite.id,
      activatedAt: null,
    });
    server.playbookHistory.candidateVersionId = "knowledge-candidate-ready";
    const workspaceClient: WorkspaceClient = {
      load: vi.fn().mockResolvedValue({
        workspaceId: "demo",
        revision: 12,
        state: server,
      }),
    };
    const serverStore = createAppStore(storage, { workspaceClient });

    const result = await serverStore.getState().refreshKnowledgeWorkspace();

    expect(result.ok).toBe(false);
    expect(serverStore.getState().knowledgeRelease).toMatchObject({
      candidateVersionId: "knowledge-candidate-ready",
      candidateReady: true,
    });
  });

  it("persists valid selection IDs to storage", () => {
    store.getState().selectConversation("convo-aircon-booking");
    store.getState().selectPlaybookFile("file-aircon-booking");
    store.getState().selectEvalDataset("dataset-aircon-ops");

    const loaded = loadAppState(storage);
    expect(loaded.selections.conversationId).toBe("convo-aircon-booking");
    expect(loaded.selections.playbookFileId).toBe("file-aircon-booking");
    expect(loaded.selections.evalDatasetId).toBe("dataset-aircon-ops");
  });

  it("persists an explicitly cleared conversation selection", () => {
    store.getState().selectConversation(null);

    expect(store.getState().state.selections.conversationId).toBeNull();
    expect(loadAppState(storage).selections.conversationId).toBeNull();
  });

  it("ignores invalid selection IDs", () => {
    const before = store.getState().state.selections;
    store.getState().selectConversation("missing-conversation");
    store.getState().selectPlaybookFile("missing-file");
    store.getState().selectEvalDataset("missing-dataset");

    expect(store.getState().state.selections).toEqual(before);
  });

  it("mutation wrapper returns typed failure feedback without changing state", () => {
    const before = structuredClone(store.getState().state);
    const result = store.getState().sendStaffReply({
      conversationId: "missing-conversation",
      text: "Hello",
      kind: "reply",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not found/i);
    expect(store.getState().state).toEqual(before);
    expect(store.getState().lastFeedback).toMatch(/not found/i);
  });

  it("mutation wrapper updates state and success feedback", () => {
    const convoId = seedConversationId(store.getState().state);
    const result = store.getState().sendStaffReply({
      conversationId: convoId,
      text: "On my way",
      kind: "reply",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(store.getState().state.conversations.find((c) => c.id === convoId)?.messages.at(-1)?.text).toBe(
      "On my way",
    );
    expect(store.getState().lastFeedback.length).toBeGreaterThan(0);

    const loaded = loadAppState(storage);
    expect(loaded.conversations.find((c) => c.id === convoId)?.messages.at(-1)?.text).toBe("On my way");
  });

  it("keeps continuous Knowledge draft edits out of the global live region", () => {
    const result = store.getState().setPlaybookDraft(
      "file-aircon-service-selection",
      "# Service selection\n\nDraft text",
    );

    expect(result.ok).toBe(true);
    expect(store.getState().lastFeedback).toBe("");
    expect(
      store.getState().state.playbookFiles.find((file) => file.id === "file-aircon-service-selection")?.draft,
    ).toContain("Draft text");
  });

  it("preserves Chat and Knowledge changes made while an Eval case is running", async () => {
    store = createAppStore(storage, {
      judgeClient: createFixtureJudgeClient({ delayMs: 20 }),
    });
    const conversationId = seedConversationId(store.getState().state);
    const pendingEval = store.getState().runEvalCase("case-aircon-selection-train");

    store.getState().sendStaffReply({
      conversationId,
      text: "Interleaved staff reply",
      kind: "reply",
    });
    store.getState().setPlaybookDraft(
      "file-aircon-service-selection",
      "# Service selection\n\nInterleaved Knowledge draft",
    );

    const result = await pendingEval;
    expect(result.ok).toBe(true);

    const current = store.getState().state;
    expect(
      current.conversations.find((conversation) => conversation.id === conversationId)?.messages.at(-1)
        ?.text,
    ).toBe("Interleaved staff reply");
    expect(
      current.playbookFiles.find((file) => file.id === "file-aircon-service-selection")?.draft,
    ).toContain("Interleaved Knowledge draft");
    expect(
      current.evalDatasets
        .flatMap((dataset) => dataset.cases)
        .find((evalCase) => evalCase.id === "case-aircon-selection-train")?.grade,
    ).toBeDefined();

    const persisted = loadAppState(storage);
    expect(
      persisted.conversations.find((conversation) => conversation.id === conversationId)?.messages.at(-1)
        ?.text,
    ).toBe("Interleaved staff reply");
    expect(
      persisted.playbookFiles.find((file) => file.id === "file-aircon-service-selection")?.draft,
    ).toContain("Interleaved Knowledge draft");
    expect(
      persisted.evalDatasets
        .flatMap((dataset) => dataset.cases)
        .find((evalCase) => evalCase.id === "case-aircon-selection-train")?.grade,
    ).toBeDefined();
  });

  it("rejects an Eval result when its dataset changed while it was running", async () => {
    store = createAppStore(storage, {
      judgeClient: createFixtureJudgeClient({ delayMs: 20 }),
    });
    const beforeHistoryLength = store.getState().state.evalDatasets[0]!.runHistory.length;
    const pendingEval = store.getState().runEvalCase("case-aircon-selection-train");

    store.getState().editCase("case-aircon-selection-train", {
      title: "Concurrent Eval edit",
    });

    const result = await pendingEval;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/evalDatasets changed.*Retry/i);
    expect(result.state).toBe(store.getState().state);

    const currentDataset = store.getState().state.evalDatasets[0]!;
    expect(
      currentDataset.cases.find((evalCase) => evalCase.id === "case-aircon-selection-train")?.title,
    ).toBe("Concurrent Eval edit");
    expect(currentDataset.runHistory).toHaveLength(beforeHistoryLength);

    const persistedDataset = loadAppState(storage).evalDatasets[0]!;
    expect(
      persistedDataset.cases.find((evalCase) => evalCase.id === "case-aircon-selection-train")?.title,
    ).toBe("Concurrent Eval edit");
    expect(persistedDataset.runHistory).toHaveLength(beforeHistoryLength);
  });

  it("keeps and returns latest state when an asynchronous Eval run fails", async () => {
    const repository = createLocalAppStateRepository(storage);
    const save = vi.spyOn(repository, "save");
    store = createAppStore(storage, {
      stateRepository: repository,
      judgeClient: createFixtureJudgeClient({ delayMs: 20 }),
    });
    const conversationId = seedConversationId(store.getState().state);
    const pendingEval = store.getState().runEvalCase("case-aircon-selection-train", {
      signal: AbortSignal.timeout(1),
    });

    store.getState().sendStaffReply({
      conversationId,
      text: "Reply preserved after Eval failure",
      kind: "reply",
    });

    const result = await pendingEval;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/cancel/i);
    expect(result.state).toBe(store.getState().state);
    expect(store.getState().lastFeedback).toMatch(/cancel/i);
    expect(save).toHaveBeenCalledOnce();

    const persisted = loadAppState(storage);
    expect(
      persisted.conversations.find((conversation) => conversation.id === conversationId)?.messages.at(-1)
        ?.text,
    ).toBe("Reply preserved after Eval failure");
  });
});
