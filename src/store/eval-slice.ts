import {
  addCase,
  addCriterion,
  addDataset,
  analyzeFailures as analyzeDatasetFailures,
  buildGenerationInput,
  deleteCase,
  deleteCriterion,
  deleteDataset,
  duplicateCase,
  editCase,
  editCriterion,
  generateSyntheticOutput,
  importHitlConversations,
  importHitlFromConversation,
  playbookIdForConversation,
  projectEvalSuiteArtifacts,
  projectEvalWorkspaceArtifacts,
  projectServerWorkspace,
  renameDataset,
  runEvalCase,
  runEvalSuite,
  type AddCaseInput,
  type AddDatasetInput,
  type CaseEditInput,
  type CriterionId,
  type CriterionEditInput,
  type CriterionInput,
  type DeleteCaseOptions,
  type DeleteDatasetOptions,
  type EvalCaseId,
  type EvalDatasetId,
  type GenerationInputResult,
  type MutationResult,
  type PlaybookFileId,
  type RenameDatasetInput,
  type RunEvalCaseOptions,
  type RunEvalSuiteOptions,
  type SyntheticOutputResult,
  type ConversationId,
} from "../domain";
import type { JudgeClient } from "../contracts/judge";
import type {
  EvalClient,
  WorkspaceCommandClient,
  WorkspaceClient,
} from "../services/api-client";
import { applyMutation, rebaseAsyncMutationResult } from "./apply-mutation";
import type { AppStateRepository } from "./repository";

type EvalSliceDeps = {
  getState: () => import("../domain").AppState;
  set: (partial: { state?: import("../domain").AppState; lastFeedback?: string }) => void;
  repository: AppStateRepository;
  judgeClient: JudgeClient;
  evalClient?: EvalClient;
  workspaceCommandClient?: WorkspaceCommandClient;
  workspaceClient?: WorkspaceClient;
};

export function createEvalActions({
  getState,
  set,
  repository,
  judgeClient,
  evalClient,
  workspaceCommandClient,
  workspaceClient,
}: EvalSliceDeps) {
  let latestWorkspaceRefresh = 0;
  const run = (result: MutationResult, successFeedback: string | null) =>
    applyMutation(set, repository, result, successFeedback);
  const runAsync = async (
    compute: (baseState: import("../domain").AppState) => Promise<MutationResult>,
    successFeedback: string,
  ) => {
    const baseState = getState();
    const result = await compute(baseState);
    return run(rebaseAsyncMutationResult(baseState, getState(), result), successFeedback);
  };
  const failureMessage = (failure: unknown) =>
    failure instanceof Error
      ? failure.message
      : "Evaluation request failed";
  const runServerCases = async (
    datasetId: EvalDatasetId,
    caseIds: EvalCaseId[],
    signal?: AbortSignal,
    onCaseStart?: (caseId: EvalCaseId, completed: number, total: number) => void,
    onProgress?: (completed: number, total: number) => void,
  ): Promise<MutationResult> => {
    if (!evalClient || !workspaceClient) {
      return {
        ok: false,
        state: getState(),
        error: "Server Eval is not configured",
      };
    }
    onProgress?.(0, caseIds.length);
    try {
      let initial = await workspaceClient.load(signal);
      const localDataset = getState().evalDatasets.find((candidate) => candidate.id === datasetId);
      if (!localDataset) {
        return {
          ok: false,
          state: getState(),
          error: "Eval dataset was not found",
        };
      }
      if (workspaceCommandClient) {
        const synced = await workspaceCommandClient.execute(
          {
            kind: "sync_eval_dataset",
            dataset: localDataset,
            expectedWorkspaceRevision: initial.revision,
          },
          signal,
        );
        initial = synced.workspace;
      }
      const suite = await evalClient.createSuite(
        {
          datasetId,
          caseIds,
          playbookVersionId:
            initial.state.playbookHistory.activeVersionId,
          expectedWorkspaceRevision: initial.revision,
        },
        signal,
      );
      let workspaceRevision = suite.workspaceRevision;
      let latestServerState = initial.state;
      for (const [index, caseId] of caseIds.entries()) {
        onCaseStart?.(caseId, index, caseIds.length);
        const baseState = getState();
        const result = await evalClient.runCase(
          {
            suiteId: suite.suiteId,
            caseId,
            expectedWorkspaceRevision: workspaceRevision,
          },
          signal,
        );
        if (result.status !== "committed") {
          throw new Error("Evaluation case was not committed");
        }
        const workspace = await workspaceClient.load(signal);
        if (workspace.revision < result.workspaceRevision) {
          throw new Error(
            "Workspace Eval evidence refresh is stale",
          );
        }
        latestServerState = workspace.state;
        workspaceRevision = workspace.revision;
        const projected = projectEvalSuiteArtifacts(
          baseState,
          latestServerState,
          suite.suiteId,
          false,
        );
        const applied = run(
          rebaseAsyncMutationResult(
            baseState,
            getState(),
            projected,
          ),
          null,
        );
        if (!applied.ok) {
          throw new Error(applied.error);
        }
        onProgress?.(index + 1, caseIds.length);
      }
      const completionBase = getState();
      const completed = projectEvalSuiteArtifacts(
        completionBase,
        latestServerState,
        suite.suiteId,
        true,
      );
      if (!completed.ok) {
        throw new Error(completed.error);
      }
      const applied = run(
        rebaseAsyncMutationResult(
          completionBase,
          getState(),
          completed,
        ),
        null,
      );
      if (!applied.ok) {
        throw new Error(applied.error);
      }
      set({ lastFeedback: "Evaluation suite run completed." });
      return {
        ok: true,
        state: getState(),
      };
    } catch (failure) {
      const error = failureMessage(failure);
      set({ lastFeedback: error });
      return {
        ok: false,
        state: getState(),
        error,
      };
    }
  };

  return {
    async getEvalExecutionCapability(signal?: AbortSignal) {
      if (!evalClient?.executionCapability) {
        return { enabled: true, reason: null };
      }
      try {
        return await evalClient.executionCapability(signal);
      } catch (failure) {
        return { enabled: false, reason: failureMessage(failure) };
      }
    },

    async refreshEvalWorkspace(signal?: AbortSignal) {
      if (!evalClient || !workspaceClient) {
        return {
          ok: false as const,
          state: getState(),
          error: "Server Eval is not configured",
        };
      }
      const generation = ++latestWorkspaceRefresh;
      const baseState = getState();
      try {
        const workspace = await workspaceClient.load(signal);
        if (generation !== latestWorkspaceRefresh) {
          return { ok: true as const, state: getState() };
        }
        const projected = projectEvalWorkspaceArtifacts(
          baseState,
          workspace.state,
        );
        return run(
          rebaseAsyncMutationResult(
            baseState,
            getState(),
            projected,
          ),
          null,
        );
      } catch (failure) {
        if (generation !== latestWorkspaceRefresh) {
          return { ok: true as const, state: getState() };
        }
        return {
          ok: false as const,
          state: getState(),
          error: failureMessage(failure),
        };
      }
    },

    importHitlFromConversation(conversationId: ConversationId) {
      return run(
        importHitlFromConversation(getState(), conversationId),
        "Resolved conversation imported.",
      );
    },

    importHitlConversations(conversationIds: ConversationId[]) {
      return run(
        importHitlConversations(getState(), conversationIds),
        `${conversationIds.length} resolved ${
          conversationIds.length === 1 ? "conversation" : "conversations"
        } imported.`,
      );
    },

    addDataset(input: AddDatasetInput) {
      return run(addDataset(getState(), input), "Dataset added.");
    },

    renameDataset(input: RenameDatasetInput) {
      return run(renameDataset(getState(), input), "Dataset renamed.");
    },

    deleteDataset(options: DeleteDatasetOptions) {
      return run(deleteDataset(getState(), options), "Dataset deleted.");
    },

    addCriterion(datasetId: EvalDatasetId, input: CriterionInput) {
      return run(addCriterion(getState(), datasetId, input), "Criterion added.");
    },

    editCriterion(criterionId: CriterionId, input: CriterionEditInput) {
      return run(editCriterion(getState(), criterionId, input), "Criterion updated.");
    },

    deleteCriterion(criterionId: CriterionId) {
      return run(deleteCriterion(getState(), criterionId), "Criterion deleted.");
    },

    addCase(input: AddCaseInput) {
      return run(addCase(getState(), input), "Case added.");
    },

    editCase(caseId: EvalCaseId, input: CaseEditInput) {
      return run(editCase(getState(), caseId, input), "Case updated.");
    },

    duplicateCase(caseId: EvalCaseId) {
      return run(duplicateCase(getState(), caseId), "Case duplicated.");
    },

    deleteCase(caseId: EvalCaseId, options: DeleteCaseOptions) {
      return run(deleteCase(getState(), caseId, options), "Case deleted.");
    },

    async runEvalCase(caseId: EvalCaseId, options?: RunEvalCaseOptions) {
      const dataset = getState().evalDatasets.find((candidate) =>
        candidate.cases.some(
          (evalCase) => evalCase.id === caseId,
        ),
      );
      const evalCase = dataset?.cases.find(
        (candidate) => candidate.id === caseId,
      );
      if (
        evalClient &&
        workspaceClient &&
        (evalCase?.source.kind === "seed" || workspaceCommandClient)
      ) {
        const serverDataset = getState().evalDatasets.find((candidate) =>
          candidate.cases.some(
            (evalCase) => evalCase.id === caseId,
          ),
        );
        if (!serverDataset) {
          return {
            ok: false as const,
            state: getState(),
            error: "Eval case was not found",
          };
        }
        return runServerCases(
          serverDataset.id,
          [caseId],
          options?.signal,
        );
      }
      return runAsync(
        (baseState) => runEvalCase(baseState, caseId, judgeClient, options),
        "Evaluation case run completed.",
      );
    },

    async runEvalSuite(datasetId: EvalDatasetId, options?: RunEvalSuiteOptions) {
      if (evalClient && workspaceClient) {
        const dataset = getState().evalDatasets.find(
          (candidate) => candidate.id === datasetId,
        );
        if (!dataset) {
          return {
            ok: false as const,
            state: getState(),
            error: "Eval dataset was not found",
          };
        }
        if (dataset.cases.some((evalCase) => evalCase.source.kind !== "seed") && !workspaceCommandClient) {
          return {
            ok: false as const,
            state: getState(),
            error:
              "Run Suite supports server-synced seed cases only. Run local HITL or manual cases individually.",
          };
        }
        return runServerCases(
          dataset.id,
          dataset.cases.map((evalCase) => evalCase.id),
          options?.signal,
          options?.onCaseStart,
          options?.onProgress,
        );
      }
      let sourceState = getState();
      let incrementalFailure: string | null = null;
      const result = await runEvalSuite(sourceState, datasetId, judgeClient, {
        ...options,
        onCaseComplete: (completedState, caseId, completed, total) => {
          if (incrementalFailure) return;
          const projected = rebaseAsyncMutationResult(sourceState, getState(), {
            ok: true,
            state: completedState,
          });
          if (!projected.ok) {
            incrementalFailure = projected.error;
            return;
          }
          const applied = run(projected, null);
          if (!applied.ok) {
            incrementalFailure = applied.error;
            return;
          }
          sourceState = completedState;
          options?.onCaseComplete?.(completedState, caseId, completed, total);
        },
      });
      if (incrementalFailure) {
        return run({ ok: false, state: getState(), error: incrementalFailure }, null);
      }
      if (!result.ok) {
        return run({ ok: false, state: getState(), error: result.error }, null);
      }
      return run(
        rebaseAsyncMutationResult(sourceState, getState(), result),
        "Evaluation suite run completed.",
      );
    },

    analyzeFailures(datasetId: EvalDatasetId) {
      return run(analyzeDatasetFailures(getState(), datasetId), null);
    },

    async proposeCorrections(datasetId: EvalDatasetId) {
      if (!workspaceClient || !workspaceCommandClient) {
        return run(analyzeDatasetFailures(getState(), datasetId), null);
      }
      const base = getState();
      try {
        const workspace = await workspaceClient.load();
        const result = await workspaceCommandClient.execute({
          kind: "propose_correction",
          datasetId,
          expectedWorkspaceRevision: workspace.revision,
        });
        const projected = projectServerWorkspace(base, result.workspace.state);
        return run(projected, "LLM SOP proposal created for human review.");
      } catch (failure) {
        const error = failureMessage(failure);
        set({ lastFeedback: error });
        return { ok: false as const, state: getState(), error };
      }
    },

    buildGenerationInput(caseId: EvalCaseId): GenerationInputResult {
      return buildGenerationInput(getState(), caseId);
    },

    generateSyntheticOutput(caseId: EvalCaseId): SyntheticOutputResult {
      return generateSyntheticOutput(getState(), caseId);
    },

    playbookIdForConversation(conversationId: ConversationId): PlaybookFileId | null {
      const conversation = getState().conversations.find((item) => item.id === conversationId);
      if (!conversation) {
        return null;
      }
      return playbookIdForConversation(conversation);
    },
  };
}
