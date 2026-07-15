import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AgentRunRequest,
  AgentRunResult,
} from "../../src/contracts/agent";
import { createCanonicalServerState } from "../../src/domain";
import { AGENT_PROMPT_VERSION } from "../../server/agent-prompt";
import { AgentServiceError } from "../../server/agent-service";
import { createJudgeApp } from "../../server/index";
import { createWorkspaceRepository } from "../../server/workspace-repository";
import { InMemoryWorkspaceDataSource } from "./fixtures/workspace-data-source";

const servers: Array<ReturnType<ReturnType<typeof createJudgeApp>["listen"]>> =
  [];

const result: AgentRunResult = {
  runId: "agent-run-1",
  draft: {
    englishText: "The clinic will contact you.",
    patientLanguage: "English",
    patientText: "The clinic will contact you.",
  },
  proposedAction: "reply",
  handoffReason: null,
  evidence: [],
  toolCalls: [],
  stopReason: "completed",
  usage: {
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
  },
  latencyMs: 250,
};

type AgentOption = {
  agentConfigVersion: string;
  run(
    request: AgentRunRequest,
    signal?: AbortSignal,
  ): Promise<AgentRunResult>;
};

async function configuredServer(options?: {
  agent?: AgentOption | null;
  agentTimeoutMs?: number;
  rateLimit?: {
    requests: number;
    windowMs: number;
  };
}) {
  const state = await createCanonicalServerState();
  const repository = createWorkspaceRepository(
    new InMemoryWorkspaceDataSource(),
  );
  await repository.bootstrap("demo", state);
  const run = vi.fn(async () => result);
  const app = createJudgeApp({
    agent:
      options && "agent" in options
        ? options.agent
        : {
            agentConfigVersion: "agent-config-test",
            run,
          },
    agentTimeoutMs: options?.agentTimeoutMs,
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
    baseUrl: `http://127.0.0.1:${address.port}`,
    run,
    state,
  };
}

function postRun(
  baseUrl: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}/api/agent/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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

describe("workspace-backed agent run endpoint", () => {
  it("builds one live request from current workspace and active Dream content", async () => {
    const { baseUrl, run, state } = await configuredServer();
    const conversation = state.conversations[0];
    const active = state.playbookHistory.versions.find(
      (version) =>
        version.id === state.playbookHistory.activeVersionId,
    );
    if (!conversation || !active) {
      throw new Error("Canonical state is missing runner inputs");
    }

    const response = await postRun(baseUrl, {
      kind: "manual",
      conversationId: conversation.id,
      expectedConversationRevision: conversation.revision,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(result);
    expect(run).toHaveBeenCalledWith(
      {
        mode: "live",
        conversation: {
          id: conversation.id,
          revision: conversation.revision,
          messages: conversation.messages,
        },
        patientContext: {
          preferredLanguage: conversation.patient.preferredLanguage,
        },
        bookingContext: conversation.booking ?? null,
        playbookBundle: {
          versions: active.files.map((file) => ({
            fileId: file.id,
            versionId: active.id,
            contentHash: file.contentHash,
            content: file.content,
          })),
          bundleHash: active.bundleHash,
        },
        agentConfigVersion: "agent-config-test",
        promptVersion: AGENT_PROMPT_VERSION,
        toolPolicyVersion: "demo-no-tools-v1",
      },
      expect.any(AbortSignal),
    );
  });

  it("rejects stale revisions and hidden generation fields before running", async () => {
    const { baseUrl, run, state } = await configuredServer();
    const conversation = state.conversations[0];
    if (!conversation) {
      throw new Error("Canonical state is missing a conversation");
    }

    const stale = await postRun(baseUrl, {
      kind: "manual",
      conversationId: conversation.id,
      expectedConversationRevision: conversation.revision + 1,
    });
    const hidden = await postRun(baseUrl, {
      kind: "manual",
      conversationId: conversation.id,
      expectedConversationRevision: conversation.revision,
      expectedHumanOutput: "Hidden answer",
    });

    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      code: "revision_conflict",
      retryable: true,
    });
    expect(hidden.status).toBe(400);
    await expect(hidden.json()).resolves.toMatchObject({
      code: "invalid_request",
      retryable: false,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("returns feature disabled when the provider is not configured", async () => {
    const { baseUrl, state } = await configuredServer({
      agent: null,
    });
    const conversation = state.conversations[0];
    if (!conversation) {
      throw new Error("Canonical state is missing a conversation");
    }

    const response = await postRun(baseUrl, {
      kind: "manual",
      conversationId: conversation.id,
      expectedConversationRevision: conversation.revision,
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "feature_disabled",
      retryable: false,
    });
  });

  it("normalizes the live kill switch through the HTTP boundary", async () => {
    const run = vi.fn(async () => {
      throw new AgentServiceError(
        "feature_disabled",
        "Live agent generation is disabled.",
        false,
      );
    });
    const { baseUrl, state } = await configuredServer({
      agent: {
        agentConfigVersion: "agent-config-test",
        run,
      },
    });
    const conversation = state.conversations[0];
    if (!conversation) {
      throw new Error("Canonical state is missing a conversation");
    }

    const response = await postRun(baseUrl, {
      kind: "manual",
      conversationId: conversation.id,
      expectedConversationRevision: conversation.revision,
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: "feature_disabled",
      error: "Live agent generation is disabled.",
      retryable: false,
    });
  });

  it("bounds the provider request with the agent timeout", async () => {
    const run = vi.fn(
      (_input: unknown, signal?: AbortSignal) =>
        new Promise<AgentRunResult>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const { baseUrl, state } = await configuredServer({
      agent: {
        agentConfigVersion: "agent-config-test",
        run,
      },
      agentTimeoutMs: 5,
    });
    const conversation = state.conversations[0];
    if (!conversation) {
      throw new Error("Canonical state is missing a conversation");
    }

    const response = await postRun(baseUrl, {
      kind: "manual",
      conversationId: conversation.id,
      expectedConversationRevision: conversation.revision,
    });

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      code: "provider_timeout",
      retryable: true,
    });
  });

  it("rate limits live generation before a second provider call", async () => {
    const { baseUrl, run, state } = await configuredServer({
      rateLimit: {
        requests: 1,
        windowMs: 60_000,
      },
    });
    const conversation = state.conversations[0];
    if (!conversation) {
      throw new Error("Canonical state is missing a conversation");
    }
    const body = {
      kind: "manual",
      conversationId: conversation.id,
      expectedConversationRevision: conversation.revision,
    };

    const first = await postRun(baseUrl, body);
    const second = await postRun(baseUrl, body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    await expect(second.json()).resolves.toMatchObject({
      code: "provider_failed",
      retryable: true,
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("returns route-neutral copy for malformed JSON", async () => {
    const { baseUrl } = await configuredServer();

    const response = await fetch(`${baseUrl}/api/agent/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "invalid_request",
      error: "API request is invalid.",
      retryable: false,
    });
  });
});
