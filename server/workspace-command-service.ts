import type { ApiErrorCode, WorkspaceEnvelope } from "../src/contracts/api";
import {
  workspaceCommandRequestSchema,
  workspaceCommandResultSchema,
  type WorkspaceCommandRequest,
  type WorkspaceCommandResult,
} from "../src/contracts/workflow";
import {
  PlaybookReleaseError,
  activatePlaybookCandidate,
  createCandidateFromCorrection,
  createCandidateFromDraft,
  createCandidateFromFile,
  createCandidateFromFileDeletion,
  createCandidateFromMarkdownImport,
  discardPlaybookCandidate,
  markCandidateReady,
  rollbackPlaybook,
} from "../src/domain";
import type { ServerDomainStatePayload } from "../src/contracts/app-state";
import type { EvalService } from "./eval-service";
import type { CorrectionProposer } from "./correction-proposer";
import type { WorkspaceRepository } from "./workspace-repository";

type WorkspaceCommandServiceOptions = {
  workspaceId: string;
  repository: WorkspaceRepository;
  evalService: EvalService;
  proposer?: CorrectionProposer | null;
  createId: () => string;
  now: () => string;
};

export class WorkspaceCommandServiceError extends Error {
  constructor(
    readonly code: Extract<
      ApiErrorCode,
      | "feature_disabled"
      | "invalid_request"
      | "not_found"
      | "revision_conflict"
      | "release_blocked"
    >,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "WorkspaceCommandServiceError";
  }
}

function fail(
  code: WorkspaceCommandServiceError["code"],
  message: string,
  retryable: boolean,
): never {
  throw new WorkspaceCommandServiceError(code, message, retryable);
}

function latestRunsPass(
  state: ServerDomainStatePayload,
  suiteId: string,
): boolean {
  const suite = state.evalArtifacts.suites.find((candidate) => candidate.id === suiteId);
  if (!suite) return false;
  return suite.cases.every((evalCase) => {
    const latest = state.evalArtifacts.runs
      .filter((run) => run.suiteId === suite.id && run.caseId === evalCase.id)
      .sort((left, right) => right.attempt - left.attempt)[0];
    return latest?.judgeResult.overallVerdict === "pass";
  });
}

function latestRunVerdict(
  state: ServerDomainStatePayload,
  suiteId: string,
  caseId: string,
): "pass" | "fail" | "needs_review" | undefined {
  return state.evalArtifacts.runs
    .filter((run) => run.suiteId === suiteId && run.caseId === caseId)
    .sort((left, right) => right.attempt - left.attempt)[0]?.judgeResult.overallVerdict;
}

function activeFailuresForCases(
  state: ServerDomainStatePayload,
  caseIds: string[],
): number {
  const activeVersionId = state.playbookHistory.activeVersionId;
  const activeSuiteIds = new Set(
    state.evalArtifacts.suites
      .filter((suite) => suite.playbookBundle.versionId === activeVersionId)
      .map((suite) => suite.id),
  );
  return caseIds.filter((caseId) => {
    const latest = state.evalArtifacts.runs
      .filter((run) => activeSuiteIds.has(run.suiteId) && run.caseId === caseId)
      .sort((left, right) => right.ranAt.localeCompare(left.ranAt) || right.attempt - left.attempt)[0];
    return latest?.judgeResult.overallVerdict === "fail";
  }).length;
}

function passedCasesForSuite(
  state: ServerDomainStatePayload,
  suiteId: string,
): number {
  const suite = state.evalArtifacts.suites.find((candidate) => candidate.id === suiteId);
  if (!suite) return 0;
  return suite.cases.filter(
    (evalCase) => latestRunVerdict(state, suite.id, evalCase.id) === "pass",
  ).length;
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function affectedCaseIds(
  state: ServerDomainStatePayload,
  datasetId: string,
): string[] {
  const dataset = state.evalDatasets.find((candidate) => candidate.id === datasetId);
  if (!dataset) fail("not_found", "Eval dataset was not found", false);
  const correctionCaseIds = new Set(
    state.corrections
      .filter((correction) => correction.status === "approved" && correction.sourceCaseId)
      .map((correction) => correction.sourceCaseId!),
  );
  const affected = dataset.cases
    .filter((evalCase) => evalCase.split === "train" && correctionCaseIds.has(evalCase.id))
    .map((evalCase) => evalCase.id)
    .sort();
  return affected.length > 0
    ? affected
    : dataset.cases
        .filter((evalCase) => evalCase.split === "train")
        .map((evalCase) => evalCase.id)
        .sort();
}

function priorAffectedSuite(
  state: ServerDomainStatePayload,
  candidateVersionId: string,
  caseIds: string[],
): string | null {
  return (
    [...state.evalArtifacts.suites]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .find(
        (suite) =>
          suite.playbookBundle.versionId === candidateVersionId &&
          sameIds(
            suite.cases.map((evalCase) => evalCase.id).sort(),
            caseIds,
          ) &&
          latestRunsPass(state, suite.id),
      )?.id ?? null
  );
}

function latestFailedTrainRun(
  state: ServerDomainStatePayload,
  datasetId: string,
) {
  const activeVersionId = state.playbookHistory.activeVersionId;
  const suites = new Map(state.evalArtifacts.suites.map((suite) => [suite.id, suite]));
  return [...state.evalArtifacts.runs]
    .sort((left, right) => right.ranAt.localeCompare(left.ranAt) || right.attempt - left.attempt)
    .find((run) => {
      const suite = suites.get(run.suiteId);
      const evalCase = suite?.cases.find((candidate) => candidate.id === run.caseId);
      return (
        suite?.datasetId === datasetId &&
        suite.playbookBundle.versionId === activeVersionId &&
        evalCase?.split === "train" &&
        run.judgeResult.overallVerdict === "fail"
      );
    });
}

export function createWorkspaceCommandService({
  workspaceId,
  repository,
  evalService,
  proposer = null,
  createId,
  now,
}: WorkspaceCommandServiceOptions) {
  async function loadAtRevision(expectedRevision: number): Promise<WorkspaceEnvelope> {
    const workspace = await repository.load(workspaceId);
    if (!workspace) fail("not_found", "Workspace was not found", false);
    if (workspace.revision !== expectedRevision) {
      fail("revision_conflict", "Workspace revision is stale", true);
    }
    return workspace;
  }

  async function save(
    state: ServerDomainStatePayload,
    expectedRevision: number,
  ): Promise<WorkspaceEnvelope> {
    const result = await repository.save(workspaceId, expectedRevision, state);
    if (!result.ok) fail("revision_conflict", "Workspace changed while the command was running", true);
    return result.workspace;
  }

  async function executeReplay(
    command: Extract<WorkspaceCommandRequest, { kind: "replay_candidate" }>,
    signal?: AbortSignal,
  ): Promise<WorkspaceCommandResult> {
    const initial = await loadAtRevision(command.expectedWorkspaceRevision);
    if (initial.state.playbookHistory.candidateVersionId !== command.candidateVersionId) {
      fail("release_blocked", "Dream candidate is no longer current", false);
    }
    const dataset = initial.state.evalDatasets.find((candidate) => candidate.id === command.datasetId);
    if (!dataset) fail("not_found", "Eval dataset was not found", false);
    const affected = affectedCaseIds(initial.state, dataset.id);
    const caseIds =
      command.scope === "affected"
        ? affected
        : dataset.cases.map((evalCase) => evalCase.id).sort();
    if (caseIds.length === 0) {
      fail("release_blocked", "Eval replay requires at least one case", false);
    }
    const beforeFailedCases = activeFailuresForCases(initial.state, caseIds);
    const baselineSuiteId =
      command.scope === "full"
        ? priorAffectedSuite(initial.state, command.candidateVersionId, affected)
        : null;
    if (command.scope === "full" && !baselineSuiteId) {
      fail("release_blocked", "Run and pass affected train cases before the full Eval replay", false);
    }

    const frozen = await evalService.createSuite(
      {
        datasetId: dataset.id,
        caseIds,
        playbookVersionId: command.candidateVersionId,
        expectedWorkspaceRevision: initial.revision,
      },
      { baselineSuiteId },
    );
    let revision = frozen.workspaceRevision;
    for (const caseId of caseIds) {
      signal?.throwIfAborted();
      const run = await evalService.runCase(
        {
          suiteId: frozen.suiteId,
          caseId,
          expectedWorkspaceRevision: revision,
        },
        signal,
      );
      revision = run.workspaceRevision;
    }

    let workspace = await loadAtRevision(revision);
    const passed = latestRunsPass(workspace.state, frozen.suiteId);
    const passedCases = passedCasesForSuite(workspace.state, frozen.suiteId);
    let ready = false;
    if (command.scope === "full" && passed) {
      const next = markCandidateReady({
        state: workspace.state,
        candidateVersionId: command.candidateVersionId,
        suiteId: frozen.suiteId,
      });
      workspace = await save(next, workspace.revision);
      ready = true;
    }
    return workspaceCommandResultSchema.parse({
      workspace,
      replay: {
        suiteId: frozen.suiteId,
        scope: command.scope,
        beforeFailedCases,
        passedCases,
        totalCases: caseIds.length,
        passed,
        ready,
      },
    });
  }

  return {
    async execute(
      input: WorkspaceCommandRequest,
      signal?: AbortSignal,
    ): Promise<WorkspaceCommandResult> {
      const command = workspaceCommandRequestSchema.parse(input);
      try {
        if (command.kind === "replay_candidate") {
          return executeReplay(command, signal);
        }
        const workspace = await loadAtRevision(command.expectedWorkspaceRevision);
        let next: ServerDomainStatePayload;
        if (command.kind === "create_candidate_from_correction") {
          next = await createCandidateFromCorrection({
            state: workspace.state,
            candidateVersionId: createId(),
            correctionId: command.correctionId,
            createdAt: now(),
          });
        } else if (command.kind === "create_candidate_from_draft") {
          next = await createCandidateFromDraft({
            state: workspace.state,
            candidateVersionId: createId(),
            fileId: command.fileId,
            content: command.content,
            createdAt: now(),
          });
        } else if (command.kind === "create_candidate_from_file") {
          next = await createCandidateFromFile({
            state: workspace.state,
            candidateVersionId: createId(),
            file: command.file,
            createdAt: now(),
          });
        } else if (command.kind === "create_candidate_from_file_deletion") {
          next = await createCandidateFromFileDeletion({
            state: workspace.state,
            candidateVersionId: createId(),
            fileId: command.fileId,
            createdAt: now(),
          });
        } else if (command.kind === "import_markdown") {
          next = await createCandidateFromMarkdownImport({
            state: workspace.state,
            candidateVersionId: createId(),
            fileId: `file-${createId()}`,
            path: command.path,
            title: command.title,
            content: command.content,
            createdAt: now(),
          });
        } else if (command.kind === "sync_eval_dataset") {
          if (!workspace.state.evalDatasets.some((dataset) => dataset.id === command.dataset.id)) {
            fail("not_found", "Eval dataset was not found", false);
          }
          next = structuredClone(workspace.state);
          next.evalDatasets = next.evalDatasets.map((dataset) =>
            dataset.id === command.dataset.id ? command.dataset : dataset,
          );
        } else if (command.kind === "propose_correction") {
          if (!proposer) {
            fail("feature_disabled", "LLM SOP proposer is not configured", false);
          }
          if (workspace.state.playbookHistory.candidateVersionId) {
            fail("release_blocked", "Finish or discard the current Dream candidate first", false);
          }
          const failedRun = latestFailedTrainRun(workspace.state, command.datasetId);
          if (!failedRun) {
            fail("release_blocked", "Run a failed train Eval case against the active Dream bundle first", false);
          }
          const active = workspace.state.playbookHistory.versions.find(
            (candidate) => candidate.id === workspace.state.playbookHistory.activeVersionId,
          )!;
          const proposal = await proposer.propose(
            {
              files: active.files.map((file) => ({
                id: file.id,
                path: file.path,
                content: file.content,
              })),
              failure: {
                caseId: failedRun.caseId,
                candidateResponse: "A staff draft failed the listed criteria.",
                criteria: failedRun.judgeResult.criterionResults
                  .filter((criterion) => criterion.verdict !== "pass")
                  .map((criterion) => ({
                    id: criterion.criterionId,
                    reason: criterion.reason,
                    evidence: null,
                  })),
              },
            },
            signal,
          );
          const file = active.files.find((candidate) => candidate.id === proposal.fileId);
          if (!file) {
            fail("release_blocked", "LLM proposal selected a file outside the active Dream bundle", false);
          }
          const occurrences = file.content.split(proposal.oldText).length - 1;
          if (occurrences !== 1 || proposal.oldText === proposal.newText) {
            fail("release_blocked", "LLM proposal must make one exact safe Dream replacement", false);
          }
          if (
            workspace.state.corrections.some(
              (correction) =>
                correction.status === "pending" &&
                correction.fileId === proposal.fileId &&
                correction.oldText === proposal.oldText &&
                correction.newText === proposal.newText,
            )
          ) {
            fail("release_blocked", "An identical Dream proposal is already awaiting review", false);
          }
          next = structuredClone(workspace.state);
          next.corrections.push({
            id: `corr-${createId()}`,
            fileId: proposal.fileId,
            oldText: proposal.oldText,
            newText: proposal.newText,
            evidence: proposal.rationale,
            status: "pending",
            sourceCaseId: failedRun.caseId,
          });
        } else if (command.kind === "activate_candidate") {
          next = activatePlaybookCandidate({
            state: workspace.state,
            candidateVersionId: command.candidateVersionId,
            activatedAt: now(),
          });
        } else if (command.kind === "discard_candidate") {
          next = discardPlaybookCandidate({
            state: workspace.state,
            candidateVersionId: command.candidateVersionId,
            discardedAt: now(),
          });
        } else {
          next = await rollbackPlaybook({
            state: workspace.state,
            restoreVersionId: createId(),
            createdAt: now(),
          });
        }
        return workspaceCommandResultSchema.parse({
          workspace: await save(next, workspace.revision),
          replay: null,
        });
      } catch (error) {
        if (error instanceof PlaybookReleaseError) {
          const code =
            error.code === "invalid_input"
              ? "invalid_request"
              : error.code;
          throw new WorkspaceCommandServiceError(code, error.message, false);
        }
        throw error;
      }
    },
  };
}

export type WorkspaceCommandService = ReturnType<typeof createWorkspaceCommandService>;
