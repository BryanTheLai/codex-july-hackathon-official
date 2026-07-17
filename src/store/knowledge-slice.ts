import {
  approveCorrection,
  createPlaybookFile,
  createPlaybookFolder,
  deletePlaybookFile,
  discardPlaybookDraft,
  rejectCorrection,
  renamePlaybookFile,
  runSavedTextCheck,
  savePlaybookDraft,
  setPlaybookDraft,
  type CreatePlaybookFileInput,
  type DeletePlaybookFileOptions,
  type CorrectionId,
  type MutationResult,
  type PlaybookFile,
  type PlaybookFileId,
  type RenamePlaybookFileInput,
  type SavedTextCheckMutationResult,
  projectServerWorkspace,
} from "../domain";
import { applyMutation, applySavedTextCheckMutation } from "./apply-mutation";
import type { AppStateRepository } from "./repository";
import {
  type WorkspaceCommandClient,
  type WorkspaceClient,
} from "../services/api-client";
import type {
  WorkspaceCommandRequest,
  WorkspaceCommandResult,
} from "../contracts/workflow";

export type KnowledgeReleaseState = {
  activeVersionId: string;
  activeVersionSequence: number;
  candidateVersionId: string | null;
  candidateVersionSequence: number | null;
  candidateReady: boolean;
  rollbackTargetVersionId: string | null;
  rollbackTargetVersionSequence: number | null;
  workspaceRevision: number;
};

type KnowledgeWorkflowResult = MutationResult & {
  release?: KnowledgeReleaseState;
  replay?: WorkspaceCommandResult["replay"];
};

type KnowledgeSliceDeps = {
  getState: () => import("../domain").AppState;
  set: (partial: {
    state?: import("../domain").AppState;
    lastFeedback?: string;
    knowledgeRelease?: KnowledgeReleaseState | null;
  }) => void;
  repository: AppStateRepository;
  workspaceClient?: WorkspaceClient;
  workspaceCommandClient?: WorkspaceCommandClient;
};

function releaseFrom(result: WorkspaceCommandResult): KnowledgeReleaseState {
  const history = result.workspace.state.playbookHistory;
  const active = history.versions.find(
    (version) => version.id === history.activeVersionId,
  );
  const candidate = history.candidateVersionId
    ? history.versions.find((version) => version.id === history.candidateVersionId)
    : null;
  const rollbackTargetVersionId =
    active?.kind === "restore" ? null : history.rollbackTargetVersionId;
  const rollbackTarget = rollbackTargetVersionId
    ? history.versions.find((version) => version.id === rollbackTargetVersionId)
    : null;
  return {
    activeVersionId: history.activeVersionId,
    activeVersionSequence: active?.sequence ?? 1,
    candidateVersionId: history.candidateVersionId,
    candidateVersionSequence: candidate?.sequence ?? null,
    candidateReady: Boolean(candidate?.passingSuiteId),
    rollbackTargetVersionId,
    rollbackTargetVersionSequence: rollbackTarget?.sequence ?? null,
    workspaceRevision: result.workspace.revision,
  };
}

export function createKnowledgeActions({
  getState,
  set,
  repository,
  workspaceClient,
  workspaceCommandClient,
}: KnowledgeSliceDeps) {
  const run = (result: MutationResult, successFeedback: string | null) =>
    applyMutation(set, repository, result, successFeedback);
  const runWorkflow = async (
    createCommand: (revision: number) => WorkspaceCommandRequest,
    successFeedback: string,
    signal?: AbortSignal,
  ): Promise<KnowledgeWorkflowResult> => {
    if (!workspaceClient || !workspaceCommandClient) {
      return { ok: false, state: getState(), error: "Knowledge release server is not configured" };
    }
    const base = getState();
    try {
      const current = await workspaceClient.load(signal);
      const result = await workspaceCommandClient.execute(createCommand(current.revision), signal);
      const release = releaseFrom(result);
      const projected = projectServerWorkspace(base, result.workspace.state);
      if (!projected.ok) {
        set({ knowledgeRelease: release, lastFeedback: projected.error });
        return projected;
      }
      repository.save(projected.state);
      set({ state: projected.state, knowledgeRelease: release, lastFeedback: successFeedback });
      return { ok: true, state: projected.state, release, replay: result.replay };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Knowledge release request failed";
      set({ lastFeedback: message });
      return { ok: false, state: getState(), error: message };
    }
  };

  return {
    async refreshKnowledgeWorkspace(signal?: AbortSignal): Promise<KnowledgeWorkflowResult> {
      if (!workspaceClient) {
        return { ok: false, state: getState(), error: "Knowledge release server is not configured" };
      }
      const base = getState();
      try {
        const workspace = await workspaceClient.load(signal);
        const result = { workspace, replay: null } as WorkspaceCommandResult;
        const release = releaseFrom(result);
        const projected = projectServerWorkspace(base, workspace.state);
        if (!projected.ok) {
          set({ knowledgeRelease: release, lastFeedback: projected.error });
          return projected;
        }
        repository.save(projected.state);
        set({ state: projected.state, knowledgeRelease: release });
        return { ok: true, state: projected.state, release, replay: null };
      } catch (error) {
        return {
          ok: false,
          state: getState(),
          error: error instanceof Error ? error.message : "Knowledge release request failed",
        };
      }
    },

    createKnowledgeCandidateFromDraft(fileId: PlaybookFileId, content: string, signal?: AbortSignal) {
      return runWorkflow(
        (expectedWorkspaceRevision) => ({
          kind: "create_candidate_from_draft",
          fileId,
          content,
          expectedWorkspaceRevision,
        }),
        "Inactive Knowledge candidate created. Run affected Eval cases next.",
        signal,
      );
    },

    acceptKnowledgeCorrection(correctionId: CorrectionId, signal?: AbortSignal) {
      return runWorkflow(
        (expectedWorkspaceRevision) => ({
          kind: "create_candidate_from_correction",
          correctionId,
          expectedWorkspaceRevision,
        }),
        "Inactive Knowledge candidate created from the accepted correction.",
        signal,
      );
    },

    stageKnowledgeFile(file: PlaybookFile, signal?: AbortSignal) {
      return runWorkflow(
        (expectedWorkspaceRevision) => ({
          kind: "create_candidate_from_file",
          file: {
            id: file.id,
            path: file.path,
            title: file.title,
            content: file.draft ?? file.savedContent,
          },
          expectedWorkspaceRevision,
        }),
        "Inactive Knowledge candidate created from the file change.",
        signal,
      );
    },

    stageKnowledgeFileDeletion(fileId: PlaybookFileId, signal?: AbortSignal) {
      return runWorkflow(
        (expectedWorkspaceRevision) => ({
          kind: "create_candidate_from_file_deletion",
          fileId,
          expectedWorkspaceRevision,
        }),
        "Inactive Knowledge candidate created from the file deletion.",
        signal,
      );
    },

    importKnowledgeMarkdown(
      path: string,
      title: string,
      content: string,
      signal?: AbortSignal,
    ) {
      return runWorkflow(
        (expectedWorkspaceRevision) => ({
          kind: "import_markdown",
          path,
          title,
          content,
          expectedWorkspaceRevision,
        }),
        "Markdown imported as an inactive Knowledge candidate.",
        signal,
      );
    },

    replayKnowledgeCandidate(
      candidateVersionId: string,
      datasetId: string,
      scope: "affected" | "full",
      signal?: AbortSignal,
    ) {
      return runWorkflow(
        (expectedWorkspaceRevision) => ({
          kind: "replay_candidate",
          candidateVersionId,
          datasetId,
          scope,
          expectedWorkspaceRevision,
        }),
        scope === "full"
          ? "Full train and holdout replay completed."
          : "Affected Eval replay completed.",
        signal,
      );
    },

    activateKnowledgeCandidate(candidateVersionId: string, signal?: AbortSignal) {
      return runWorkflow(
        (expectedWorkspaceRevision) => ({
          kind: "activate_candidate",
          candidateVersionId,
          expectedWorkspaceRevision,
        }),
        "Knowledge candidate activated. New Chat drafts use this SOP.",
        signal,
      );
    },

    discardKnowledgeCandidate(candidateVersionId: string, signal?: AbortSignal) {
      return runWorkflow(
        (expectedWorkspaceRevision) => ({
          kind: "discard_candidate",
          candidateVersionId,
          expectedWorkspaceRevision,
        }),
        "Inactive Knowledge candidate discarded. Active SOP remains unchanged.",
        signal,
      );
    },

    rollbackKnowledgePlaybook(signal?: AbortSignal) {
      return runWorkflow(
        (expectedWorkspaceRevision) => ({
          kind: "rollback_playbook",
          expectedWorkspaceRevision,
        }),
        "Knowledge restored as a new immutable version.",
        signal,
      );
    },

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

    runSavedTextCheck(fileId: PlaybookFileId): SavedTextCheckMutationResult {
      return applySavedTextCheckMutation(
        set,
        repository,
        runSavedTextCheck(getState(), fileId),
        "Saved text check completed.",
      ) as SavedTextCheckMutationResult;
    },
  };
}
