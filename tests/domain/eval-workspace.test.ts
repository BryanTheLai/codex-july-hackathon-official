import { describe, expect, it } from "vitest";

import type { EvalRunArtifact } from "../../src/contracts/eval";
import {
  createCanonicalSeed,
  createCanonicalServerState,
  freezeEvalSuiteSnapshot,
  projectEvalSuiteArtifacts,
  projectEvalWorkspaceArtifacts,
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

function artifact(
  suiteId: string,
  caseId: string,
  attempt: number,
): EvalRunArtifact {
  return {
    id: `eval-run-${caseId}-${attempt}`,
    suiteId,
    caseId,
    attempt,
    candidateResponse: `Candidate ${attempt}`,
    agentResult: {
      runId: `agent-run-${caseId}-${attempt}`,
      draft: {
        englishText: `Candidate ${attempt}`,
        patientLanguage: "English",
        patientText: `Candidate ${attempt}`,
      },
      proposedAction: "reply",
      handoffReason: null,
      evidence: [],
      toolCalls: [],
      stopReason: "completed",
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
      latencyMs: 10,
    },
    judgeResult: {
      overallVerdict: attempt === 1 ? "fail" : "pass",
      judgeScore: attempt === 1 ? 0.25 : 1,
      rationale: `Attempt ${attempt}`,
      criterionResults: [
        {
          criterionId: "crit-emergency",
          verdict: attempt === 1 ? "fail" : "pass",
          reason: `Attempt ${attempt}`,
          evidence: `Candidate ${attempt}`,
        },
      ],
      metadata: {
        provider: "test",
        model: judgeConfig.modelId,
        promptVersion: judgeConfig.promptVersion,
        rubricVersions: {
          "crit-emergency": 1,
        },
        runId: `eval-run-${caseId}-${attempt}`,
        latencyMs: 10,
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        simulated: true,
      },
    },
    ranAt: `2026-07-13T12:0${attempt}:00.000Z`,
  };
}

async function fixture(
  caseIds = ["case-emergency-train"],
) {
  const local = createCanonicalSeed();
  const server = await createCanonicalServerState();
  const suite = await freezeEvalSuiteSnapshot({
    state: server,
    suiteId: "suite-1",
    datasetId: "dataset-seed",
    caseIds,
    playbookVersionId: server.playbookHistory.activeVersionId,
    agentConfig,
    judgeConfig,
    baselineSuiteId: null,
    createdAt: server.fixtureTime,
  });
  server.evalArtifacts.suites.push(suite);
  return { local, server, suite };
}

describe("Eval workspace projection", () => {
  it("projects immutable server attempts onto the legacy Eval view only", async () => {
    const { local, server, suite } = await fixture();
    const conversations = structuredClone(local.conversations);
    const playbooks = structuredClone(local.playbookFiles);
    server.evalArtifacts.runs.push(
      artifact(suite.id, "case-emergency-train", 1),
    );

    const result = projectEvalSuiteArtifacts(
      local,
      server,
      suite.id,
      false,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dataset = result.state.evalDatasets[0]!;
    expect(
      dataset.cases.find(
        (evalCase) => evalCase.id === "case-emergency-train",
      ),
    ).toMatchObject({
      actualSyntheticOutput: "Candidate 1",
      grade: {
        pass: false,
        verdict: "fail",
        judgeScore: 0.25,
      },
    });
    expect(dataset.runHistory.map((run) => run.id)).toEqual([
      "eval-run-case-emergency-train-1",
    ]);
    expect(result.state.conversations).toEqual(conversations);
    expect(result.state.playbookFiles).toEqual(playbooks);
  });

  it("uses the latest attempt and appends one complete suite snapshot idempotently", async () => {
    const caseIds = [
      "case-emergency-train",
      "case-booking-train",
      "case-prescription-train",
      "case-hours-holdout",
      "case-lab-holdout",
    ];
    const { local, server, suite } = await fixture(caseIds);
    server.evalArtifacts.runs.push(
      artifact(suite.id, "case-emergency-train", 1),
      artifact(suite.id, "case-emergency-train", 2),
      ...caseIds
        .slice(1)
        .map((caseId) => artifact(suite.id, caseId, 1)),
    );

    const first = projectEvalSuiteArtifacts(
      local,
      server,
      suite.id,
      true,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = projectEvalSuiteArtifacts(
      first.state,
      server,
      suite.id,
      true,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(first.state.evalDatasets[0]!.cases[0]).toMatchObject({
      actualSyntheticOutput: "Candidate 2",
      grade: {
        pass: true,
        verdict: "pass",
      },
    });
    expect(
      second.state.evalDatasets[0]!.runHistory.map((run) => run.id),
    ).toHaveLength(6);
    expect(second.state.evalDatasets[0]!.suiteSnapshots).toHaveLength(
      1,
    );
    expect(second.state.evalDatasets[0]!.suiteSnapshots[0]?.id).toBe(
      suite.id,
    );
  });

  it("rejects missing frozen suites without changing local state", async () => {
    const { local, server } = await fixture();
    const before = structuredClone(local);

    const result = projectEvalSuiteArtifacts(
      local,
      server,
      "missing-suite",
      false,
    );

    expect(result).toEqual({
      ok: false,
      error: "Frozen Eval suite was not found",
      state: local,
    });
    expect(local).toEqual(before);
  });

  it("rehydrates server attempts and completed suite snapshots", async () => {
    const { local, server, suite } = await fixture();
    server.evalArtifacts.runs.push(
      artifact(suite.id, "case-emergency-train", 1),
    );

    const result = projectEvalWorkspaceArtifacts(local, server);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.evalDatasets[0]!.runHistory).toHaveLength(1);
    expect(
      result.state.evalDatasets[0]!.suiteSnapshots,
    ).toHaveLength(0);
  });

  it("rejects committed server evidence that cannot project locally", async () => {
    const { local, server, suite } = await fixture();
    const missingCaseId = suite.cases[0]!.id;
    local.evalDatasets[0]!.cases = local.evalDatasets[0]!.cases.filter(
      (evalCase) => evalCase.id !== missingCaseId,
    );
    server.evalArtifacts.runs.push(artifact(suite.id, missingCaseId, 1));

    const result = projectEvalWorkspaceArtifacts(local, server);

    expect(result).toEqual({
      ok: false,
      error: "Committed Eval evidence could not be projected locally",
      state: local,
    });
  });
});
