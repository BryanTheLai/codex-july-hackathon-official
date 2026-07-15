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
  type PlaybookFile,
  type PlaybookFileId,
  type RenamePlaybookFileInput,
  type TestChangesMutationResult,
  projectServerWorkspace,
} from "../domain";
import { applyMutation, applyTestChangesMutation } from "./apply-mutation";
import type { AppStateRepository } from "./repository";
import {
  type WorkspaceCommandClient,
  type WorkspaceClient,
} from "../services/api-client";
import type {
  WorkspaceCommandRequest,
  WorkspaceCommandResult,
} from "../contracts/workflow";

export type DreamReleaseState = {
  activeVersionId: string;
  candidateVersionId: string | null;
  candidateReady: boolean;
  rollbackTargetVersionId: string | null;
  workspaceRevision: number;
};

type DreamWorkflowResult = MutationResult & {
  release?: DreamReleaseState;
  replay?: WorkspaceCommandResult["replay"];
};

type DreamSliceDeps = {
  getState: () => import("../domain").AppState;
  set: (partial: {
    state?: import("../domain").AppState;
    lastFeedback?: string;
    dreamRelease?: DreamReleaseState | null;
  }) => void;
  repository: AppStateRepository;
  workspaceClient?: WorkspaceClient;
  workspaceCommandClient?: WorkspaceCommandClient;
};

function releaseFrom(result: WorkspaceCommandResult): DreamReleaseState {
  const history = result.workspace.state.playbookHistory;
  const candidate = history.candidateVersionId
    ? history.versions.find((version) => version.id === history.candidateVersionId)
    : null;
  return {
    activeVersionId: history.activeVersionId,
    candidateVersionId: history.candidateVersionId,
    candidateReady: Boolean(candidate?.passingSuiteId),
    rollbackTargetVersionId: history.rollbackTargetVersionId,
    workspaceRevision: result.workspace.revision,
  };
}

export function createDreamActions({
  getState,
  set,
  repository,
  workspaceClient,
  workspaceCommandClient,
}: DreamSliceDeps) {
  const run = (result: MutationResult, successFeedback: string | null) =>
    applyMutation(set, repository, result, successFeedback);
  const runWorkflow = async (
    createCommand: (revision: number) => WorkspaceCommandRequest,
    successFeedback: string,
    signal?: AbortSignal,
  ): Promise<DreamWorkflowResult> => {
    if (!workspaceClient || !workspaceCommandClient) {
      return { ok: false, state: getState(), error: "Dream release server is not configured" };
    }
    const base = getState();
    try {
      const current = await workspaceClient.load(signal);
      const result = await workspaceCommandClient.execute(createCommand(current.revision), signal);
      const projected = projectServerWorkspace(base, result.workspace.state);
      if (!projected.ok) {
        set({ lastFeedback: projected.error });
        return projected;
      }
      repository.save(projected.state);
      const release = releaseFrom(result);
      set({ state: projected.state, dreamRelease: release, lastFeedback: successFeedback });
      return { ok: true, state: projected.state, release, replay: result.replay };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dream release request failed";
      set({ lastFeedback: message });
      return { ok: false, state: getState(), error: message };
    }
  };

  return {
    async refreshDreamWorkspace(signal?: AbortSignal): Promise<DreamWorkflowResult> {
      if (!workspaceClient) {
        return { ok: false, state: getState(), error: "Dream release server is not configured" };
      }
      const base = getState();
      try {
        const workspace = await workspaceClient.load(signal);
        const projected = projectServerWorkspace(base, workspace.state);
        if (!projected.ok) return projected;
        repository.save(projected.state);
        const result = { workspace, replay: null } as WorkspaceCommandResult;
        const release = releaseFrom(result);
        set({ state: projected.state, dreamRelease: release });
        return { ok: true, state: projected.state, release, replay: null };
      } catch (error) {
        return {
          ok: false,
          state: getState(),
          error: error instanceof Error ? error.message : "Dream release request failed",
        };
      }
    },

    createDreamCandidateFromDraft(fileId: PlaybookFileId, content: string, signal?: AbortSignal) {
      return runWorkflow(
        (expectedWorkspaceRevision) => ({
          kind: "create_candidate_from_draft",
          fileId,
          content,
          expectedWorkspaceRevision,
        }),
        "Inactive Dream candidate created. Run affected Eval cases next.",
        signal,
      );
    },

    acceptDreamCorrection(correctionId: CorrectionId, signal?: AbortSignal) {
      return runWorkflow(
        (expectedWorkspaceRevision) => ({
          kind: "create_candidate_from_correction",
          correctionId,
          expectedWorkspaceRevision,
        }),
        "Inactive Dream candidate created from the accepted correction.",
        signal,
      );
    },

    stageDreamFile(file: PlaybookFile, signal?: AbortSignal) {
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
        "Inactive Dream candidate created from the file change.",
        signal,
      );
    },

    stageDreamFileDeletion(fileId: PlaybookFileId, signal?: AbortSignal) {
      return runWorkflow(
        (expectedWorkspaceRevision) => ({
          kind: "create_candidate_from_file_deletion",
          fileId,
          expectedWorkspaceRevision,
        }),
        "Inactive Dream candidate created from the file deletion.",
        signal,
      );
    },

    importDreamMarkdown(
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
        "Markdown imported as an inactive Dream candidate.",
        signal,
      );
    },

    replayDreamCandidate(
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

    activateDreamCandidate(candidateVersionId: string, signal?: AbortSignal) {
      return runWorkflow(
        (expectedWorkspaceRevision) => ({
          kind: "activate_candidate",
          candidateVersionId,
          expectedWorkspaceRevision,
        }),
        "Dream candidate activated. New Chat drafts use this SOP.",
        signal,
      );
    },

    discardDreamCandidate(candidateVersionId: string, signal?: AbortSignal) {
      return runWorkflow(
        (expectedWorkspaceRevision) => ({
          kind: "discard_candidate",
          candidateVersionId,
          expectedWorkspaceRevision,
        }),
        "Inactive Dream candidate discarded. Active SOP remains unchanged.",
        signal,
      );
    },

    rollbackDreamPlaybook(signal?: AbortSignal) {
      return runWorkflow(
        (expectedWorkspaceRevision) => ({
          kind: "rollback_playbook",
          expectedWorkspaceRevision,
        }),
        "Dream restored as a new immutable version.",
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
