import { describe, expect, it } from "vitest";

import {
  serverDomainStateSchema,
  type ServerDomainStatePayload,
} from "../../src/contracts/app-state";
import {
  createCanonicalServerState,
  freezeEvalSuiteSnapshot,
  mergeSyntheticReset,
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

function historyRow(
  id: string,
  caseId: string,
  datasetId = "dataset-aircon-ops",
) {
  return {
    id,
    caseId,
    datasetId,
    ranAt: "2026-07-13T17:00:00.000Z",
    candidateVersion: 1,
    pass: true,
    verdict: "pass" as const,
    judgeScore: 1,
  };
}

function evalRun(
  id: string,
  suite: Awaited<ReturnType<typeof freezeEvalSuiteSnapshot>>,
) {
  const evalCase = suite.cases[0]!;
  const playbook = suite.playbookBundle.versions[0]!;
  const rubric = evalCase.judgeBundle.rubricRefs[0]!;
  return {
    id,
    suiteId: suite.id,
    caseId: evalCase.id,
    attempt: 1,
    candidateResponse: "Staff review is required.",
    agentResult: {
      runId: `agent-${id}`,
      draft: {
        englishText: "Staff review is required.",
        patientLanguage: evalCase.language,
        patientText: "Staff review is required.",
      },
      proposedAction: "reply" as const,
      handoffReason: null,
      evidence: [
        {
          ...playbook,
          excerpt: "staff",
        },
      ],
      toolCalls: [] as [],
      stopReason: "completed" as const,
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
      latencyMs: 10,
    },
    judgeResult: {
      overallVerdict: "needs_review" as const,
      judgeScore: 0.5,
      rationale: "Human review is required.",
      criterionResults: [
        {
          criterionId: rubric.id,
          verdict: "uncertain" as const,
          reason: "The evidence is incomplete.",
          evidence: null,
        },
      ],
      metadata: {
        provider: "openai",
        model: judgeConfig.modelId,
        promptVersion: judgeConfig.promptVersion,
        rubricVersions: {
          [rubric.id]: rubric.version,
        },
        runId: `judge-${id}`,
        latencyMs: 10,
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        simulated: false,
      },
    },
    ranAt: "2026-07-13T12:01:00.000Z",
  };
}

async function dirtyServerState(): Promise<ServerDomainStatePayload> {
  const current = await createCanonicalServerState();
  const dataset = current.evalDatasets[0]!;
  const seedCase = dataset.cases[0]!;
  const telegramConversation = {
    ...structuredClone(current.conversations[0]!),
    id: "conversation-telegram",
    revision: 4,
    channel: "telegram" as const,
    agentMode: "live_agent" as const,
    source: "telegram" as const,
    externalConversationId: "telegram-chat-42",
    latestAgentArtifactId: "agent-run-42",
    patient: {
      ...structuredClone(current.conversations[0]!.patient),
      phone: null,
      medicalRecordNumber: null,
      externalContactId: "telegram-user-42",
    },
    messages: [
      {
        id: "telegram-message-42",
        role: "patient" as const,
        text: "Telegram truth",
        sentAt: "2026-07-13T17:00:00.000Z",
      },
    ],
  };
  const extraSyntheticConversation = {
    ...structuredClone(current.conversations[0]!),
    id: "conversation-synthetic-extra",
  };
  const hitlCase = {
    ...structuredClone(seedCase),
    id: "case-hitl-42",
    source: {
      kind: "hitl" as const,
      conversationId: telegramConversation.id,
      messageIds: ["telegram-message-42"],
    },
    sourceConversationId: telegramConversation.id,
  };
  const manualCase = {
    ...structuredClone(seedCase),
    id: "case-manual-42",
    source: { kind: "manual" as const },
  };
  const legacySeedCase = {
    ...structuredClone(seedCase),
    id: "case-malay-holdout",
    source: { kind: "seed" as const },
  };
  const customDataset = {
    ...structuredClone(dataset),
    id: "dataset-custom",
    name: "Custom dataset",
    protected: false,
    cases: [manualCase, legacySeedCase],
    runHistory: [
      historyRow("run-custom", manualCase.id, "dataset-custom"),
      historyRow(
        "run-custom-seed",
        legacySeedCase.id,
        "dataset-custom",
      ),
    ],
  };

  current.conversations = [
    ...current.conversations.map((conversation, index) =>
      index === 0
        ? {
            ...conversation,
            messages: [
              ...conversation.messages,
              {
                id: "synthetic-dirty-message",
                role: "patient" as const,
                text: "Remove me",
                sentAt: "2026-07-13T17:00:00.000Z",
              },
            ],
          }
        : conversation,
    ),
    extraSyntheticConversation,
    telegramConversation,
  ];
  dataset.cases = [
    ...dataset.cases.map((evalCase, index) =>
      index === 0
        ? { ...evalCase, expectedHumanOutput: "Dirty synthetic output" }
        : evalCase,
    ),
    legacySeedCase,
    hitlCase,
    manualCase,
  ];
  dataset.criteria.push({
    id: "criterion-manual",
    label: "Manual criterion",
    instruction: "Preserve this visitor-created criterion.",
    required: false,
    version: 1,
  });
  dataset.runHistory = [
    historyRow("run-seed", seedCase.id),
    historyRow("run-legacy-seed", legacySeedCase.id),
    historyRow("run-hitl", hitlCase.id),
    historyRow("run-manual", manualCase.id),
  ];
  dataset.suiteSnapshots = [
    {
      id: "suite-dirty",
      createdAt: "2026-07-13T17:00:00.000Z",
      overallPassPercent: 50,
      trainPassPercent: 50,
      holdoutPassPercent: 50,
      meanJudgeScore: 0.5,
    },
  ];
  current.evalDatasets.push(customDataset);
  current.playbookFiles[0]!.savedContent = "Dirty synthetic playbook";
  current.playbookFiles.push({
    id: "file-manual",
    path: "playbooks/manual.md",
    title: "Manual",
    savedContent: "Preserve me",
    updatedAt: "2026-07-13T17:00:00.000Z",
    protected: false,
  });
  current.playbookFolders.push("playbooks/manual");
  if (current.corrections.length === 0) {
    current.corrections.push({
      id: "correction-seed",
      fileId: "file-aircon-service-selection",
      oldText: "For poor cooling and a musty smell, quote the RM99 general service.",
      newText: "Dirty synthetic correction",
      evidence: "Seed correction",
      status: "pending",
      sourceCaseId: seedCase.id,
    });
  } else {
    current.corrections[0]!.newText = "Dirty synthetic correction";
  }
  current.corrections.push(
    {
      id: "correction-hitl",
      fileId: "file-manual",
      oldText: "old",
      newText: "new",
      evidence: "Telegram evidence",
      status: "pending",
      sourceCaseId: hitlCase.id,
    },
    {
      id: "correction-legacy-seed",
      fileId: "file-aircon-service-selection",
      oldText: "old",
      newText: "new",
      evidence: "Legacy synthetic evidence",
      status: "pending",
      sourceCaseId: legacySeedCase.id,
    },
  );
  current.speechArtifacts = [
    {
      messageId: "telegram-message-42",
      telegramFileId: "telegram-file-42",
      status: "ready",
      detectedLanguage: "English",
      originalTranscript: "Telegram truth",
      englishGloss: null,
      model: "fixture",
      error: null,
    },
  ];
  const freezeInput = {
    state: current,
    datasetId: dataset.id,
    playbookVersionId: current.playbookHistory.activeVersionId,
    agentConfig,
    judgeConfig,
    baselineSuiteId: null,
    createdAt: current.fixtureTime,
  };
  const seedSuite = await freezeEvalSuiteSnapshot({
    ...freezeInput,
    suiteId: "suite-seed-dirty",
    caseIds: [seedCase.id],
  });
  const hitlSuite = await freezeEvalSuiteSnapshot({
    ...freezeInput,
    suiteId: "suite-hitl",
    caseIds: [hitlCase.id],
  });
  const seedRun = evalRun("eval-run-seed", seedSuite);
  const hitlRun = evalRun("eval-run-hitl", hitlSuite);
  current.evalArtifacts = {
    suites: [seedSuite, hitlSuite],
    runs: [seedRun, hitlRun],
    resolutions: [
      {
        evalRunId: seedRun.id,
        verdict: "pass",
        note: "Synthetic review.",
        resolvedAt: "2026-07-13T12:02:00.000Z",
      },
      {
        evalRunId: hitlRun.id,
        verdict: "pass",
        note: "Real review.",
        resolvedAt: "2026-07-13T12:02:00.000Z",
      },
    ],
  };

  return serverDomainStateSchema.parse(current);
}

describe("synthetic-only reset merge", () => {
  it("replaces synthetic conversations and speech while preserving Telegram truth", async () => {
    const canonical = await createCanonicalServerState();
    const current = await dirtyServerState();
    const before = structuredClone(current);

    const reset = mergeSyntheticReset(current, canonical);
    const telegram = current.conversations.find(
      (conversation) => conversation.source === "telegram",
    )!;

    expect(
      reset.conversations.filter(
        (conversation) => conversation.source === "synthetic",
      ),
    ).toEqual(canonical.conversations);
    expect(
      reset.conversations.find(
        (conversation) => conversation.source === "telegram",
      ),
    ).toEqual(telegram);
    expect(reset.speechArtifacts).toEqual([
      current.speechArtifacts.find(
        (artifact) => artifact.messageId === "telegram-message-42",
      ),
    ]);
    expect(current).toEqual(before);
  });

  it("replaces seed Eval and playbook state without deleting real or manual work", async () => {
    const canonical = await createCanonicalServerState();
    const current = await dirtyServerState();

    const reset = mergeSyntheticReset(current, canonical);
    const dataset = reset.evalDatasets.find(
      (item) => item.id === "dataset-aircon-ops",
    )!;
    const canonicalDataset = canonical.evalDatasets[0]!;

    expect(dataset.cases.filter((item) => item.source.kind === "seed")).toEqual(
      canonicalDataset.cases,
    );
    expect(dataset.cases.map((item) => item.id)).toContain("case-hitl-42");
    expect(dataset.cases.map((item) => item.id)).toContain("case-manual-42");
    expect(dataset.cases.map((item) => item.id)).not.toContain(
      "case-malay-holdout",
    );
    expect(dataset.runHistory.map((row) => row.id)).toEqual([
      "run-hitl",
      "run-manual",
    ]);
    expect(dataset.suiteSnapshots).toEqual([]);
    expect(dataset.criteria.map((criterion) => criterion.id)).toContain(
      "criterion-manual",
    );
    const customDataset = reset.evalDatasets.find(
      (item) => item.id === "dataset-custom",
    )!;
    expect(customDataset.cases.map((item) => item.id)).toEqual([
      "case-manual-42",
    ]);
    expect(customDataset.runHistory.map((item) => item.id)).toEqual([
      "run-custom",
    ]);
    expect(reset.playbookFiles.slice(0, canonical.playbookFiles.length)).toEqual(
      canonical.playbookFiles,
    );
    expect(reset.playbookFiles.map((file) => file.id)).toContain("file-manual");
    expect(reset.playbookFolders).toContain("playbooks/manual");
    expect(reset.playbookHistory).toEqual(canonical.playbookHistory);
    expect(reset.corrections.map((item) => item.id)).toContain(
      "correction-hitl",
    );
    expect(reset.corrections.map((item) => item.id)).not.toContain(
      "correction-legacy-seed",
    );
    expect(reset.evalArtifacts.suites.map((suite) => suite.id)).toEqual([
      "suite-hitl",
    ]);
    expect(reset.evalArtifacts.runs.map((run) => run.id)).toEqual([
      "eval-run-hitl",
    ]);
    expect(
      reset.evalArtifacts.resolutions.map(
        (resolution) => resolution.evalRunId,
      ),
    ).toEqual(["eval-run-hitl"]);
  });

  it("returns a valid idempotent server aggregate", async () => {
    const canonical = await createCanonicalServerState();
    const once = mergeSyntheticReset(await dirtyServerState(), canonical);
    const twice = mergeSyntheticReset(once, canonical);

    expect(serverDomainStateSchema.parse(once)).toEqual(once);
    expect(twice).toEqual(once);
  });

  it("lets the canonical seed replace a preserved case with the same ID", async () => {
    const canonical = await createCanonicalServerState();
    const current = structuredClone(canonical);
    const dataset = current.evalDatasets[0]!;
    const seedCase = dataset.cases[0]!;
    dataset.cases = [
      ...dataset.cases.slice(1),
      {
        ...structuredClone(seedCase),
        source: { kind: "manual" },
      },
    ];

    const reset = mergeSyntheticReset(current, canonical);
    const matching = reset.evalDatasets[0]!.cases.filter(
      (evalCase) => evalCase.id === seedCase.id,
    );

    expect(matching).toHaveLength(1);
    expect(matching[0]!.source).toEqual({ kind: "seed" });
  });
});
