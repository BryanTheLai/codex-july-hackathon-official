import { describe, expect, it } from "vitest";

import {
  addCase,
  analyzeFailures,
  createCanonicalSeed,
  generateSyntheticOutput,
  rejectCorrection,
  runEvalCase,
  type AppState,
  type EvalCase,
  type EvalCaseType,
  type EvalSplit,
} from "../../src/domain";
import { createFixtureJudgeClient } from "../fixtures/judge-client";

const SEED_DATASET_ID = "dataset-aircon-ops";

function seedDataset(state: AppState) {
  return state.evalDatasets.find((dataset) => dataset.id === SEED_DATASET_ID)!;
}

function addEvaluationCase(
  state: AppState,
  title: string,
  type: EvalCaseType,
  split: EvalSplit,
): { state: AppState; evalCase: EvalCase } {
  const added = addCase(state, {
    datasetId: SEED_DATASET_ID,
    title,
    split,
    type,
    language: "English",
    inputConversation: {
      messages: [
        {
          id: `message-${title}`,
          role: "patient",
          text: "Please help with this request.",
          sentAt: "2026-07-08T10:00:00+08:00",
        },
      ],
    },
    expectedHumanOutput: "Please come to counter one.",
    criterionIds: [],
  });
  expect(added.ok).toBe(true);
  if (!added.ok) {
    throw new Error(added.error);
  }
  const evalCase = seedDataset(added.state).cases.find((candidate) => candidate.title === title);
  if (!evalCase) {
    throw new Error(`Missing added case: ${title}`);
  }
  return { evalCase, state: added.state };
}

describe("analyze failures", () => {
  it("does not fabricate proposals without committed failed train evidence", () => {
    const state = createCanonicalSeed();
    const before = structuredClone(state);

    const result = analyzeFailures(state, SEED_DATASET_ID);

    expect(result.ok).toBe(true);
    expect(result.state).toEqual(before);
  });

  it("ignores an uncommitted failed grade without a run-history row", async () => {
    const added = addEvaluationCase(
      createCanonicalSeed(),
      "Uncommitted emergency failure",
      "emergency_triage",
      "train",
    );
    const run = await runEvalCase(
      added.state,
      added.evalCase.id,
      createFixtureJudgeClient({ verdictByCase: { [added.evalCase.id]: "fail" } }),
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const state = structuredClone(run.state);
    const dataset = seedDataset(state);
    dataset.runHistory = dataset.runHistory.filter((row) => row.caseId !== added.evalCase.id);
    const beforeCorrections = structuredClone(state.corrections);

    const result = analyzeFailures(state, SEED_DATASET_ID);

    expect(result.ok).toBe(true);
    expect(result.state.corrections).toEqual(beforeCorrections);
  });

  it("creates one pending correction from a committed failed train case without rerunning it", async () => {
    const added = addEvaluationCase(
      createCanonicalSeed(),
      "Committed emergency failure",
      "emergency_triage",
      "train",
    );
    const run = await runEvalCase(
      added.state,
      added.evalCase.id,
      createFixtureJudgeClient({ verdictByCase: { [added.evalCase.id]: "fail" } }),
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const beforeDataset = structuredClone(seedDataset(run.state));
    const beforeCorrections = run.state.corrections.length;
    const beforePlaybooks = structuredClone(run.state.playbookFiles);

    const result = analyzeFailures(run.state, SEED_DATASET_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(seedDataset(result.state)).toEqual(beforeDataset);
    expect(result.state.playbookFiles).toEqual(beforePlaybooks);
    const additions = result.state.corrections.slice(beforeCorrections);
    expect(additions).toHaveLength(1);
    expect(additions[0]).toMatchObject({
      sourceCaseId: added.evalCase.id,
      status: "pending",
    });
  });

  it.each(["booking", "general", "prescription"] as const)(
    "creates a pending correction for a supported committed %s failure",
    async (type) => {
      const added = addEvaluationCase(
        createCanonicalSeed(),
        `Supported ${type} failure`,
        type,
        "train",
      );
      const run = await runEvalCase(
        added.state,
        added.evalCase.id,
        createFixtureJudgeClient({
          verdictByCase: { [added.evalCase.id]: "fail" },
        }),
      );
      expect(run.ok).toBe(true);
      if (!run.ok) return;

      const result = analyzeFailures(run.state, SEED_DATASET_ID);

      expect(result.ok).toBe(true);
      expect(
        result.state.corrections.some(
          (correction) =>
            correction.sourceCaseId === added.evalCase.id && correction.status === "pending",
        ),
      ).toBe(true);
    },
  );

  it("does not analyze a train case whose committed verdict needs review", async () => {
    const added = addEvaluationCase(
      createCanonicalSeed(),
      "Uncertain emergency evidence",
      "emergency_triage",
      "train",
    );
    const run = await runEvalCase(
      added.state,
      added.evalCase.id,
      createFixtureJudgeClient({
        verdictByCase: { [added.evalCase.id]: "needs_review" },
      }),
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const beforeCorrections = run.state.corrections;

    const result = analyzeFailures(run.state, SEED_DATASET_ID);

    expect(result.ok).toBe(true);
    expect(result.state.corrections).toEqual(beforeCorrections);
  });

  it("does not analyze an earlier failure when the latest committed run passed", async () => {
    const added = addEvaluationCase(
      createCanonicalSeed(),
      "Recovered emergency case",
      "emergency_triage",
      "train",
    );
    const failed = await runEvalCase(
      added.state,
      added.evalCase.id,
      createFixtureJudgeClient(),
    );
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    const passed = await runEvalCase(
      failed.state,
      added.evalCase.id,
      createFixtureJudgeClient({
        verdictByCase: { [added.evalCase.id]: "pass" },
      }),
    );
    expect(passed.ok).toBe(true);
    if (!passed.ok) return;
    const beforeCorrections = passed.state.corrections;

    const result = analyzeFailures(passed.state, SEED_DATASET_ID);

    expect(result.ok).toBe(true);
    expect(result.state.corrections).toEqual(beforeCorrections);
  });

  it("never creates a correction from a committed holdout failure", async () => {
    const added = addEvaluationCase(
      createCanonicalSeed(),
      "Committed holdout failure",
      "emergency_triage",
      "holdout",
    );
    const run = await runEvalCase(
      added.state,
      added.evalCase.id,
      createFixtureJudgeClient({ verdictByCase: { [added.evalCase.id]: "fail" } }),
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const beforeCorrections = run.state.corrections;

    const result = analyzeFailures(run.state, SEED_DATASET_ID);

    expect(result.ok).toBe(true);
    expect(result.state.corrections).toEqual(beforeCorrections);
  });

  it.each(["lab_follow_up"] as const)(
    "does not create a correction for unsupported %s failures",
    async (type) => {
      const added = addEvaluationCase(
        createCanonicalSeed(),
        `Unsupported ${type} failure`,
        type,
        "train",
      );
      const run = await runEvalCase(
        added.state,
        added.evalCase.id,
        createFixtureJudgeClient({
          verdictByCase: { [added.evalCase.id]: "fail" },
        }),
      );
      expect(run.ok).toBe(true);
      if (!run.ok) return;
      const beforeCorrections = run.state.corrections;

      const result = analyzeFailures(run.state, SEED_DATASET_ID);

      expect(result.ok).toBe(true);
      expect(result.state.corrections).toEqual(beforeCorrections);
    },
  );

  it("does not recreate a rejected proposal for the same source case", async () => {
    const added = addEvaluationCase(
      createCanonicalSeed(),
      "Rejected emergency proposal",
      "emergency_triage",
      "train",
    );
    const run = await runEvalCase(
      added.state,
      added.evalCase.id,
      createFixtureJudgeClient({ verdictByCase: { [added.evalCase.id]: "fail" } }),
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;

    const first = analyzeFailures(run.state, SEED_DATASET_ID);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const proposal = first.state.corrections.find(
      (correction) => correction.sourceCaseId === added.evalCase.id,
    );
    expect(proposal).toBeDefined();
    if (!proposal) return;

    const rejected = rejectCorrection(first.state, proposal.id);
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    const before = structuredClone(rejected.state.corrections);

    const second = analyzeFailures(rejected.state, SEED_DATASET_ID);

    expect(second.ok).toBe(true);
    expect(second.state.corrections).toEqual(before);
  });

  it("rejects an unknown dataset without changing state", () => {
    const state = createCanonicalSeed();

    const result = analyzeFailures(state, "missing-dataset");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Dataset not found");
    expect(result.state).toEqual(state);
  });

  it("does not change synthetic output when candidateVersion changes", () => {
    const state = createCanonicalSeed();
    const evalCase = seedDataset(state).cases.find(
      (candidate) => candidate.id === "case-aircon-selection-train",
    )!;
    const baseline = generateSyntheticOutput(state, evalCase.id);
    const next = structuredClone(state);
    seedDataset(next).candidateVersion = 2;

    const candidate = generateSyntheticOutput(next, evalCase.id);

    expect(baseline.ok).toBe(true);
    expect(candidate.ok).toBe(true);
    if (!baseline.ok || !candidate.ok) return;
    expect(candidate.output).toBe(baseline.output);
  });
});
