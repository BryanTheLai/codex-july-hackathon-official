import { describe, expect, it, vi } from "vitest";

import type { EvalRunArtifact } from "../../src/contracts/eval";
import {
  createCanonicalServerState,
  freezeEvalSuiteSnapshot,
} from "../../src/domain";
import type {
  EvalClient,
  WorkspaceClient,
} from "../../src/services/api-client";
import { createAppStore } from "../../src/store/use-app-store";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const agentConfig = {
  modelId: "agent-model",
  apiMode: "responses" as const,
  agentConfigVersion: "agent-config-v1",
  promptVersion: "agent-prompt-v1",
  toolPolicyVersion: "demo-no-tools-v1" as const,
};

const judgeConfig = {
  modelId: "judge-model",
  promptVersion: "judge-prompt-v1",
};

function evalRun(
  suiteId: string,
  caseId: string,
  attempt = 1,
): EvalRunArtifact {
  return {
    id: `eval-run-${caseId}-${attempt}`,
    suiteId,
    caseId,
    attempt,
    candidateResponse: `Server candidate for ${caseId}`,
    agentResult: {
      runId: `agent-run-${caseId}-${attempt}`,
      draft: {
        englishText: `Server candidate for ${caseId}`,
        patientLanguage: "English",
        patientText: `Server candidate for ${caseId}`,
      },
      proposedAction: "reply",
      handoffReason: null,
      evidence: [],
      toolCalls: [],
      stopReason: "completed",
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
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
          evidence: `Server candidate for ${caseId}`,
        },
      ],
      metadata: {
        provider: "test",
        model: judgeConfig.modelId,
        promptVersion: judgeConfig.promptVersion,
        rubricVersions: {
          "crit-aircon-selection": 1,
        },
        runId: `eval-run-${caseId}-${attempt}`,
        latencyMs: 10,
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        simulated: true,
      },
    },
    ranAt: "2026-07-13T12:00:00.000Z",
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function setup(options?: {
  failCaseId?: string;
  beforeRun?: () => Promise<void>;
}) {
  const storage = new MemoryStorage();
  const serverState = await createCanonicalServerState();
  let revision = 1;
  const workspaceClient: WorkspaceClient = {
    load: vi.fn(async () => ({
      workspaceId: "demo",
      revision,
      state: structuredClone(serverState),
    })),
  };
  const evalClient: EvalClient = {
    createSuite: vi.fn(async (request) => {
      const suite = await freezeEvalSuiteSnapshot({
        state: serverState,
        suiteId: "suite-browser",
        datasetId: request.datasetId,
        caseIds: request.caseIds,
        playbookVersionId: request.playbookVersionId,
        agentConfig,
        judgeConfig,
        baselineSuiteId: null,
        createdAt: "2026-07-13T12:00:00.000Z",
      });
      serverState.evalArtifacts.suites.push(suite);
      revision += 1;
      return {
        suiteId: suite.id,
        manifestHash: suite.manifestHash,
        workspaceRevision: revision,
      };
    }),
    runCase: vi.fn(async (request) => {
      await options?.beforeRun?.();
      if (request.caseId === options?.failCaseId) {
        throw new Error("Second case failed");
      }
      const artifact = evalRun(
        request.suiteId,
        request.caseId,
      );
      serverState.evalArtifacts.runs.push(artifact);
      revision += 1;
      return {
        suiteId: request.suiteId,
        caseId: request.caseId,
        attempt: artifact.attempt,
        status: "committed" as const,
        evalRunId: artifact.id,
        workspaceRevision: revision,
      };
    }),
  };
  const store = createAppStore(storage, {
    evalClient,
    workspaceClient,
  });
  return {
    evalClient,
    serverState,
    storage,
    store,
    workspaceClient,
  };
}

describe("server-backed Eval browser orchestration", () => {
  it("freezes and runs one case through the shared server runner", async () => {
    const { evalClient, store, workspaceClient } = await setup();

    const result = await store
      .getState()
      .runEvalCase("case-aircon-selection-train");

    expect(result.ok).toBe(true);
    expect(evalClient.createSuite).toHaveBeenCalledWith(
      expect.objectContaining({
        datasetId: "dataset-aircon-ops",
        caseIds: ["case-aircon-selection-train"],
        expectedWorkspaceRevision: 1,
      }),
      undefined,
    );
    expect(evalClient.runCase).toHaveBeenCalledWith(
      expect.objectContaining({
        suiteId: "suite-browser",
        caseId: "case-aircon-selection-train",
        expectedWorkspaceRevision: 2,
      }),
      undefined,
    );
    expect(workspaceClient.load).toHaveBeenCalledTimes(2);
    expect(
      store
        .getState()
        .state.evalDatasets[0]!.cases.find(
          (evalCase) => evalCase.id === "case-aircon-selection-train",
        ),
    ).toMatchObject({
      actualSyntheticOutput:
        "Server candidate for case-aircon-selection-train",
      grade: {
        pass: true,
      },
    });
  });

  it("continues running later cases after one case fails", async () => {
    const { evalClient, store } = await setup({
      failCaseId: "case-aircon-rate-card-holdout",
    });

    const result = await store
      .getState()
      .runEvalSuite("dataset-aircon-ops");

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      error: expect.stringContaining("case-aircon-rate-card-holdout"),
    });
    expect(evalClient.runCase).toHaveBeenCalledTimes(5);
    expect(
      vi.mocked(evalClient.runCase).mock.calls.map(
        ([request]) => request.caseId,
      ),
    ).toEqual([
      "case-aircon-rate-card-train",
      "case-aircon-selection-train",
      "case-aircon-confirm-train",
      "case-aircon-rate-card-holdout",
      "case-aircon-selection-holdout",
    ]);
    const dataset = store.getState().state.evalDatasets[0]!;
    expect(dataset.runHistory).toHaveLength(4);
    expect(
      dataset.cases.find(
        (evalCase) => evalCase.id === "case-aircon-selection-train",
      )?.actualSyntheticOutput,
    ).toContain("Server candidate");
    expect(
      dataset.cases.find(
        (evalCase) => evalCase.id === "case-aircon-rate-card-holdout",
      )?.actualSyntheticOutput,
    ).toBeUndefined();
    expect(
      dataset.cases.find(
        (evalCase) => evalCase.id === "case-aircon-selection-holdout",
      )?.actualSyntheticOutput,
    ).toContain("Server candidate");
  });

  it("runs and commits all five seed cases", async () => {
    const { evalClient, store } = await setup();

    await expect(
      store.getState().runEvalSuite("dataset-aircon-ops"),
    ).resolves.toMatchObject({ ok: true });
    expect(evalClient.runCase).toHaveBeenCalledTimes(5);
    expect(store.getState().state.evalDatasets[0]!.runHistory).toHaveLength(5);
  });

  it("preserves newer Chat and Knowledge state when server evidence arrives", async () => {
    let releaseRun: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    const { evalClient, store } = await setup({
      beforeRun: () => gate,
    });
    const pending = store
      .getState()
      .runEvalCase("case-aircon-selection-train");
    await vi.waitFor(() =>
      expect(evalClient.runCase).toHaveBeenCalled(),
    );
    const conversationId = store.getState().state.conversations[0]!.id;
    store.getState().sendStaffReply({
      conversationId,
      text: "Newer Chat state",
      kind: "reply",
    });
    store
      .getState()
      .setPlaybookDraft(
        "file-aircon-service-selection",
        "# Service selection\n\nNewer Knowledge state",
      );
    releaseRun?.();
    await expect(pending).resolves.toMatchObject({ ok: true });

    expect(
      store
        .getState()
        .state.conversations[0]!.messages.at(-1)?.text,
    ).toBe("Newer Chat state");
    expect(
      store
        .getState()
        .state.playbookFiles.find(
          (file) => file.id === "file-aircon-service-selection",
        )?.draft,
    ).toContain("Newer Knowledge state");
  });

  it("rehydrates committed server attempts after a browser reload", async () => {
    const { evalClient, serverState, store } = await setup();
    const suite = await evalClient.createSuite({
      datasetId: "dataset-aircon-ops",
      caseIds: ["case-aircon-selection-train"],
      playbookVersionId: serverState.playbookHistory.activeVersionId,
      expectedWorkspaceRevision: 1,
    });
    await evalClient.runCase({
      suiteId: suite.suiteId,
      caseId: "case-aircon-selection-train",
      expectedWorkspaceRevision: suite.workspaceRevision,
    });

    const result = await store
      .getState()
      .refreshEvalWorkspace();

    expect(result.ok).toBe(true);
    expect(
      store.getState().state.evalDatasets[0]!.runHistory,
    ).toHaveLength(1);
    expect(
      store.getState().state.evalDatasets[0]!.suiteSnapshots,
    ).toHaveLength(0);
  });

  it("discards an older Eval refresh that finishes after a newer one", async () => {
    const serverState = await createCanonicalServerState();
    const suite = await freezeEvalSuiteSnapshot({
      state: serverState,
      suiteId: "suite-refresh-race",
      datasetId: "dataset-aircon-ops",
      caseIds: ["case-aircon-selection-train"],
      playbookVersionId: serverState.playbookHistory.activeVersionId,
      agentConfig,
      judgeConfig,
      baselineSuiteId: null,
      createdAt: "2026-07-13T12:00:00.000Z",
    });
    const oldState = structuredClone(serverState);
    oldState.evalArtifacts.suites.push(suite);
    oldState.evalArtifacts.runs.push(
      evalRun(suite.id, "case-aircon-selection-train", 1),
    );
    const newState = structuredClone(oldState);
    newState.evalArtifacts.runs.push(
      evalRun(suite.id, "case-aircon-selection-train", 2),
    );
    const first = deferred<{
      workspaceId: string;
      revision: number;
      state: typeof oldState;
    }>();
    const second = deferred<{
      workspaceId: string;
      revision: number;
      state: typeof newState;
    }>();
    const workspaceClient: WorkspaceClient = {
      load: vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
    };
    const store = createAppStore(new MemoryStorage(), {
      evalClient: {
        createSuite: vi.fn(),
        runCase: vi.fn(),
      },
      workspaceClient,
    });

    const older = store.getState().refreshEvalWorkspace();
    const newer = store.getState().refreshEvalWorkspace();
    second.resolve({
      workspaceId: "demo",
      revision: 3,
      state: newState,
    });
    await expect(newer).resolves.toMatchObject({ ok: true });
    first.resolve({
      workspaceId: "demo",
      revision: 2,
      state: oldState,
    });

    await expect(older).resolves.toMatchObject({ ok: true });
    expect(
      store
        .getState()
        .state.evalDatasets[0]!.cases.find(
          (evalCase) => evalCase.id === "case-aircon-selection-train",
        )?.actualSyntheticOutput,
    ).toBe("Server candidate for case-aircon-selection-train");
    expect(
      store.getState().state.evalDatasets[0]!.runHistory.map((run) => run.id),
    ).toEqual([
      "eval-run-case-aircon-selection-train-1",
      "eval-run-case-aircon-selection-train-2",
    ]);
  });

  it("propagates cancellation and leaves uncommitted local evidence empty", async () => {
    const { evalClient, store } = await setup();
    vi.mocked(evalClient.runCase).mockImplementationOnce(
      (_request, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () =>
              reject(
                new DOMException(
                  "Evaluation canceled",
                  "AbortError",
                ),
              ),
            { once: true },
          );
        }),
    );
    const controller = new AbortController();
    const pending = store
      .getState()
      .runEvalCase("case-aircon-selection-train", {
        signal: controller.signal,
      });
    await vi.waitFor(() =>
      expect(evalClient.runCase).toHaveBeenCalled(),
    );

    controller.abort();

    await expect(pending).resolves.toMatchObject({ ok: false });
    expect(
      store.getState().state.evalDatasets[0]!.runHistory,
    ).toHaveLength(0);
  });

  it("rejects stale server evidence when the local Eval dataset changes", async () => {
    let releaseRun: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    const { evalClient, store } = await setup({
      beforeRun: () => gate,
    });
    const pending = store
      .getState()
      .runEvalCase("case-aircon-rate-card-train");
    await vi.waitFor(() =>
      expect(evalClient.runCase).toHaveBeenCalled(),
    );
    store.getState().editCase("case-aircon-rate-card-train", {
      title: "Newer local Eval definition",
    });

    releaseRun?.();
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(
      store.getState().state.evalDatasets[0]!.cases[0]?.title,
    ).toBe("Newer local Eval definition");
    expect(
      store.getState().state.evalDatasets[0]!.runHistory,
    ).toHaveLength(0);
  });

  it("fails closed before a mixed local and server suite can run", async () => {
    const { evalClient, store } = await setup();
    const resolved = store
      .getState()
      .state.conversations.find(
        (conversation) => conversation.workflowStatus === "resolved",
      );
    expect(resolved).toBeDefined();
    if (!resolved) return;
    store
      .getState()
      .importHitlFromConversation(resolved.id);

    const result = await store
      .getState()
      .runEvalSuite("dataset-aircon-ops");

    expect(result).toMatchObject({
      ok: false,
      error:
        "Run all cases supports server-synced seed cases only. Run local HITL or manual cases individually.",
    });
    expect(evalClient.createSuite).not.toHaveBeenCalled();
  });
});
