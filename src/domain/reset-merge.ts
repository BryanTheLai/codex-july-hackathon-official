import {
  serverDomainStateSchema,
  type EvalDatasetPayload,
  type ServerDomainStatePayload,
} from "../contracts/app-state";
import {
  LEGACY_SEED_EVAL_CASE_IDS,
  SEED_EVAL_CASE_IDS,
} from "../contracts/constants";
import type { EvalArtifactState } from "../contracts/eval";

function mergeSeedDataset(
  current: EvalDatasetPayload,
  canonical: EvalDatasetPayload,
): EvalDatasetPayload {
  const canonicalCaseIds = new Set(
    canonical.cases.map((evalCase) => evalCase.id),
  );
  const preservedCases = current.cases.filter(
    (evalCase) =>
      evalCase.source.kind !== "seed" &&
      !canonicalCaseIds.has(evalCase.id),
  );
  const preservedCaseIds = new Set(
    preservedCases.map((evalCase) => evalCase.id),
  );
  const canonicalCriterionIds = new Set(
    canonical.criteria.map((criterion) => criterion.id),
  );
  const canonicalRunIds = new Set(canonical.runHistory.map((row) => row.id));

  return {
    ...canonical,
    criteria: [
      ...canonical.criteria,
      ...current.criteria.filter(
        (criterion) => !canonicalCriterionIds.has(criterion.id),
      ),
    ],
    cases: [...canonical.cases, ...preservedCases],
    suiteSnapshots: canonical.suiteSnapshots,
    runHistory: [
      ...canonical.runHistory,
      ...current.runHistory.filter(
        (row) =>
          preservedCaseIds.has(row.caseId) && !canonicalRunIds.has(row.id),
      ),
    ],
  };
}

function removeSyntheticCases(
  dataset: EvalDatasetPayload,
): EvalDatasetPayload {
  const cases = dataset.cases.filter(
    (evalCase) => evalCase.source.kind !== "seed",
  );
  const caseIds = new Set(cases.map((evalCase) => evalCase.id));
  const removedSyntheticCase = cases.length !== dataset.cases.length;
  return {
    ...dataset,
    cases,
    runHistory: dataset.runHistory.filter((row) => caseIds.has(row.caseId)),
    suiteSnapshots: removedSyntheticCase ? [] : dataset.suiteSnapshots,
  };
}

function mergeEvalArtifacts(
  current: EvalArtifactState,
  canonical: EvalArtifactState,
): EvalArtifactState {
  const canonicalSuiteIds = new Set(
    canonical.suites.map((suite) => suite.id),
  );
  const preservedSuites = current.suites.filter(
    (suite) =>
      !canonicalSuiteIds.has(suite.id) &&
      suite.cases.every(
        (evalCase) => evalCase.source.kind !== "seed",
      ),
  );
  const preservedSuiteIds = new Set(
    preservedSuites.map((suite) => suite.id),
  );
  const canonicalRunIds = new Set(canonical.runs.map((run) => run.id));
  const preservedRuns = current.runs.filter(
    (run) =>
      preservedSuiteIds.has(run.suiteId) &&
      !canonicalRunIds.has(run.id),
  );
  const preservedRunIds = new Set(
    preservedRuns.map((run) => run.id),
  );
  const canonicalResolutionRunIds = new Set(
    canonical.resolutions.map((resolution) => resolution.evalRunId),
  );

  return {
    suites: [...canonical.suites, ...preservedSuites],
    runs: [...canonical.runs, ...preservedRuns],
    resolutions: [
      ...canonical.resolutions,
      ...current.resolutions.filter(
        (resolution) =>
          preservedRunIds.has(resolution.evalRunId) &&
          !canonicalResolutionRunIds.has(resolution.evalRunId),
      ),
    ],
  };
}

export function mergeSyntheticReset(
  currentState: ServerDomainStatePayload,
  canonicalState: ServerDomainStatePayload,
): ServerDomainStatePayload {
  const current = serverDomainStateSchema.parse(currentState);
  const canonical = serverDomainStateSchema.parse(canonicalState);
  const telegramConversations = current.conversations.filter(
    (conversation) => conversation.source === "telegram",
  );
  const telegramConversationIds = new Set(
    telegramConversations.map((conversation) => conversation.id),
  );
  const telegramMessageIds = new Set(
    telegramConversations.flatMap((conversation) =>
      conversation.messages.map((message) => message.id),
    ),
  );
  const canonicalDataset = canonical.evalDatasets.find(
    (dataset) => dataset.protected,
  );
  if (!canonicalDataset) {
    throw new Error("Canonical seed dataset is missing");
  }
  const currentDataset =
    current.evalDatasets.find(
      (dataset) => dataset.id === canonicalDataset.id,
    ) ?? canonicalDataset;
  const resetDataset = mergeSeedDataset(currentDataset, canonicalDataset);
  const syntheticCaseIds = new Set<string>([
    ...SEED_EVAL_CASE_IDS,
    ...LEGACY_SEED_EVAL_CASE_IDS,
    ...currentDataset.cases
      .filter((evalCase) => evalCase.source.kind === "seed")
      .map((evalCase) => evalCase.id),
  ]);
  const canonicalCorrectionIds = new Set(
    canonical.corrections.map((correction) => correction.id),
  );
  const canonicalPlaybookIds = new Set(
    canonical.playbookFiles.map((file) => file.id),
  );
  const conversations = [
    ...canonical.conversations.filter(
      (conversation) => !telegramConversationIds.has(conversation.id),
    ),
    ...telegramConversations,
  ];

  return serverDomainStateSchema.parse({
    ...canonical,
    conversations,
    playbookFolders: [
      ...new Set([
        ...canonical.playbookFolders,
        ...current.playbookFolders,
      ]),
    ],
    playbookFiles: [
      ...canonical.playbookFiles,
      ...current.playbookFiles.filter(
        (file) => !canonicalPlaybookIds.has(file.id),
      ),
    ],
    corrections: [
      ...canonical.corrections,
      ...current.corrections.filter(
        (correction) =>
          !canonicalCorrectionIds.has(correction.id) &&
          (!correction.sourceCaseId ||
            !syntheticCaseIds.has(correction.sourceCaseId)),
      ),
    ],
    evalDatasets: [
      resetDataset,
      ...current.evalDatasets.filter(
        (dataset) => dataset.id !== canonicalDataset.id,
      ).map(removeSyntheticCases),
    ],
    speechArtifacts: [
      ...canonical.speechArtifacts,
      ...current.speechArtifacts.filter((artifact) =>
        telegramMessageIds.has(artifact.messageId),
      ),
    ],
    playbookHistory: canonical.playbookHistory,
    evalArtifacts: mergeEvalArtifacts(
      current.evalArtifacts,
      canonical.evalArtifacts,
    ),
  });
}
