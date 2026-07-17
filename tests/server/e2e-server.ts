import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import express from "express";

import {
  createCanonicalServerState,
  mergeTelegramInboundText,
} from "../../src/domain";
import type { AgentRunRequest } from "../../src/contracts/agent";
import { SCHEMA_VERSION } from "../../src/contracts/constants";
import type { JudgeRequest, JudgeResponse } from "../../src/contracts/judge";
import { DEFAULT_DEMO_SEED_KEY } from "../../server/bootstrap-demo";
import { createEvalService } from "../../server/eval-service";
import {
  assertWorkspaceMutationAllowed,
  createFactoryResetService,
} from "../../server/factory-reset-service";
import { createJudgeApp } from "../../server/index";
import type { ResetDemoWorkspaceResult } from "../../server/supabase";
import { createWorkspaceCommandService } from "../../server/workspace-command-service";
import { createWorkspaceRepository } from "../../server/workspace-repository";
import { endWorkspaceReset } from "../../server/workspace-reset-lock";
import type { GoogleCalendarService } from "../../server/google-calendar-service";
import type { VoiceArtifactStore } from "../../server/voice-artifact-store";
import { InMemoryWorkspaceDataSource } from "./fixtures/workspace-data-source";

const workspaceId = "e2e";
const dataSource = new InMemoryWorkspaceDataSource();
const repository = createWorkspaceRepository(dataSource, {
  mutationGuard: assertWorkspaceMutationAllowed,
});
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
  const bookingRequest = request.conversation.id === "convo-aircon-booking";
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
            summary: "Checked demo availability; waiting for the customer's preferred date and time.",
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
      fileId: "file-aircon-booking",
      oldText:
        "Collect symptoms, unit type, horsepower, unit count, area, preferred slot, and",
      newText:
        "Collect symptoms, unit type, horsepower, unit count, area, preferred slot, and verify the service address.",
      rationale: "Deterministic E2E proposal from committed train failure evidence.",
    };
  },
};

async function createE2eState() {
  const state = await createCanonicalServerState();
  state.corrections.push({
    id: "corr-aircon-selection",
    fileId: "file-aircon-service-selection",
    oldText: "For poor cooling and a musty smell, quote the RM99 general service.",
    newText:
      "If a wall-mounted 1.0-1.5 HP unit has both poor cooling and a musty smell, recommend the RM160 chemical wash. Do not quote the RM99 general service.",
    evidence: "Package selection train case failed.",
    status: "pending",
    sourceCaseId: "case-aircon-selection-train",
    lineHint: 4,
  });
  const telegramResult = mergeTelegramInboundText(state, {
    channel: "telegram",
    externalEventId: "e2e-factory-reset-inbound",
    externalConversationId: "-10042",
    externalMessageId: "88",
    sender: {
      externalId: "42",
      displayName: "Aina Zulkifli",
    },
    message: {
      kind: "text",
      text: "Boleh saya buat temujanji?",
      language: "ms",
    },
    receivedAt: "2026-07-13T12:00:00.000Z",
  });
  if (!telegramResult.ok) {
    throw new Error(telegramResult.error);
  }
  return telegramResult.state;
}

const e2eGoogleCalendar: GoogleCalendarService = {
  authorizationUrl: () => "https://example.com/oauth",
  completeAuthorization: async () => {},
  status: async () => ({
    calendarId: "primary",
    configured: true,
    mode: "google",
    status: "connected",
  }),
  syncBooking: async () => {},
  deleteMappedEvent: async () => {},
  deleteTrackedEvents: async () => {},
};

await repository.bootstrap(workspaceId, await createE2eState());

const voiceArtifactStore: VoiceArtifactStore = {
  download: async () => new Uint8Array(),
  upload: async (objectPath) => ({
    objectPath,
    contentType: "audio/ogg",
    sha256: "e2e-voice-artifact",
  }),
  clearWorkspace: async () => {},
};

async function resetWorkspaceInMemory(
  resetWorkspaceId: string,
  seedKey: string,
  expectedRevision: number,
): Promise<ResetDemoWorkspaceResult> {
  const current = await repository.load(resetWorkspaceId);
  if (!current) {
    throw new Error(`Workspace ${resetWorkspaceId} not found.`);
  }
  if (current.revision !== expectedRevision) {
    return {
      ok: false,
      code: "revision_conflict",
      workspace: current,
    };
  }
  const canonical = await createCanonicalServerState();
  const updated = await dataSource.updateIfRevision(
    {
      workspaceId: resetWorkspaceId,
      schemaVersion: SCHEMA_VERSION,
      revision: expectedRevision + 1,
      state: canonical,
    },
    expectedRevision,
  );
  if (!updated) {
    return {
      ok: false,
      code: "revision_conflict",
      workspace: current,
    };
  }
  return {
    ok: true,
    workspace: {
      workspaceId: updated.workspaceId,
      revision: updated.revision,
      state: updated.state,
    },
    summary: {
      seedKey,
      previousRevision: expectedRevision,
      newRevision: updated.revision,
      outboxRowsRemoved: 0,
      googleEventsRemoved: 0,
      calendarDeliveriesRemoved: 0,
      telegramDeliveriesRemoved: 0,
      telegramEventsRemoved: 0,
      oauthPreserved: true,
    },
  };
}

const factoryReset = createFactoryResetService({
  workspaceId,
  seedKey: DEFAULT_DEMO_SEED_KEY,
  workspaceRepository: repository,
  loadCompiledSeed: async () => createCanonicalServerState(),
  resetDataSource: { reset: resetWorkspaceInMemory },
  voiceArtifactStore,
  googleCalendar: e2eGoogleCalendar,
});

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
    createCanonicalState: createE2eState,
  },
  workflow: createWorkspaceCommandService({
    workspaceId,
    repository,
    evalService,
    createId: randomUUID,
    now: () => new Date().toISOString(),
    proposer: deterministicProposer,
  }),
  factoryReset,
  googleCalendar: e2eGoogleCalendar,
});
app.post("/api/e2e/reset", async (_request, response) => {
  endWorkspaceReset(workspaceId);
  dataSource.records.clear();
  suiteSequence = 0;
  runSequence = 0;
  await repository.bootstrap(workspaceId, await createE2eState());
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
