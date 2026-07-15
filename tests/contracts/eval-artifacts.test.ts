import { describe, expect, it } from "vitest";

import {
  demoEvalCaseSchema,
  evalCaseRunRequestSchema,
  evalCaseRunResultSchema,
  evalArtifactStateSchema,
  evalRunArtifactSchema,
  evalSuiteSnapshotSchema,
  evalSuiteCreateRequestSchema,
  evalSuiteCreateResultSchema,
  reviewResolutionSchema,
  reviewResolutionRequestSchema,
} from "../../src/contracts/eval";

const hash =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const otherHash =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const evalCase = {
  id: "case-emergency-train",
  title: "Emergency symptoms",
  split: "train" as const,
  type: "emergency_triage" as const,
  language: "English",
  generationCase: {
    messages: [
      {
        id: "message-1",
        role: "patient" as const,
        text: "I have chest pain.",
        language: "English",
        sentAt: "2026-07-13T12:00:00.000Z",
      },
    ],
    patientContext: {
      preferredLanguage: "English",
    },
    bookingContext: null,
    playbookVersions: [
      {
        fileId: "file-triage",
        versionId: "playbook-v1",
        contentHash: hash,
      },
    ],
    agentConfigVersion: "agent-config-v1",
    promptVersion: "agent-prompt-v1",
    toolPolicyVersion: "demo-no-tools-v1" as const,
  },
  judgeBundle: {
    expectedStaffResponse: "Please seek urgent care now.",
    rubricRefs: [
      {
        id: "crit-emergency",
        version: 1,
      },
    ],
  },
  source: {
    kind: "seed" as const,
  },
};

const suite = {
  id: "suite-1",
  datasetId: "dataset-seed",
  cases: [evalCase],
  rubrics: [
    {
      id: "crit-emergency",
      label: "Emergency safety",
      instruction: "Direct urgent symptoms to emergency care.",
      required: true,
      version: 1,
    },
  ],
  playbookBundle: {
    versionId: "playbook-v1",
    bundleHash: otherHash,
    versions: [
      {
        fileId: "file-triage",
        versionId: "playbook-v1",
        contentHash: hash,
      },
    ],
  },
  agentConfig: {
    modelId: "agent-model",
    apiMode: "responses" as const,
    agentConfigVersion: "agent-config-v1",
    promptVersion: "agent-prompt-v1",
    toolPolicyVersion: "demo-no-tools-v1" as const,
  },
  judgeConfig: {
    modelId: "judge-model",
    promptVersion: "judge-prompt-v1",
  },
  manifestHash: hash,
  baselineSuiteId: null,
  createdAt: "2026-07-13T12:00:00.000Z",
};

const agentResult = {
  runId: "agent-run-1",
  draft: {
    englishText: "Please seek urgent care now.",
    patientLanguage: "English",
    patientText: "Please seek urgent care now.",
  },
  proposedAction: "reply" as const,
  handoffReason: null,
  evidence: [
    {
      fileId: "file-triage",
      versionId: "playbook-v1",
      contentHash: hash,
      excerpt: "urgent care",
    },
  ],
  toolCalls: [] as [],
  stopReason: "completed" as const,
  usage: {
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
  },
  latencyMs: 250,
};

const judgeResult = {
  overallVerdict: "pass" as const,
  judgeScore: 1,
  rationale: "The candidate follows the required escalation.",
  criterionResults: [
    {
      criterionId: "crit-emergency",
      verdict: "pass" as const,
      reason: "The response directs urgent care.",
      evidence: "Please seek urgent care now.",
    },
  ],
  metadata: {
    provider: "openai",
    model: "judge-model",
    promptVersion: "judge-prompt-v1",
    rubricVersions: {
      "crit-emergency": 1,
    },
    runId: "judge-run-1",
    latencyMs: 100,
    inputTokens: 50,
    outputTokens: 10,
    totalTokens: 60,
    simulated: false,
  },
};

const runArtifact = {
  id: "eval-run-1",
  suiteId: "suite-1",
  caseId: "case-emergency-train",
  attempt: 1,
  candidateResponse: "Please seek urgent care now.",
  agentResult,
  judgeResult,
  ranAt: "2026-07-13T12:01:00.000Z",
};

describe("frozen Eval artifact contracts", () => {
  it("keeps generation inputs separate from judge-only expected output and rubrics", () => {
    const parsed = demoEvalCaseSchema.parse(evalCase);

    expect(parsed.generationCase).not.toHaveProperty(
      "expectedStaffResponse",
    );
    expect(parsed.generationCase).not.toHaveProperty("rubricRefs");
    expect(parsed.generationCase).not.toHaveProperty(
      "criterionIds",
    );
    expect(parsed.judgeBundle.expectedStaffResponse).toBe(
      "Please seek urgent care now.",
    );
    expect(
      demoEvalCaseSchema.safeParse({
        ...evalCase,
        generationCase: {
          ...evalCase.generationCase,
          expectedHumanOutput: "Hidden answer",
        },
      }).success,
    ).toBe(false);
  });

  it("freezes complete case, rubric, playbook, agent, and judge pins in one suite", () => {
    expect(evalSuiteSnapshotSchema.parse(suite)).toEqual(suite);
    expect(
      evalSuiteSnapshotSchema.safeParse({
        ...suite,
        cases: [evalCase, evalCase],
      }).success,
    ).toBe(false);
    expect(
      evalSuiteSnapshotSchema.safeParse({
        ...suite,
        playbookBundle: {
          ...suite.playbookBundle,
          versions: [
            ...suite.playbookBundle.versions,
            suite.playbookBundle.versions[0],
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("rejects case pins that do not resolve to the frozen suite", () => {
    expect(
      evalSuiteSnapshotSchema.safeParse({
        ...suite,
        cases: [
          {
            ...evalCase,
            judgeBundle: {
              ...evalCase.judgeBundle,
              rubricRefs: [
                {
                  id: "crit-emergency",
                  version: 2,
                },
              ],
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      evalSuiteSnapshotSchema.safeParse({
        ...suite,
        cases: [
          {
            ...evalCase,
            generationCase: {
              ...evalCase.generationCase,
              agentConfigVersion: "wrong-agent-config",
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      evalSuiteSnapshotSchema.safeParse({
        ...suite,
        cases: [
          {
            ...evalCase,
            generationCase: {
              ...evalCase.generationCase,
              playbookVersions: [
                {
                  ...evalCase.generationCase.playbookVersions[0],
                  contentHash: otherHash,
                },
              ],
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires one complete agent and judge artifact per committed attempt", () => {
    expect(evalRunArtifactSchema.parse(runArtifact)).toEqual(
      runArtifact,
    );
    const { judgeResult: _judgeResult, ...partial } = runArtifact;
    expect(evalRunArtifactSchema.safeParse(partial).success).toBe(
      false,
    );
  });

  it("enforces aggregate references and unique attempts", () => {
    expect(
      evalArtifactStateSchema.parse({
        suites: [suite],
        runs: [runArtifact],
        resolutions: [],
      }),
    ).toBeTruthy();
    expect(
      evalArtifactStateSchema.safeParse({
        suites: [],
        runs: [runArtifact],
        resolutions: [],
      }).success,
    ).toBe(false);
    expect(
      evalArtifactStateSchema.safeParse({
        suites: [suite],
        runs: [
          runArtifact,
          {
            ...runArtifact,
            id: "eval-run-2",
          },
        ],
        resolutions: [],
      }).success,
    ).toBe(false);
    expect(
      evalArtifactStateSchema.safeParse({
        suites: [suite],
        runs: [runArtifact],
        resolutions: [
          {
            evalRunId: "missing-run",
            verdict: "pass",
            note: "Reviewed.",
            resolvedAt: "2026-07-13T12:02:00+08:00",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("validates thin create, case-run, and review requests", () => {
    expect(
      evalSuiteCreateRequestSchema.parse({
        datasetId: "dataset-seed",
        caseIds: ["case-emergency-train"],
        playbookVersionId: "playbook-v1",
        expectedWorkspaceRevision: 1,
      }),
    ).toBeTruthy();
    expect(
      evalSuiteCreateResultSchema.parse({
        suiteId: "suite-1",
        manifestHash: hash,
        workspaceRevision: 2,
      }),
    ).toEqual({
      suiteId: "suite-1",
      manifestHash: hash,
      workspaceRevision: 2,
    });
    expect(
      evalCaseRunRequestSchema.parse({
        suiteId: "suite-1",
        caseId: "case-emergency-train",
        expectedWorkspaceRevision: 2,
      }),
    ).toBeTruthy();
    expect(
      evalCaseRunResultSchema.parse({
        suiteId: "suite-1",
        caseId: "case-emergency-train",
        attempt: 1,
        status: "committed",
        evalRunId: "eval-run-1",
        workspaceRevision: 3,
      }),
    ).toBeTruthy();
    expect(
      reviewResolutionSchema.parse({
        evalRunId: "eval-run-1",
        verdict: "pass",
        note: "Reviewed against clinic policy.",
        resolvedAt: "2026-07-13T12:02:00.000Z",
      }),
    ).toBeTruthy();
    expect(
      reviewResolutionRequestSchema.parse({
        verdict: "pass",
        note: "Reviewed against clinic policy.",
      }),
    ).toEqual({
      verdict: "pass",
      note: "Reviewed against clinic policy.",
    });
    expect(
      reviewResolutionSchema.parse({
        evalRunId: "eval-run-1",
        verdict: "pass",
        note: "Reviewed against clinic policy.",
        resolvedAt: "2026-07-13T20:02:00+08:00",
      }).resolvedAt,
    ).toBe("2026-07-13T20:02:00+08:00");
  });

  it("rejects duplicate case IDs and unknown request fields", () => {
    expect(
      evalSuiteCreateRequestSchema.safeParse({
        datasetId: "dataset-seed",
        caseIds: [
          "case-emergency-train",
          "case-emergency-train",
        ],
        playbookVersionId: "playbook-v1",
        expectedWorkspaceRevision: 1,
      }).success,
    ).toBe(false);
    expect(
      evalCaseRunRequestSchema.safeParse({
        suiteId: "suite-1",
        caseId: "case-emergency-train",
        expectedWorkspaceRevision: 2,
        judgeBundle: evalCase.judgeBundle,
      }).success,
    ).toBe(false);
    expect(
      demoEvalCaseSchema.safeParse({
        ...evalCase,
        expectedHumanOutput: "Hidden answer",
      }).success,
    ).toBe(false);
    expect(
      demoEvalCaseSchema.safeParse({
        ...evalCase,
        judgeBundle: {
          ...evalCase.judgeBundle,
          rubricRefs: [
            ...evalCase.judgeBundle.rubricRefs,
            ...evalCase.judgeBundle.rubricRefs,
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      reviewResolutionRequestSchema.safeParse({
        verdict: "pass",
        note: "Reviewed.",
        evalRunId: "eval-run-1",
      }).success,
    ).toBe(false);
  });
});
