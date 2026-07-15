import { createStore, type StoreApi } from "zustand";

import type { JudgeClient } from "../contracts/judge";
import {
  projectEvalWorkspaceArtifacts,
  resetDemo as resetLocalDemo,
  type AppState,
  type CorrectionId,
  type EvalCaseId,
  type MutationResult,
} from "../domain";
import { mergeTelegramWorkspaceState } from "../domain/telegram-workspace";
import { createHttpJudgeClient } from "../services/judge-client";
import {
  ApiClientError,
  createHttpAgentClient,
  createHttpEvalClient,
  createHttpTelegramOutboundClient,
  createHttpWorkspaceCommandClient,
  createHttpWorkspaceClient,
  type AgentClient,
  type EvalClient,
  type TelegramOutboundClient,
  type WorkspaceCommandClient,
  type WorkspaceClient,
} from "../services/api-client";
import { createAgentActions } from "./agent-slice";
import { applyMutation } from "./apply-mutation";
import { createChatActions } from "./chat-slice";
import { createDreamActions, type DreamReleaseState } from "./dream-slice";
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
  dreamCorrectionId: CorrectionId | null;
  dreamPane: "files" | "editor" | "changes";
  evalCaseId: EvalCaseId | null;
  evalDrawer: "evidence" | null;
};

const DEFAULT_ROUTE_UI: RouteUiState = {
  chatMobilePane: "list",
  dreamCorrectionId: null,
  dreamPane: "files",
  evalCaseId: null,
  evalDrawer: null,
};

export type AppStoreState = {
  state: AppState;
  lastFeedback: string;
  resetVersion: number;
  dreamRelease: DreamReleaseState | null;
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
  ReturnType<typeof createDreamActions> &
  ReturnType<typeof createEvalActions>;

export type AppStore = StoreApi<AppStoreState>;

export type AppStoreOptions = {
  agentClient?: AgentClient;
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
      dreamRelease?: DreamReleaseState | null;
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
      outboundClient,
      telegramWorkspaceRepository,
      workspaceClient,
    });
    const dream = createDreamActions({
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
      clearTelegramWorkspace: boolean,
    ) => {
      const applied = applyMutation(
        setPartial,
        repository,
        result,
        "Demo reset to canonical seed.",
      );
      if (applied.ok) {
        if (clearTelegramWorkspace) {
          telegramWorkspaceRepository.clear();
        } else {
          telegramWorkspaceRepository.save(telegramWorkspaceState);
        }
        set({
          resetVersion: get().resetVersion + 1,
          routeUi: { ...DEFAULT_ROUTE_UI },
          dreamRelease: null,
          telegramWorkspace: telegramWorkspaceState,
        });
      }
      return applied;
    };

    return {
      state: loaded.state,
      lastFeedback: loaded.loadNotice,
      resetVersion: 0,
      dreamRelease: null,
      routeUi: DEFAULT_ROUTE_UI,
      telegramWorkspace,
      resetDemo() {
        const workspaceState = get().telegramWorkspace;
        const expectedRevision = workspaceState.workspaceRevision;
        const resetWorkspace = workspaceClient.reset;
        if (
          expectedRevision === null ||
          !resetWorkspace
        ) {
          return finishReset(
            resetLocalDemo(get().state),
            INITIAL_TELEGRAM_WORKSPACE,
            true,
          );
        }
        return (async () => {
          try {
            const response = await resetWorkspace(expectedRevision);
            if (!response.ok) {
              const message =
                "Workspace changed before reset. Refresh and retry.";
              set({ lastFeedback: message });
              return {
                ok: false as const,
                state: get().state,
                error: message,
              };
            }
            const canonical = resetLocalDemo(get().state);
            if (!canonical.ok) {
              return canonical;
            }
            const server = response.workspace.state;
            const projected = mergeTelegramWorkspaceState(
              {
                ...canonical.state,
                schemaVersion: server.schemaVersion,
                fixtureTime: server.fixtureTime,
                playbookFolders: server.playbookFolders,
                playbookFiles: server.playbookFiles,
                corrections: server.corrections,
                evalDatasets: server.evalDatasets,
              },
              server,
            );
            const evalProjection = projectEvalWorkspaceArtifacts(
              projected.state,
              server,
            );
            if (!evalProjection.ok) {
              set({ lastFeedback: evalProjection.error });
              return {
                ok: false as const,
                state: get().state,
                error: evalProjection.error,
              };
            }
            return finishReset(
              evalProjection,
              {
                ...workspaceState,
                status: "ready",
                workspaceRevision: response.workspace.revision,
                conversationRevisions:
                  projected.conversationRevisions,
              },
              false,
            );
          } catch (error) {
            if (
              error instanceof ApiClientError &&
              error.code === "feature_disabled"
            ) {
              return finishReset(
                resetLocalDemo(get().state),
                INITIAL_TELEGRAM_WORKSPACE,
                true,
              );
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
      ...dream,
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
