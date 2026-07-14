import {
  approveCorrection,
  createPlaybookFile,
  createPlaybookFolder,
  deletePlaybookFile,
  discardPlaybookDraft,
  rejectCorrection,
  renamePlaybookFile,
  runTestChanges,
  savePlaybookDraft,
  setPlaybookDraft,
  type CreatePlaybookFileInput,
  type DeletePlaybookFileOptions,
  type CorrectionId,
  type MutationResult,
  type PlaybookFileId,
  type RenamePlaybookFileInput,
  type TestChangesMutationResult,
} from "../domain";
import { applyMutation, applyTestChangesMutation } from "./apply-mutation";
import type { AppStateRepository } from "./repository";

type DreamSliceDeps = {
  getState: () => import("../domain").AppState;
  set: (partial: { state?: import("../domain").AppState; lastFeedback?: string }) => void;
  repository: AppStateRepository;
};

export function createDreamActions({ getState, set, repository }: DreamSliceDeps) {
  const run = (result: MutationResult, successFeedback: string | null) =>
    applyMutation(set, repository, result, successFeedback);

  return {
    createPlaybookFile(input: CreatePlaybookFileInput) {
      return run(createPlaybookFile(getState(), input), "Playbook file created.");
    },

    createPlaybookFolder(path: string) {
      return run(createPlaybookFolder(getState(), path), "Playbook folder created.");
    },

    renamePlaybookFile(input: RenamePlaybookFileInput) {
      return run(renamePlaybookFile(getState(), input), "Playbook file renamed.");
    },

    deletePlaybookFile(options: DeletePlaybookFileOptions) {
      return run(deletePlaybookFile(getState(), options), "Playbook file deleted.");
    },

    setPlaybookDraft(fileId: PlaybookFileId, draft: string) {
      return run(setPlaybookDraft(getState(), fileId, draft), null);
    },

    savePlaybookDraft(fileId: PlaybookFileId) {
      return run(savePlaybookDraft(getState(), fileId), "Draft saved.");
    },

    discardPlaybookDraft(fileId: PlaybookFileId) {
      return run(discardPlaybookDraft(getState(), fileId), "Draft discarded.");
    },

    approveCorrection(correctionId: CorrectionId) {
      return run(approveCorrection(getState(), correctionId), "Correction approved.");
    },

    rejectCorrection(correctionId: CorrectionId) {
      return run(rejectCorrection(getState(), correctionId), "Correction rejected.");
    },

    runTestChanges(fileId: PlaybookFileId): TestChangesMutationResult {
      return applyTestChangesMutation(
        set,
        repository,
        runTestChanges(getState(), fileId),
        "Test changes completed.",
      ) as TestChangesMutationResult;
    },
  };
}
