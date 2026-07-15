import { describe, expect, it } from "vitest";

import { evalSuiteSnapshotSchema } from "../../src/contracts/eval";
import {
  createCanonicalServerState,
  freezeEvalSuiteSnapshot,
} from "../../src/domain";

const agentConfig = {
  modelId: "agent-model",
  apiMode: "responses" as const,
  agentConfigVersion: "agent-config-v1",
  promptVersion: "agent-prompt-v1",
  toolPolicyVersion: "demo-no-tools-v1" as const,
};

const judgeConfig = {
  modelId: "judge-model",
  promptVersion: "judge-prompt-v1",
};

describe("frozen Eval suite state", () => {
  it("freezes the five seed cases without leaking judge-only fields", async () => {
    const state = await createCanonicalServerState();
    const caseIds = state.evalDatasets[0]!.cases.map(
      (evalCase) => evalCase.id,
    );

    const suite = await freezeEvalSuiteSnapshot({
      state,
      suiteId: "suite-seed-v1",
      datasetId: "dataset-seed",
      caseIds,
      playbookVersionId: state.playbookHistory.activeVersionId,
      agentConfig,
      judgeConfig,
      baselineSuiteId: null,
      createdAt: state.fixtureTime,
    });

    expect(evalSuiteSnapshotSchema.parse(suite)).toEqual(suite);
    expect(suite.cases).toHaveLength(5);
    expect(suite.cases.map((evalCase) => evalCase.id)).toEqual(
      [...caseIds].sort(),
    );
    expect(
      suite.cases.every(
        (evalCase) =>
          evalCase.generationCase.playbookVersions.length ===
          state.playbookHistory.versions[0]!.files.length,
      ),
    ).toBe(true);
    for (const evalCase of suite.cases) {
      expect(evalCase.generationCase).not.toHaveProperty(
        "expectedStaffResponse",
      );
      expect(evalCase.generationCase).not.toHaveProperty("rubricRefs");
      expect(evalCase.judgeBundle.expectedStaffResponse).toBeTruthy();
      expect(evalCase.judgeBundle.rubricRefs.length).toBeGreaterThan(0);
    }
  });

  it("creates one stable manifest for the same frozen inputs", async () => {
    const state = await createCanonicalServerState();
    const caseIds = state.evalDatasets[0]!.cases.map(
      (evalCase) => evalCase.id,
    );
    const base = {
      state,
      datasetId: "dataset-seed",
      playbookVersionId: state.playbookHistory.activeVersionId,
      agentConfig,
      judgeConfig,
      baselineSuiteId: null,
    };

    const first = await freezeEvalSuiteSnapshot({
      ...base,
      suiteId: "suite-first",
      caseIds,
      createdAt: "2026-07-13T12:00:00.000Z",
    });
    const second = await freezeEvalSuiteSnapshot({
      ...base,
      suiteId: "suite-second",
      caseIds: [...caseIds].reverse(),
      createdAt: "2026-07-13T12:01:00.000Z",
    });
    const third = await freezeEvalSuiteSnapshot({
      ...base,
      suiteId: "suite-third",
      caseIds,
      agentConfig: {
        toolPolicyVersion: agentConfig.toolPolicyVersion,
        promptVersion: agentConfig.promptVersion,
        agentConfigVersion: agentConfig.agentConfigVersion,
        apiMode: agentConfig.apiMode,
        modelId: agentConfig.modelId,
      },
      judgeConfig: {
        promptVersion: judgeConfig.promptVersion,
        modelId: judgeConfig.modelId,
      },
      createdAt: "2026-07-13T12:02:00.000Z",
    });

    expect(first.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.manifestHash).toBe(first.manifestHash);
    expect(third.manifestHash).toBe(first.manifestHash);
  });

  it("rejects unknown cases, playbooks, and incomplete rubric references", async () => {
    const state = await createCanonicalServerState();
    const input = {
      state,
      suiteId: "suite-invalid",
      datasetId: "dataset-seed",
      caseIds: ["missing-case"],
      playbookVersionId: state.playbookHistory.activeVersionId,
      agentConfig,
      judgeConfig,
      baselineSuiteId: null,
      createdAt: state.fixtureTime,
    };

    await expect(freezeEvalSuiteSnapshot(input)).rejects.toThrow(
      "Eval case was not found",
    );
    await expect(
      freezeEvalSuiteSnapshot({
        ...input,
        caseIds: [state.evalDatasets[0]!.cases[0]!.id],
        playbookVersionId: "missing-playbook",
      }),
    ).rejects.toThrow("Playbook version was not found");

    const invalidState = structuredClone(state);
    invalidState.evalDatasets[0]!.criteria = [];
    await expect(
      freezeEvalSuiteSnapshot({
        ...input,
        state: invalidState,
        caseIds: [invalidState.evalDatasets[0]!.cases[0]!.id],
      }),
    ).rejects.toThrow("Eval case criterion must reference this dataset");
  });
});
