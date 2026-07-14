import type { JudgeClient } from "../contracts/judge";
import { isAbortError } from "../shared/errors";
import { summarizeEvalDataset } from "./eval-metrics";
import type {
  AppState,
  Correction,
  EvalCase,
  EvalCaseId,
  EvalCaseType,
  EvalDataset,
  EvalDatasetId,
  EvalGrade,
  EvalVerdict,
  MutationResult,
  RunEvalCaseOptions,
  RunEvalSuiteOptions,
} from "./types";
import {
  cloneState,
  err,
  findCaseInState,
  findDataset,
  nextId,
  ok,
  updateDataset,
} from "./shared";
import { applicableCriteria, playbookIdForCaseType } from "./eval-support";
import { generateSyntheticOutput } from "./eval-generation";
import { buildJudgeRequest, gradeFromJudgeResponse } from "./judge";

function commitCaseRun(
  state: AppState,
  datasetId: EvalDatasetId,
  caseId: EvalCaseId,
  output: string,
  grade: EvalGrade,
  historyId: string,
): AppState {
  return updateDataset(state, datasetId, (dataset) => ({
    ...dataset,
    cases: dataset.cases.map((evalCase) =>
      evalCase.id === caseId
        ? { ...evalCase, actualSyntheticOutput: output, grade }
        : evalCase,
    ),
    runHistory: [
      ...dataset.runHistory,
      {
        id: historyId,
        caseId,
        datasetId,
        ranAt: state.fixtureTime,
        candidateVersion: dataset.candidateVersion,
        pass: grade.pass,
        verdict: grade.verdict,
        judgeScore: grade.judgeScore,
      },
    ],
  }));
}

export async function runEvalCase(
  state: AppState,
  caseId: EvalCaseId,
  judgeClient: JudgeClient,
  options?: RunEvalCaseOptions,
): Promise<MutationResult> {
  if (options?.signal?.aborted) {
    return err(state, "Evaluation canceled");
  }
  const generated = generateSyntheticOutput(state, caseId);
  if (!generated.ok) {
    return err(state, generated.error);
  }
  const located = findCaseInState(state, caseId);
  if (!located) {
    return err(state, "Case not found");
  }
  const historyId = nextId(
    "run",
    state.evalDatasets.flatMap((dataset) => dataset.runHistory.map((row) => row.id)),
  );
  const built = buildJudgeRequest(state, caseId, generated.output, historyId);
  if (!built.ok) {
    return err(state, built.error);
  }

  let grade: EvalGrade;
  try {
    grade = gradeFromJudgeResponse(await judgeClient.judge(built.request, options?.signal));
  } catch (error) {
    if (options?.signal?.aborted || isAbortError(error)) {
      return err(state, "Evaluation canceled");
    }
    return err(
      state,
      error instanceof Error ? error.message : "Evaluation judge failed",
    );
  }
  if (options?.signal?.aborted) {
    return err(state, "Evaluation canceled");
  }

  const next = commitCaseRun(
    state,
    located.dataset.id,
    caseId,
    generated.output,
    grade,
    historyId,
  );
  return ok(next);
}

function suiteSnapshotMetrics(dataset: AppState["evalDatasets"][number]) {
  const summary = summarizeEvalDataset(dataset);
  return {
    overallPassPercent: summary.overall.passPercent,
    trainPassPercent: summary.train.passPercent,
    holdoutPassPercent: summary.holdout.passPercent,
    meanJudgeScore: summary.meanJudgeScore ?? 0,
  };
}

export async function runEvalSuite(
  state: AppState,
  datasetId: EvalDatasetId,
  judgeClient: JudgeClient,
  options?: RunEvalSuiteOptions,
): Promise<MutationResult> {
  const dataset = findDataset(state, datasetId);
  if (!dataset) {
    return err(state, "Dataset not found");
  }

  let next = cloneState(state);
  for (const [index, evalCase] of dataset.cases.entries()) {
    const result = await runEvalCase(next, evalCase.id, judgeClient, options);
    if (!result.ok) {
      return err(state, result.error);
    }
    next = result.state;
    options?.onProgress?.(index + 1, dataset.cases.length);
    if (options?.signal?.aborted) {
      return err(state, "Evaluation canceled");
    }
  }

  const updatedDataset = findDataset(next, datasetId);
  if (!updatedDataset) {
    return err(state, "Dataset not found");
  }
  const metrics = suiteSnapshotMetrics(updatedDataset);
  const snapshotId = nextId("snapshot", updatedDataset.suiteSnapshots.map((item) => item.id));
  next = updateDataset(next, datasetId, (current) => ({
    ...current,
    suiteSnapshots: [
      ...current.suiteSnapshots,
      {
        id: snapshotId,
        createdAt: next.fixtureTime,
        ...metrics,
      },
    ],
  }));
  return ok(next);
}

function supportsFailureAnalysis(type: EvalCaseType): boolean {
  switch (type) {
    case "emergency_triage":
    case "booking":
    case "prescription":
      return true;
    case "general":
    case "lab_follow_up":
      return false;
    default:
      return assertNeverAnalyzedType(type);
  }
}

function assertNeverAnalyzedType(value: never): never {
  throw new Error(`Unhandled failure analysis type: ${String(value)}`);
}

export function committedFailedTrainCases(dataset: EvalDataset): EvalCase[] {
  const latestVerdictByCase = new Map<EvalCaseId, EvalVerdict>();
  for (const row of dataset.runHistory) {
    latestVerdictByCase.set(row.caseId, row.verdict);
  }
  return dataset.cases.filter(
    (evalCase) =>
      evalCase.split === "train" &&
      evalCase.grade?.verdict === "fail" &&
      latestVerdictByCase.get(evalCase.id) === "fail",
  );
}

function proposalForFailure(
  state: AppState,
  evalCase: EvalCase,
  dataset: AppState["evalDatasets"][number],
): Correction | null {
  if (!supportsFailureAnalysis(evalCase.type)) {
    return null;
  }

  const fileId = playbookIdForCaseType(evalCase.type);
  const file = state.playbookFiles.find((item) => item.id === fileId);
  if (!file) {
    return null;
  }

  const firstLine =
    file.savedContent
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#")) ?? file.savedContent;
  const criteria = applicableCriteria(dataset, evalCase);
  const required = criteria.find((item) => item.required);
  return {
    id: `corr-proposal-${evalCase.id}`,
    fileId,
    oldText: firstLine,
    newText: required
      ? `${firstLine} Add guidance for this requirement: ${required.instruction}`
      : `${firstLine} Add staff handoff.`,
    evidence: `${evalCase.title}: ${evalCase.grade?.rationale ?? "Committed train run failed."}`,
    status: "pending",
    sourceCaseId: evalCase.id,
  };
}

function appendUniqueCorrections(state: AppState, proposals: Correction[]): AppState {
  const existingIds = new Set(state.corrections.map((item) => item.id));
  const existingSourceCases = new Set(
    state.corrections
      .filter((item) => item.sourceCaseId)
      .map((item) => item.sourceCaseId as string),
  );
  const additions = proposals.filter(
    (proposal) =>
      !existingIds.has(proposal.id) &&
      proposal.sourceCaseId &&
      !existingSourceCases.has(proposal.sourceCaseId),
  );
  return {
    ...state,
    corrections: [...state.corrections, ...additions],
  };
}

export function analyzeFailures(
  state: AppState,
  datasetId: EvalDatasetId,
): MutationResult {
  const dataset = findDataset(state, datasetId);
  if (!dataset) {
    return err(state, "Dataset not found");
  }
  const proposals = committedFailedTrainCases(dataset)
    .map((evalCase) => proposalForFailure(state, evalCase, dataset))
    .filter((proposal): proposal is Correction => proposal !== null);
  return ok(appendUniqueCorrections(state, proposals));
}
