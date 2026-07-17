import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import express from "express";

import { createCanonicalServerState } from "../../src/domain";
import type { AgentRunRequest } from "../../src/contracts/agent";
import type { JudgeRequest, JudgeResponse } from "../../src/contracts/judge";
import { createEvalService } from "../../server/eval-service";
import { createJudgeApp } from "../../server/index";
import { createWorkspaceCommandService } from "../../server/workspace-command-service";
import { createWorkspaceRepository } from "../../server/workspace-repository";
import { InMemoryWorkspaceDataSource } from "./fixtures/workspace-data-source";

const workspaceId = "e2e";
const dataSource = new InMemoryWorkspaceDataSource();
const repository = createWorkspaceRepository(dataSource);
const agentConfig = {
  modelId: "deterministic-e2e-agent",
  apiMode: "responses" as const,
  agentConfigVersion: "deterministic-e2e-agent-v1",
  promptVersion: "deterministic-e2e-agent-prompt-v1",
  toolPolicyVersion: "autonomous-booking-v1" as const,
};
const evalAgentConfig = {
  ...agentConfig,
  toolPolicyVersion: "demo-no-tools-v1" as const,
};
const judgeConfig = {
  modelId: "deterministic-e2e-judge",
  promptVersion: "deterministic-e2e-judge-prompt-v1",
};
let suiteSequence = 0;
let runSequence = 0;

function agentResult(request: AgentRunRequest) {
  const playbook = request.playbookBundle.versions[0]!;
  const bookingRequest = request.conversation.id === "convo-booking";
  const patientText = bookingRequest
    ? "Boleh kongsi tarikh dan masa pilihan anda? Saya sudah semak bahawa slot demo tersedia."
    : "Synthetic demo response for imported human-reviewed evidence.";
  return {
    runId: `agent-e2e-${request.conversation.id}`,
    draft: {
      englishText: patientText,
      patientLanguage: request.patientContext.preferredLanguage,
      patientText,
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
    toolCalls: bookingRequest
      ? [
          {
            callId: "e2e-list-availability",
            name: "list_available_slots",
            status: "completed" as const,
            summary: "Checked demo availability; waiting for the patient's preferred date and time.",
            conversationRevision: request.conversation.revision,
          },
        ]
      : [],
    stopReason: "completed" as const,
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    latencyMs: 10,
  };
}

function judgeResult(request: JudgeRequest): JudgeResponse {
  const requiredFailure =
    request.candidateVersion === 1 && request.rubrics.some((rubric) => rubric.required);
  const overallVerdict = requiredFailure ? "fail" as const : "pass" as const;
  return {
    overallVerdict,
    judgeScore: requiredFailure ? 0.2 : 0.9,
    rationale: `Deterministic E2E judge verdict: ${overallVerdict}.`,
    criterionResults: request.rubrics.map((rubric) => ({
      criterionId: rubric.id,
      verdict: requiredFailure && rubric.required ? "fail" as const : "pass" as const,
      reason: requiredFailure && rubric.required
        ? "The active fixture candidate does not satisfy this required scoring rule."
        : "The candidate satisfies this scoring rule.",
      evidence: requiredFailure ? null : request.candidateResponse,
    })),
    metadata: {
      provider: "deterministic-e2e",
      model: judgeConfig.modelId,
      promptVersion: judgeConfig.promptVersion,
      rubricVersions: Object.fromEntries(
        request.rubrics.map((rubric) => [rubric.id, rubric.version]),
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

const deterministicProposer = {
  async propose() {
    return {
      fileId: "file-malay-booking",
      oldText: "Confirm booking details in Malay.",
      newText: "Confirm booking details in Malay and tell staff to verify the appointment before sending confirmation.",
      rationale: "Deterministic E2E proposal from committed train failure evidence.",
    };
  },
};

await repository.bootstrap(workspaceId, await createCanonicalServerState());

const evalService = createEvalService({
  workspaceId,
  repository,
  agent: { config: evalAgentConfig, run: async (request) => agentResult(request) },
  judge: { config: judgeConfig, run: async (request) => judgeResult(request) },
  createSuiteId: () => `suite-e2e-${++suiteSequence}`,
  createEvalRunId: () => `eval-run-e2e-${++runSequence}`,
  now: () => new Date().toISOString(),
});

const app = createJudgeApp({
  agent: {
    ...agentConfig,
    run: async (request) => agentResult(request),
  },
  rateLimit: { requests: 500, windowMs: 60_000 },
  eval: evalService,
  judge: async (request) => judgeResult(request),
  telegram: null,
  workspace: {
    workspaceId,
    repository,
    createCanonicalState: createCanonicalServerState,
  },
  workflow: createWorkspaceCommandService({
    workspaceId,
    repository,
    evalService,
    createId: randomUUID,
    now: () => new Date().toISOString(),
    proposer: deterministicProposer,
  }),
});
app.post("/api/e2e/reset", async (_request, response) => {
  dataSource.records.clear();
  suiteSequence = 0;
  runSequence = 0;
  await repository.bootstrap(workspaceId, await createCanonicalServerState());
  response.status(204).end();
});
const distPath = fileURLToPath(new URL("../../dist/", import.meta.url));
app.use(express.static(distPath));
app.use((request, response, next) => {
  if (request.method !== "GET" || request.path.startsWith("/api/")) {
    next();
    return;
  }
  response.sendFile("index.html", { root: distPath });
});

const argument = process.argv.find((value) => value.startsWith("--port="));
const port = Number(argument?.slice("--port=".length) || 4173);
app.listen(port, () => {
  console.log(`KaunterAI E2E server listening on http://localhost:${port}`);
});
