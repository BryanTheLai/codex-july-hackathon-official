import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AGENT_PROMPT_VERSION } from "../../server/agent-prompt";
import { createEvalService } from "../../server/eval-service";
import { createJudgeApp } from "../../server/index";
import { JUDGE_PROMPT_VERSION } from "../../server/judge-prompt";
import { createWorkspaceRepository } from "../../server/workspace-repository";
import type {
  AgentRunRequest,
  AgentRunResult,
} from "../../src/contracts/agent";
import type {
  JudgeRequest,
  JudgeResponse,
} from "../../src/contracts/judge";
import { createCanonicalServerState } from "../../src/domain";
import { InMemoryWorkspaceDataSource } from "./fixtures/workspace-data-source";

const servers: Array<
  ReturnType<ReturnType<typeof createJudgeApp>["listen"]>
> = [];

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

function validAgentResult(
  request: AgentRunRequest,
): AgentRunResult {
  return {
    runId: `agent-${request.conversation.id}`,
    draft: {
      englishText: "Staff review is required.",
      patientLanguage: request.patientContext.preferredLanguage,
      patientText: "Staff review is required.",
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
  };
}

function validJudgeResult(
  request: JudgeRequest,
): JudgeResponse {
  return {
    overallVerdict: "pass",
    judgeScore: 1,
    rationale: "The candidate satisfies the frozen rubrics.",
    criterionResults: request.rubrics.map((rubric) => ({
      criterionId: rubric.id,
      verdict: "pass",
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

async function configuredServer(options?: {
  agent?: (
    request: AgentRunRequest,
    signal?: AbortSignal,
  ) => Promise<AgentRunResult>;
  judge?: (
    request: JudgeRequest,
    signal?: AbortSignal,
  ) => Promise<JudgeResponse>;
  evalEnabled?: boolean;
  timeoutMs?: number;
  rateLimit?: {
    requests: number;
    windowMs: number;
  };
}) {
  const dataSource = new InMemoryWorkspaceDataSource();
  const repository = createWorkspaceRepository(dataSource);
  await repository.bootstrap(
    "demo",
    await createCanonicalServerState(),
  );
  const agent = vi.fn(
    options?.agent ??
      (async (request: AgentRunRequest) =>
        validAgentResult(request)),
  );
  const judge = vi.fn(
    options?.judge ??
      (async (request: JudgeRequest) =>
        validJudgeResult(request)),
  );
  let suiteSequence = 0;
  let runSequence = 0;
  const evalService = createEvalService({
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
  const app = createJudgeApp({
    eval: options?.evalEnabled === false ? null : evalService,
    agentTimeoutMs: options?.timeoutMs,
    requestTimeoutMs: options?.timeoutMs,
    rateLimit: options?.rateLimit,
    workspace: {
      workspaceId: "demo",
      repository,
      createCanonicalState: createCanonicalServerState,
    },
  });
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) =>
    server.once("listening", resolve),
  );
  const address = server.address() as AddressInfo;
  return {
    agent,
    baseUrl: `http://127.0.0.1:${address.port}`,
    judge,
    repository,
  };
}

function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createSuite(baseUrl: string) {
  const response = await postJson(`${baseUrl}/api/eval/suites`, {
    datasetId: "dataset-seed",
    caseIds: ["case-emergency-train"],
    playbookVersionId: "playbook-version-1",
    expectedWorkspaceRevision: 1,
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<{
    suiteId: string;
    manifestHash: string;
    workspaceRevision: number;
  }>;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) =>
            error ? reject(error) : resolve(),
          ),
        ),
    ),
  );
});

describe("workspace-backed Eval endpoints", () => {
  it("freezes a suite then commits one case through sandbox agent and internal judge", async () => {
    const { agent, baseUrl, judge, repository } =
      await configuredServer();
    const suite = await createSuite(baseUrl);

    const response = await postJson(
      `${baseUrl}/api/eval/suites/${suite.suiteId}/cases/case-emergency-train/run`,
      {
        suiteId: suite.suiteId,
        caseId: "case-emergency-train",
        expectedWorkspaceRevision: suite.workspaceRevision,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      suiteId: suite.suiteId,
      caseId: "case-emergency-train",
      attempt: 1,
      status: "committed",
      evalRunId: "eval-run-1",
      workspaceRevision: 3,
    });
    expect(agent.mock.calls[0]?.[0].mode).toBe("sandbox");
    expect(judge).toHaveBeenCalledTimes(1);
    expect(
      (await repository.load("demo"))?.state.evalArtifacts.runs,
    ).toHaveLength(1);
  });

  it("rejects stale, mismatched, and judge-injected requests before providers run", async () => {
    const { agent, baseUrl, judge } = await configuredServer();
    const suite = await createSuite(baseUrl);
    const url = `${baseUrl}/api/eval/suites/${suite.suiteId}/cases/case-emergency-train/run`;

    const stale = await postJson(url, {
      suiteId: suite.suiteId,
      caseId: "case-emergency-train",
      expectedWorkspaceRevision: 1,
    });
    const mismatch = await postJson(url, {
      suiteId: "different-suite",
      caseId: "case-emergency-train",
      expectedWorkspaceRevision: 2,
    });
    const injected = await postJson(url, {
      suiteId: suite.suiteId,
      caseId: "case-emergency-train",
      expectedWorkspaceRevision: 2,
      judgeBundle: {
        expectedStaffResponse: "hidden",
      },
    });

    expect(stale.status).toBe(409);
    expect(mismatch.status).toBe(400);
    expect(injected.status).toBe(400);
    expect(agent).not.toHaveBeenCalled();
    expect(judge).not.toHaveBeenCalled();
  });

  it("returns not found for unknown suite-freeze inputs", async () => {
    const { baseUrl } = await configuredServer();

    const dataset = await postJson(
      `${baseUrl}/api/eval/suites`,
      {
        datasetId: "missing-dataset",
        caseIds: ["case-emergency-train"],
        playbookVersionId: "playbook-version-1",
        expectedWorkspaceRevision: 1,
      },
    );
    const evalCase = await postJson(
      `${baseUrl}/api/eval/suites`,
      {
        datasetId: "dataset-seed",
        caseIds: ["missing-case"],
        playbookVersionId: "playbook-version-1",
        expectedWorkspaceRevision: 1,
      },
    );
    const playbook = await postJson(
      `${baseUrl}/api/eval/suites`,
      {
        datasetId: "dataset-seed",
        caseIds: ["case-emergency-train"],
        playbookVersionId: "missing-playbook",
        expectedWorkspaceRevision: 1,
      },
    );

    for (const response of [dataset, evalCase, playbook]) {
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        code: "not_found",
        retryable: false,
      });
    }
  });

  it("allows only one concurrent suite freeze to win the workspace revision", async () => {
    const { baseUrl, repository } = await configuredServer();
    const body = {
      datasetId: "dataset-seed",
      caseIds: ["case-emergency-train"],
      playbookVersionId: "playbook-version-1",
      expectedWorkspaceRevision: 1,
    };

    const responses = await Promise.all([
      postJson(`${baseUrl}/api/eval/suites`, body),
      postJson(`${baseUrl}/api/eval/suites`, body),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    expect((await repository.load("demo"))?.revision).toBe(2);
    expect(
      (await repository.load("demo"))?.state.evalArtifacts.suites,
    ).toHaveLength(1);
  });

  it("times out without committing an Eval artifact", async () => {
    const { baseUrl, repository } = await configuredServer({
      timeoutMs: 5,
      agent: (_request, signal) =>
        new Promise<AgentRunResult>((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    });
    const suite = await createSuite(baseUrl);

    const response = await postJson(
      `${baseUrl}/api/eval/suites/${suite.suiteId}/cases/case-emergency-train/run`,
      {
        suiteId: suite.suiteId,
        caseId: "case-emergency-train",
        expectedWorkspaceRevision: 2,
      },
    );

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      code: "provider_timeout",
      retryable: true,
    });
    expect((await repository.load("demo"))?.revision).toBe(2);
    expect(
      (await repository.load("demo"))?.state.evalArtifacts.runs,
    ).toEqual([]);
  });

  it("normalizes judge failure without committing the agent result", async () => {
    const { baseUrl, repository } = await configuredServer({
      judge: async () => {
        throw new Error("provider detail");
      },
    });
    const suite = await createSuite(baseUrl);

    const response = await postJson(
      `${baseUrl}/api/eval/suites/${suite.suiteId}/cases/case-emergency-train/run`,
      {
        suiteId: suite.suiteId,
        caseId: "case-emergency-train",
        expectedWorkspaceRevision: 2,
      },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      code: "provider_failed",
      error: "Eval execution failed.",
      retryable: true,
    });
    expect((await repository.load("demo"))?.revision).toBe(2);
    expect(
      (await repository.load("demo"))?.state.evalArtifacts.runs,
    ).toEqual([]);
  });

  it("allows only one concurrent case run to win the workspace revision", async () => {
    let calls = 0;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { baseUrl, repository } = await configuredServer({
      agent: async (request) => {
        calls += 1;
        if (calls === 2) {
          release();
        }
        await gate;
        return validAgentResult(request);
      },
    });
    const suite = await createSuite(baseUrl);
    const url = `${baseUrl}/api/eval/suites/${suite.suiteId}/cases/case-emergency-train/run`;
    const body = {
      suiteId: suite.suiteId,
      caseId: "case-emergency-train",
      expectedWorkspaceRevision: 2,
    };

    const responses = await Promise.all([
      postJson(url, body),
      postJson(url, body),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    expect((await repository.load("demo"))?.revision).toBe(3);
    expect(
      (await repository.load("demo"))?.state.evalArtifacts.runs,
    ).toHaveLength(1);
  });

  it("rate limits and feature-gates Eval execution", async () => {
    const limited = await configuredServer({
      rateLimit: {
        requests: 1,
        windowMs: 60_000,
      },
    });
    const suite = await createSuite(limited.baseUrl);
    const url = `${limited.baseUrl}/api/eval/suites/${suite.suiteId}/cases/case-emergency-train/run`;
    const body = {
      suiteId: suite.suiteId,
      caseId: "case-emergency-train",
      expectedWorkspaceRevision: 2,
    };

    expect((await postJson(url, body)).status).toBe(200);
    expect((await postJson(url, body)).status).toBe(429);

    const disabled = await configuredServer({
      evalEnabled: false,
    });
    const response = await postJson(
      `${disabled.baseUrl}/api/eval/suites`,
      {
        datasetId: "dataset-seed",
        caseIds: ["case-emergency-train"],
        playbookVersionId: "playbook-version-1",
        expectedWorkspaceRevision: 1,
      },
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "feature_disabled",
      retryable: false,
    });
  });
});
