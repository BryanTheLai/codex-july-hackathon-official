import {
  domainStateSchema,
  serverDomainStateSchema,
  type ServerDomainStatePayload,
} from "../contracts/app-state";
import { summarizeEvalDataset } from "./eval-metrics";
import { gradeFromJudgeResponse } from "./judge";
import {
  err,
  findDataset,
  ok,
  updateDataset,
} from "./shared";
import { mergeTelegramWorkspaceState } from "./telegram-workspace";
import type {
  AppState,
  EvalDatasetId,
  MutationResult,
} from "./types";

export function projectServerWorkspace(
  state: AppState,
  input: ServerDomainStatePayload,
): MutationResult {
  const server = serverDomainStateSchema.parse(input);
  const telegram = mergeTelegramWorkspaceState(state, server).state;
  const { conversations: _serverConversations, ...serverWithoutConversations } = server;
  const domain = domainStateSchema.parse({
    ...serverWithoutConversations,
    conversations: telegram.conversations,
  });
  const selectedPlaybookFileId = domain.playbookFiles.some(
    (file) => file.id === state.selections.playbookFileId,
  )
    ? state.selections.playbookFileId
    : domain.playbookFiles[0]?.id ?? null;
  return projectEvalWorkspaceArtifacts(
    {
      ...telegram,
      ...domain,
      selections: {
        ...telegram.selections,
        playbookFileId: selectedPlaybookFileId,
      },
    },
    server,
  );
}

export function projectEvalSuiteArtifacts(
  state: AppState,
  input: ServerDomainStatePayload,
  suiteId: string,
  complete: boolean,
): MutationResult {
  const server = serverDomainStateSchema.parse(input);
  const suite = server.evalArtifacts.suites.find(
    (candidate) => candidate.id === suiteId,
  );
  if (!suite) {
    return err(state, "Frozen Eval suite was not found");
  }
  const dataset = findDataset(state, suite.datasetId);
  if (!dataset) {
    return err(state, "Eval dataset was not found");
  }
  if (
    suite.cases.some(
      (evalCase) =>
        !dataset.cases.some(
          (candidate) => candidate.id === evalCase.id,
        ),
    )
  ) {
    return err(state, "Frozen Eval case was not found locally");
  }

  const suiteRuns = server.evalArtifacts.runs.filter(
    (run) => run.suiteId === suite.id,
  );
  const latestRunByCase = new Map(
    suite.cases.map((evalCase) => [
      evalCase.id,
      suiteRuns
        .filter((run) => run.caseId === evalCase.id)
        .sort((left, right) => right.attempt - left.attempt)[0],
    ]),
  );
  if (
    complete &&
    suite.cases.some(
      (evalCase) => !latestRunByCase.get(evalCase.id),
    )
  ) {
    return err(state, "Frozen Eval suite is incomplete");
  }
  const candidateVersion =
    server.playbookHistory.versions.find(
      (version) => version.id === suite.playbookBundle.versionId,
    )?.sequence ?? dataset.candidateVersion;
  const existingRunIds = new Set(
    dataset.runHistory.map((run) => run.id),
  );
  const nextRuns = suiteRuns
    .filter((run) => !existingRunIds.has(run.id))
    .map((run) => {
      const grade = gradeFromJudgeResponse(run.judgeResult);
      return {
        id: run.id,
        caseId: run.caseId,
        datasetId: suite.datasetId,
        ranAt: run.ranAt,
        candidateVersion,
        pass: grade.pass,
        verdict: grade.verdict,
        judgeScore: grade.judgeScore,
      };
    });
  let next = updateDataset(
    state,
    suite.datasetId as EvalDatasetId,
    (current) => ({
      ...current,
      cases: current.cases.map((evalCase) => {
        const run = latestRunByCase.get(evalCase.id);
        return run
          ? {
              ...evalCase,
              actualSyntheticOutput: run.candidateResponse,
              grade: gradeFromJudgeResponse(run.judgeResult),
            }
          : evalCase;
      }),
      runHistory: [...current.runHistory, ...nextRuns],
    }),
  );

  if (
    complete &&
    suite.cases.length === dataset.cases.length &&
    dataset.cases.every((evalCase) =>
      suite.cases.some(
        (candidate) => candidate.id === evalCase.id,
      ),
    ) &&
    !dataset.suiteSnapshots.some(
      (snapshot) => snapshot.id === suite.id,
    )
  ) {
    next = updateDataset(
      next,
      suite.datasetId as EvalDatasetId,
      (current) => {
        const summary = summarizeEvalDataset(current);
        return {
          ...current,
          suiteSnapshots: [
            ...current.suiteSnapshots,
            {
              id: suite.id,
              createdAt: suite.createdAt,
              overallPassPercent: summary.overall.passPercent,
              trainPassPercent: summary.train.passPercent,
              holdoutPassPercent: summary.holdout.passPercent,
              meanJudgeScore: summary.meanJudgeScore ?? 0,
            },
          ],
        };
      },
    );
  }
  return ok(next);
}

export function projectEvalWorkspaceArtifacts(
  state: AppState,
  input: ServerDomainStatePayload,
): MutationResult {
  const server = serverDomainStateSchema.parse(input);
  return [...server.evalArtifacts.suites]
    .sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    )
    .reduce<MutationResult>((result, suite) => {
      if (!result.ok) {
        return result;
      }
      const dataset = findDataset(result.state, suite.datasetId);
      const hasCommittedRuns = server.evalArtifacts.runs.some(
        (run) => run.suiteId === suite.id,
      );
      if (
        !dataset ||
        suite.cases.some(
          (evalCase) =>
            !dataset.cases.some(
              (candidate) => candidate.id === evalCase.id,
            ),
        )
      ) {
        return hasCommittedRuns
          ? err(
              result.state,
              "Committed Eval evidence could not be projected locally",
            )
          : result;
      }
      const complete = suite.cases.every((evalCase) =>
        server.evalArtifacts.runs.some(
          (run) =>
            run.suiteId === suite.id &&
            run.caseId === evalCase.id,
        ),
      );
      return projectEvalSuiteArtifacts(
        result.state,
        server,
        suite.id,
        complete,
      );
    }, ok(state));
}
