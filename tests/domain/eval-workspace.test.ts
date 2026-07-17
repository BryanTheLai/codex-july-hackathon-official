import { describe, expect, it } from "vitest";

import type { EvalRunArtifact } from "../../src/contracts/eval";
import {
  createCanonicalSeed,
  createCanonicalServerState,
  freezeEvalSuiteSnapshot,
  mergeTelegramInboundText,
  projectEvalSuiteArtifacts,
  projectServerWorkspace,
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
          criterionId: "crit-aircon-selection",
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
          "crit-aircon-selection": 1,
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
  caseIds = ["case-aircon-selection-train"],
) {
  const local = createCanonicalSeed();
  const server = await createCanonicalServerState();
  const suite = await freezeEvalSuiteSnapshot({
    state: server,
    suiteId: "suite-1",
    datasetId: "dataset-aircon-ops",
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
      artifact(suite.id, "case-aircon-selection-train", 1),
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
        (evalCase) => evalCase.id === "case-aircon-selection-train",
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
      "eval-run-case-aircon-selection-train-1",
    ]);
    expect(result.state.conversations).toEqual(conversations);
    expect(result.state.playbookFiles).toEqual(playbooks);
  });

  it("uses the latest attempt and appends one complete suite snapshot idempotently", async () => {
    const caseIds = [
      "case-aircon-selection-train",
      "case-aircon-confirm-train",
      "case-aircon-rate-card-train",
      "case-aircon-rate-card-holdout",
      "case-aircon-selection-holdout",
    ];
    const { local, server, suite } = await fixture(caseIds);
    server.evalArtifacts.runs.push(
      artifact(suite.id, "case-aircon-selection-train", 1),
      artifact(suite.id, "case-aircon-selection-train", 2),
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

    expect(
      first.state.evalDatasets[0]!.cases.find(
        (evalCase) => evalCase.id === "case-aircon-selection-train",
      ),
    ).toMatchObject({
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
      artifact(suite.id, "case-aircon-selection-train", 1),
    );

    const result = projectEvalWorkspaceArtifacts(local, server);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.evalDatasets[0]!.runHistory).toHaveLength(1);
    expect(
      result.state.evalDatasets[0]!.suiteSnapshots,
    ).toHaveLength(0);
  });

  it("projects a live Telegram conversation without hiding refreshed Knowledge corrections", async () => {
    const local = createCanonicalSeed();
    const inbound = mergeTelegramInboundText(
      await createCanonicalServerState(),
      {
        channel: "telegram",
        externalEventId: "telegram-update-1",
        externalConversationId: "telegram-chat-1",
        externalMessageId: "telegram-message-1",
        sender: {
          externalId: "telegram-user-1",
          displayName: "Telegram smoke tester",
        },
        message: {
          kind: "text",
          text: "Live Telegram test",
          language: "en",
        },
        receivedAt: "2026-07-16T00:00:00.000Z",
      },
    );
    expect(inbound.ok).toBe(true);
    if (!inbound.ok) return;
    inbound.state.corrections.push({
      id: "corr-live-model",
      fileId: "file-aircon-service-selection",
      oldText: "Seek urgent care for aircon service.",
      newText: "For aircon service, call Malaysia's emergency number, 999.",
      evidence: "Live configured-model smoke",
      status: "pending",
      sourceCaseId: "case-aircon-selection-train",
    });

    const result = projectServerWorkspace(local, inbound.state);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.state.conversations.find(
        (conversation) => conversation.id === "telegram-conversation:telegram-chat-1",
      ),
    ).toMatchObject({
      channel: "Telegram",
      agentMode: "synthetic_agent",
      patient: { phone: "", medicalRecordNumber: "" },
    });
    expect(result.state.corrections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "corr-live-model",
          newText: "For aircon service, call Malaysia's emergency number, 999.",
        }),
      ]),
    );
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
