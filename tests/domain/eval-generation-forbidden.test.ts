import { describe, expect, it } from "vitest";

import { buildGenerationInput, createCanonicalSeed, type EvalGrade } from "../../src/domain";

const SEED_DATASET_ID = "dataset-aircon-ops";

function trainCaseId() {
  const seed = createCanonicalSeed();
  const dataset = seed.evalDatasets.find((d) => d.id === SEED_DATASET_ID)!;
  return dataset.cases.find((c) => c.split === "train")!.id;
}

describe("buildGenerationInput forbidden leaks", () => {
  it.each([
    ["expectedHumanOutput", { expectedHumanOutput: "leak" }],
    ["actualSyntheticOutput", { actualSyntheticOutput: "leak" }],
    [
      "grade",
      {
        grade: {
          pass: false,
          verdict: "fail",
          judgeScore: 0,
          rationale: "leak",
          criterionResults: [],
          metadata: {
            provider: "fixture",
            model: "fixture",
            promptVersion: "fixture",
            rubricVersions: {},
            runId: "run-fixture",
            latencyMs: 0,
            simulated: true,
          },
        } satisfies EvalGrade,
      },
    ],
    ["rationale", { rationale: "leak" }],
  ] as const)("rejects forbidden field %s", (fieldName, forbidden) => {
    const seed = createCanonicalSeed();
    const result = buildGenerationInput(seed, trainCaseId(), forbidden);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(new RegExp(`forbidden|${fieldName}`, "i"));
  });
});
