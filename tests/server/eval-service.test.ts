import { describe, expect, it, vi } from "vitest";

import {
  createEvalService,
  EvalServiceError,
} from "../../server/eval-service";
import { AGENT_PROMPT_VERSION } from "../../server/agent-prompt";
import { JUDGE_PROMPT_VERSION } from "../../server/judge-prompt";
import type { AgentRunRequest } from "../../src/contracts/agent";
import type { JudgeRequest } from "../../src/contracts/judge";
import { createCanonicalServerState } from "../../src/domain";
import { createWorkspaceRepository } from "../../server/workspace-repository";
import { InMemoryWorkspaceDataSource } from "./fixtures/workspace-data-source";

const agentConfig = {
  modelId: "agent-model",
  apiMode: "responses" as const,
  agentConfigVersion: "agent-config-v1",
  promptVersion: AGENT_PROMPT_VERSION,
  toolPolicyVersion: "demo-no-tools-v1" as const,
};

const judgeConfig = {
  modelId: "judge-model",
  promptVersion: JUDGE_PROMPT_VERSION,
};

function agentResult(request: AgentRunRequest) {
  const playbook = request.playbookBundle.versions[0]!;
  return {
    runId: `agent-${request.conversation.id}`,
    draft: {
      englishText: "Staff review is required.",
      patientLanguage: request.patientContext.preferredLanguage,
      patientText: "Staff review is required.",
    },
    proposedAction: "reply" as const,
    handoffReason: null,
    evidence: [
      {
        fileId: playbook.fileId,
        versionId: playbook.versionId,
        contentHash: playbook.contentHash,
        excerpt: playbook.content.slice(0, 10),
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
  };
}

function judgeResult(request: JudgeRequest) {
  return {
    overallVerdict: "pass" as const,
    judgeScore: 1,
    rationale: "The candidate satisfies the frozen rubrics.",
    criterionResults: request.rubrics.map((rubric) => ({
      criterionId: rubric.id,
      verdict: "pass" as const,
      reason: "The response requests staff review.",
      evidence: "Staff review is required.",
    })),
    metadata: {
      provider: "test",
      model: judgeConfig.modelId,
      promptVersion: judgeConfig.promptVersion,
      rubricVersions: Object.fromEntries(
        request.rubrics.map((rubric) => [
          rubric.id,
          rubric.version,
        ]),
      ),
      runId: request.runId,
      latencyMs: 10,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      simulated: true,
    },
  };
}

async function setup() {
  const dataSource = new InMemoryWorkspaceDataSource();
  const repository = createWorkspaceRepository(dataSource);
  const state = await createCanonicalServerState();
  await repository.bootstrap("demo", state);
  const agent = vi.fn(async (request: AgentRunRequest) =>
    agentResult(request),
  );
  const judge = vi.fn(async (request: JudgeRequest) =>
    judgeResult(request),
  );
  let suiteSequence = 0;
  let runSequence = 0;
  const service = createEvalService({
    workspaceId: "demo",
    repository,
    agent: {
      config: agentConfig,
      run: agent,
    },
    judge: {
      config: judgeConfig,
      run: judge,
    },
    createSuiteId: () => `suite-${++suiteSequence}`,
    createEvalRunId: () => `eval-run-${++runSequence}`,
    now: () => "2026-07-13T12:00:00.000Z",
  });
  return {
    agent,
    dataSource,
    judge,
    repository,
    service,
    state,
  };
}

async function createSeedSuite(
  service: ReturnType<typeof createEvalService>,
  expectedWorkspaceRevision = 1,
) {
  return service.createSuite({
    datasetId: "dataset-aircon-ops",
    caseIds: ["case-aircon-selection-train"],
    playbookVersionId: "playbook-version-1",
    expectedWorkspaceRevision,
  });
}

describe("Eval service", () => {
  it("freezes one suite and atomically commits one sandbox agent plus judge artifact", async () => {
    const { agent, judge, repository, service } = await setup();
    const created = await createSeedSuite(service);

    expect(created.workspaceRevision).toBe(2);
    const result = await service.runCase({
      suiteId: created.suiteId,
      caseId: "case-aircon-selection-train",
      expectedWorkspaceRevision: 2,
    });
    const loaded = await repository.load("demo");
    const request = agent.mock.calls[0]![0];
    const judgeRequest = judge.mock.calls[0]![0];

    expect(result).toEqual({
      suiteId: created.suiteId,
      caseId: "case-aircon-selection-train",
      attempt: 1,
      status: "committed",
      evalRunId: "eval-run-1",
      workspaceRevision: 3,
    });
    expect(request.mode).toBe("sandbox");
    expect(request.playbookBundle.versions).toHaveLength(3);
    expect(JSON.stringify(request)).not.toContain(
      "expectedStaffResponse",
    );
    expect(JSON.stringify(request)).not.toContain("rubricRefs");
    expect(judgeRequest.expectedResponse).toContain("chemical wash");
    expect(judgeRequest.rubrics.map((rubric) => rubric.id)).toEqual([
      "crit-aircon-selection",
      "crit-aircon-price",
    ]);
    expect(loaded?.state.evalArtifacts.runs).toHaveLength(1);
    expect(loaded?.state.evalArtifacts.runs[0]?.agentResult).toBeTruthy();
    expect(loaded?.state.evalArtifacts.runs[0]?.judgeResult).toBeTruthy();
  });

  it("rejects stale revisions before either provider runs", async () => {
    const { agent, judge, service } = await setup();
    const created = await createSeedSuite(service);

    await expect(
      service.runCase({
        suiteId: created.suiteId,
        caseId: "case-aircon-selection-train",
        expectedWorkspaceRevision: 1,
      }),
    ).rejects.toEqual(
      new EvalServiceError(
        "revision_conflict",
        "Workspace revision is stale",
        true,
      ),
    );
    expect(agent).not.toHaveBeenCalled();
    expect(judge).not.toHaveBeenCalled();
  });

  it("blocks a patient-feedback candidate until a human reference reply is added", async () => {
    const { agent, judge, repository, service } = await setup();
    const workspace = await repository.load("demo");
    if (!workspace) throw new Error("Workspace is missing");
    const next = structuredClone(workspace.state);
    const dataset = next.evalDatasets.find((candidate) => candidate.id === "dataset-aircon-ops");
    const sourceCase = dataset?.cases.find((candidate) => candidate.id === "case-aircon-confirm-train");
    if (!dataset || !sourceCase) throw new Error("Seed Eval case is missing");
    dataset.cases.push({
      ...sourceCase,
      id: "case-agent-feedback-pending",
      title: "Autonomous feedback: Aina Zulkifli",
      expectedHumanOutput: "",
      source: {
        kind: "autonomous_feedback",
        conversationId: "convo-aircon-booking",
        messageIds: ["book-1"],
        reason: "The patient says the autonomous response was wrong.",
      },
    });
    await expect(repository.save("demo", workspace.revision, next)).resolves.toMatchObject({
      ok: true,
    });

    await expect(
      service.createSuite({
        datasetId: "dataset-aircon-ops",
        caseIds: ["case-agent-feedback-pending"],
        playbookVersionId: "playbook-version-1",
        expectedWorkspaceRevision: 2,
      }),
    ).rejects.toEqual(
      new EvalServiceError(
        "invalid_request",
        "Eval case case-agent-feedback-pending needs a human correction before it can run",
        false,
      ),
    );
    expect(agent).not.toHaveBeenCalled();
    expect(judge).not.toHaveBeenCalled();
  });

  it("does not commit partial evidence when agent or judge evidence is invalid", async () => {
    const first = await setup();
    const firstSuite = await createSeedSuite(first.service);
    first.agent.mockImplementationOnce(async (request) => ({
      ...agentResult(request),
      evidence: [
        {
          ...agentResult(request).evidence[0]!,
          excerpt: "not in the frozen playbook",
        },
      ],
    }));

    await expect(
      first.service.runCase({
        suiteId: firstSuite.suiteId,
        caseId: "case-aircon-selection-train",
        expectedWorkspaceRevision: 2,
      }),
    ).rejects.toMatchObject({ code: "provider_failed" });
    expect((await first.repository.load("demo"))?.revision).toBe(2);
    expect(
      (await first.repository.load("demo"))?.state.evalArtifacts.runs,
    ).toEqual([]);

    const second = await setup();
    const secondSuite = await createSeedSuite(second.service);
    second.judge.mockImplementationOnce(async (request) => ({
      ...judgeResult(request),
      criterionResults: [
        {
          ...judgeResult(request).criterionResults[0]!,
          evidence: "not in candidate",
        },
      ],
    }));

    await expect(
      second.service.runCase({
        suiteId: secondSuite.suiteId,
        caseId: "case-aircon-selection-train",
        expectedWorkspaceRevision: 2,
      }),
    ).rejects.toMatchObject({ code: "provider_failed" });
    expect((await second.repository.load("demo"))?.revision).toBe(2);
    expect(
      (await second.repository.load("demo"))?.state.evalArtifacts.runs,
    ).toEqual([]);
  });

  it("stops after cancellation even when the agent returns a result", async () => {
    const { agent, judge, repository, service } = await setup();
    const created = await createSeedSuite(service);
    const controller = new AbortController();
    agent.mockImplementationOnce(async (request) => {
      controller.abort();
      return agentResult(request);
    });

    await expect(
      service.runCase(
        {
          suiteId: created.suiteId,
          caseId: "case-aircon-selection-train",
          expectedWorkspaceRevision: 2,
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(judge).not.toHaveBeenCalled();
    expect((await repository.load("demo"))?.revision).toBe(2);
    expect(
      (await repository.load("demo"))?.state.evalArtifacts.runs,
    ).toEqual([]);
  });

  it("appends a new immutable attempt on an explicit retry", async () => {
    const { repository, service } = await setup();
    const created = await createSeedSuite(service);

    const first = await service.runCase({
      suiteId: created.suiteId,
      caseId: "case-aircon-selection-train",
      expectedWorkspaceRevision: 2,
    });
    const second = await service.runCase({
      suiteId: created.suiteId,
      caseId: "case-aircon-selection-train",
      expectedWorkspaceRevision: 3,
    });

    expect([first.attempt, second.attempt]).toEqual([1, 2]);
    expect(
      (await repository.load("demo"))?.state.evalArtifacts.runs.map(
        (run) => run.attempt,
      ),
    ).toEqual([1, 2]);
  });

  it("fails closed when pinned Knowledge content no longer resolves", async () => {
    const { agent, dataSource, service } = await setup();
    const created = await createSeedSuite(service);
    const record = dataSource.records.get("demo")!;
    record.state.playbookHistory.versions[0]!.files[0]!.contentHash =
      "a".repeat(64);

    await expect(
      service.runCase({
        suiteId: created.suiteId,
        caseId: "case-aircon-selection-train",
        expectedWorkspaceRevision: 2,
      }),
    ).rejects.toMatchObject({ code: "provider_failed" });
    expect(agent).not.toHaveBeenCalled();
    expect(dataSource.records.get("demo")?.revision).toBe(2);
  });
});
