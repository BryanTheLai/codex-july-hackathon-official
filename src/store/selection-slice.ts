import type {
  AppState,
  ConversationId,
  EvalDatasetId,
  PlaybookFileId,
} from "../domain";
import type { AppStateRepository } from "./repository";

type SelectionSetter = (state: AppState) => void;

function isConversationId(state: AppState, id: ConversationId): boolean {
  return state.conversations.some((conversation) => conversation.id === id);
}

function isPlaybookFileId(state: AppState, id: PlaybookFileId): boolean {
  return state.playbookFiles.some((file) => file.id === id);
}

function isEvalDatasetId(state: AppState, id: EvalDatasetId): boolean {
  return state.evalDatasets.some((dataset) => dataset.id === id);
}

export function createSelectionActions(
  getState: () => AppState,
  setState: SelectionSetter,
  repository: AppStateRepository,
) {
  return {
    selectConversation(conversationId: ConversationId | null) {
      const current = getState();
      if (conversationId === null) {
        const next: AppState = {
          ...current,
          selections: { ...current.selections, conversationId: null },
        };
        setState(next);
        repository.save(next);
        return;
      }
      if (!isConversationId(current, conversationId)) {
        return;
      }
      const next: AppState = {
        ...current,
        selections: { ...current.selections, conversationId },
      };
      setState(next);
      repository.save(next);
    },

    selectPlaybookFile(playbookFileId: PlaybookFileId) {
      const current = getState();
      if (!isPlaybookFileId(current, playbookFileId)) {
        return;
      }
      const next: AppState = {
        ...current,
        selections: { ...current.selections, playbookFileId },
      };
      setState(next);
      repository.save(next);
    },

    selectEvalDataset(evalDatasetId: EvalDatasetId) {
      const current = getState();
      if (!isEvalDatasetId(current, evalDatasetId)) {
        return;
      }
      const next: AppState = {
        ...current,
        selections: { ...current.selections, evalDatasetId },
      };
      setState(next);
      repository.save(next);
    },
  };
}
