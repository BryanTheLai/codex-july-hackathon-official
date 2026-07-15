import { describe, expect, it } from "vitest";

import { summarizeEvalDataset, type EvalDataset, type EvalGrade } from "../../src/domain";

function passingGrade(score: number): EvalGrade {
  return {
    pass: true,
    verdict: "pass",
    judgeScore: score,
    rationale: "Meets the rubric.",
    criterionResults: [],
    metadata: {
      provider: "fixture",
      model: "fixture",
      promptVersion: "1",
      rubricVersions: {},
      runId: "run-1",
      latencyMs: 0,
      simulated: true,
    },
  };
}

describe("evaluation metrics", () => {
  it("uses one summary for suite history and route metrics", () => {
    const dataset: EvalDataset = {
      id: "dataset-metrics",
      name: "Metrics",
      protected: false,
      candidateVersion: 1,
      criteria: [],
      cases: [
        {
          id: "case-train",
          title: "Train",
          split: "train",
          type: "general",
          language: "English",
          inputConversation: { messages: [] },
          expectedHumanOutput: "Expected",
          criterionIds: [],
          source: { kind: "manual" },
          grade: passingGrade(0.83),
        },
        {
          id: "case-holdout",
          title: "Holdout",
          split: "holdout",
          type: "general",
          language: "English",
          inputConversation: { messages: [] },
          expectedHumanOutput: "Expected",
          criterionIds: [],
          source: { kind: "manual" },
        },
      ],
      suiteSnapshots: [],
      runHistory: [],
    };

    expect(summarizeEvalDataset(dataset)).toEqual({
      overall: { passed: 1, total: 2, passPercent: 50 },
      train: { passed: 1, total: 1, passPercent: 100 },
      holdout: { passed: 0, total: 1, passPercent: 0 },
      meanJudgeScore: 0.83,
    });
  });
});
