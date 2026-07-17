import { createStore, type StoreApi } from "zustand";

import type { JudgeClient } from "../contracts/judge";
import {
  type AppState,
  type CorrectionId,
  type EvalCaseId,
  type MutationResult,
} from "../domain";
import { projectAuthoritativeWorkspace } from "../domain/telegram-workspace";
import { createHttpJudgeClient } from "../services/judge-client";
import {
  ApiClientError,
  createHttpBookingClient,
  createHttpAgentClient,
  createHttpEvalClient,
  createHttpTelegramOutboundClient,
  createHttpWorkspaceCommandClient,
  createHttpWorkspaceClient,
  isFactoryResetCompletedWithCleanupFailure,
  type AgentClient,
  type BookingClient,
  type EvalClient,
  type TelegramOutboundClient,
  type WorkspaceCommandClient,
  type WorkspaceClient,
} from "../services/api-client";
import { createAgentActions } from "./agent-slice";
import { applyMutation } from "./apply-mutation";
import { createChatActions } from "./chat-slice";
import { createKnowledgeActions, type KnowledgeReleaseState } from "./knowledge-slice";
import { createEvalActions } from "./eval-slice";
import {
  createLocalAppStateRepository,
  type AppStateRepository,
} from "./repository";
import { createSelectionActions } from "./selection-slice";
import { createTelegramActions } from "./telegram-slice";
import {
  createTelegramWorkspaceRepository,
  INITIAL_TELEGRAM_WORKSPACE,
  type TelegramWorkspaceRepository,
  type TelegramWorkspaceState,
} from "./telegram-workspace-repository";

export type RouteUiState = {
  chatMobilePane: "list" | "thread" | "details";
  knowledgeCorrectionId: CorrectionId | null;
  knowledgePane: "files" | "editor" | "changes";
  evalCaseId: EvalCaseId | null;
  evalDrawer: "evidence" | null;
};

const DEFAULT_ROUTE_UI: RouteUiState = {
  chatMobilePane: "list",
  knowledgeCorrectionId: null,
  knowledgePane: "files",
  evalCaseId: null,
  evalDrawer: null,
};

export type AppStoreState = {
  state: AppState;
  lastFeedback: string;
  resetVersion: number;
  knowledgeRelease: KnowledgeReleaseState | null;
  routeUi: RouteUiState;
  telegramWorkspace: TelegramWorkspaceState;
  resetDemo: () => MutationResult | Promise<MutationResult>;
  updateRouteUi: (partial: Partial<RouteUiState>) => void;
  selectConversation: ReturnType<typeof createSelectionActions>["selectConversation"];
  selectPlaybookFile: ReturnType<typeof createSelectionActions>["selectPlaybookFile"];
  selectEvalDataset: ReturnType<typeof createSelectionActions>["selectEvalDataset"];
} & ReturnType<typeof createChatActions> &
  ReturnType<typeof createAgentActions> &
  ReturnType<typeof createTelegramActions> &
  ReturnType<typeof createKnowledgeActions> &
  ReturnType<typeof createEvalActions>;

export type AppStore = StoreApi<AppStoreState>;

export type AppStoreOptions = {
  agentClient?: AgentClient;
  bookingClient?: BookingClient;
  evalClient?: EvalClient;
  judgeClient?: JudgeClient;
  outboundClient?: TelegramOutboundClient;
  stateRepository?: AppStateRepository;
  telegramWorkspaceRepository?: TelegramWorkspaceRepository;
  workspaceCommandClient?: WorkspaceCommandClient;
  workspaceClient?: WorkspaceClient;
};

export function createAppStore(storage: Storage, options: AppStoreOptions = {}): AppStore {
  const repository = options.stateRepository ?? createLocalAppStateRepository(storage);
  const loaded = repository.load();
  if (loaded.migrated) {
    repository.save(loaded.state);
  }
  const agentClient = options.agentClient ?? createHttpAgentClient();
  const bookingClient = options.bookingClient ?? createHttpBookingClient();
  const judgeClient = options.judgeClient ?? createHttpJudgeClient();
  const outboundClient =
    options.outboundClient ?? createHttpTelegramOutboundClient();
  const workspaceClient =
    options.workspaceClient ?? createHttpWorkspaceClient();
  const workspaceCommandClient = options.workspaceCommandClient;
  const telegramWorkspaceRepository =
    options.telegramWorkspaceRepository ??
    createTelegramWorkspaceRepository(storage);
  const telegramWorkspace = telegramWorkspaceRepository.load();

  return createStore<AppStoreState>((set, get) => {
    const getAppState = () => get().state;
    const setAppState = (state: AppState) => set({ state });
    const setPartial = (partial: {
      state?: AppState;
      lastFeedback?: string;
      knowledgeRelease?: KnowledgeReleaseState | null;
      telegramWorkspace?: TelegramWorkspaceState;
    }) => set(partial);
    const deps = { getState: getAppState, repository, set: setPartial };

    const selection = createSelectionActions(getAppState, setAppState, repository);
    const chat = createChatActions(deps);
    const agent = createAgentActions({
      agentClient,
      getState: getAppState,
      set: setPartial,
      workspaceClient,
    });
    const telegram = createTelegramActions({
      ...deps,
      getTelegramWorkspace: () => get().telegramWorkspace,
      bookingClient,
      outboundClient,
      telegramWorkspaceRepository,
      workspaceClient,
    });
    const knowledge = createKnowledgeActions({
      ...deps,
      workspaceClient,
      workspaceCommandClient,
    });
    const evalActions = createEvalActions({
      ...deps,
      evalClient: options.evalClient,
      judgeClient,
      workspaceCommandClient,
      workspaceClient,
    });
    const finishReset = (
      result: MutationResult,
      telegramWorkspaceState: TelegramWorkspaceState,
      feedback = "Demo reset to canonical seed.",
    ) => {
      const applied = applyMutation(
        setPartial,
        repository,
        result,
        feedback,
      );
      if (applied.ok) {
        telegramWorkspaceRepository.save(telegramWorkspaceState);
        set({
          resetVersion: get().resetVersion + 1,
          routeUi: { ...DEFAULT_ROUTE_UI },
          knowledgeRelease: null,
          telegramWorkspace: telegramWorkspaceState,
        });
      }
      return applied;
    };

    const clearedTelegramWorkspace = (
      workspaceRevision: number,
    ): TelegramWorkspaceState => ({
      ...INITIAL_TELEGRAM_WORKSPACE,
      status: "ready",
      workspaceRevision,
    });

    const adoptAuthoritativeWorkspace = (
      workspace: { revision: number; state: Parameters<typeof projectAuthoritativeWorkspace>[0] },
      feedback: string,
    ) => {
      const projected = projectAuthoritativeWorkspace(workspace.state);
      if (!projected.ok) {
        set({ lastFeedback: projected.error });
        return projected;
      }
      return finishReset(
        projected,
        clearedTelegramWorkspace(workspace.revision),
        feedback,
      );
    };

    return {
      state: loaded.state,
      lastFeedback: loaded.loadNotice,
      resetVersion: 0,
      knowledgeRelease: null,
      routeUi: DEFAULT_ROUTE_UI,
      telegramWorkspace,
      resetDemo() {
        const expectedRevision = get().telegramWorkspace.workspaceRevision;
        const resetWorkspace = workspaceClient.reset;
        if (expectedRevision === null || !resetWorkspace) {
          const message =
            "Factory reset is unavailable until the server workspace finishes loading.";
          set({ lastFeedback: message });
          return {
            ok: false as const,
            state: get().state,
            error: message,
          };
        }
        return (async () => {
          try {
            const response = await resetWorkspace(expectedRevision);
            if (!response.ok) {
              const message =
                response.code === "revision_conflict"
                  ? "Workspace changed before reset. Refresh and retry."
                  : "The demo could not be reset.";
              set({ lastFeedback: message });
              return {
                ok: false as const,
                state: get().state,
                error: message,
              };
            }
            return adoptAuthoritativeWorkspace(
              response.workspace,
              "Demo reset to canonical seed.",
            );
          } catch (error) {
            if (
              error instanceof ApiClientError &&
              isFactoryResetCompletedWithCleanupFailure(error)
            ) {
              try {
                const envelope = await workspaceClient.load();
                if (envelope.revision > expectedRevision) {
                  return adoptAuthoritativeWorkspace(
                    envelope,
                    error.message,
                  );
                }
              } catch {
                // Fall through to the explicit failure below.
              }
            }
            const message =
              error instanceof ApiClientError
                ? error.message
                : "The demo could not be reset.";
            set({ lastFeedback: message });
            return {
              ok: false as const,
              state: get().state,
              error: message,
            };
          }
        })();
      },
      updateRouteUi(partial) {
        set({ routeUi: { ...get().routeUi, ...partial } });
      },
      ...selection,
      ...chat,
      ...agent,
      ...telegram,
      ...knowledge,
      ...evalActions,
    };
  });
}

let defaultStore: AppStore | undefined;

export function getAppStore(storage: Storage = localStorage): AppStore {
  if (!defaultStore) {
    defaultStore = createAppStore(storage, {
      evalClient: createHttpEvalClient(),
      workspaceCommandClient: createHttpWorkspaceCommandClient(),
    });
  }
  return defaultStore;
}
