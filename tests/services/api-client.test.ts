import { describe, expect, it, vi } from "vitest";

import type { AgentRunCreateRequest } from "../../src/contracts/agent";
import type { OutboundSendRequest } from "../../src/contracts/api";
import type {
  EvalCaseRunRequest,
  EvalSuiteCreateRequest,
} from "../../src/contracts/eval";
import { createCanonicalServerState } from "../../src/domain";
import {
  ApiClientError,
  createHttpAgentClient,
  createHttpEvalClient,
  createHttpTelegramOutboundClient,
  createHttpWorkspaceClient,
} from "../../src/services/api-client";

const sendRequest: OutboundSendRequest = {
  requestId: "send-42",
  conversationId: "telegram-conversation:-10042",
  expectedConversationRevision: 1,
  targetLanguage: "Malay",
  approvedPatientText: "Klinik akan menghubungi anda.",
  mode: "text",
};

const agentRequest: AgentRunCreateRequest = {
  kind: "manual",
  conversationId: "conv-emergency",
  expectedConversationRevision: 1,
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
  evidence: [],
  toolCalls: [],
  stopReason: "completed" as const,
  usage: {
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
  },
  latencyMs: 250,
};

const evalSuiteRequest: EvalSuiteCreateRequest = {
  datasetId: "dataset-seed",
  caseIds: ["case-emergency-train"],
  playbookVersionId: "playbook-version-1",
  expectedWorkspaceRevision: 1,
};

const evalCaseRequest: EvalCaseRunRequest = {
  suiteId: "suite-1",
  caseId: "case-emergency-train",
  expectedWorkspaceRevision: 2,
};

describe("HTTP workspace client", () => {
  it("loads and validates the fixed workspace envelope", async () => {
    const envelope = {
      workspaceId: "demo",
      revision: 3,
      state: await createCanonicalServerState(),
    };
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(envelope), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(createHttpWorkspaceClient(fetcher).load()).resolves.toEqual(
      envelope,
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/api/workspace/state",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("requests a revisioned synthetic reset and validates the saved workspace", async () => {
    const workspace = {
      workspaceId: "demo",
      revision: 4,
      state: await createCanonicalServerState(),
    };
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, workspace }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      createHttpWorkspaceClient(fetcher).reset!(3),
    ).resolves.toEqual({ ok: true, workspace });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/demo/reset",
      expect.objectContaining({
        body: JSON.stringify({ expectedRevision: 3 }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
  });

  it("returns the current workspace when a synthetic reset loses revision CAS", async () => {
    const workspace = {
      workspaceId: "demo",
      revision: 5,
      state: await createCanonicalServerState(),
    };
    const client = createHttpWorkspaceClient(
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: false,
            code: "revision_conflict",
            workspace,
          }),
          {
            status: 409,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    await expect(client.reset!(4)).resolves.toEqual({
      ok: false,
      code: "revision_conflict",
      workspace,
    });
  });

  it("returns a typed feature-disabled error without replacing local state", async () => {
    const client = createHttpWorkspaceClient(
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "feature_disabled",
            error: "Workspace persistence is not configured.",
            retryable: false,
          }),
          {
            status: 503,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    await expect(client.load()).rejects.toMatchObject({
      code: "feature_disabled",
      retryable: false,
    });
  });
});

describe("HTTP agent client", () => {
  it("posts a strict run request and validates the draft result", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(agentResult), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      createHttpAgentClient(fetcher).run(agentRequest),
    ).resolves.toEqual(agentResult);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/agent/runs",
      expect.objectContaining({
        body: JSON.stringify(agentRequest),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
  });

  it("preserves normalized timeout errors and rejects invalid success bodies", async () => {
    const timeout = createHttpAgentClient(
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "provider_timeout",
            error: "The agent request timed out.",
            retryable: true,
          }),
          {
            status: 504,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );
    await expect(timeout.run(agentRequest)).rejects.toMatchObject({
      code: "provider_timeout",
      retryable: true,
    });

    const malformed = createHttpAgentClient(
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ draft: "private raw output" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(malformed.run(agentRequest)).rejects.toMatchObject({
      code: "provider_failed",
      retryable: true,
    });
  });
});

describe("HTTP Eval client", () => {
  it("freezes a suite then runs one strict case request", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            suiteId: "suite-1",
            manifestHash: "a".repeat(64),
            workspaceRevision: 2,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            suiteId: "suite-1",
            caseId: "case-emergency-train",
            attempt: 1,
            status: "committed",
            evalRunId: "eval-run-1",
            workspaceRevision: 3,
          }),
          { status: 200 },
        ),
      );
    const client = createHttpEvalClient(fetcher);

    await expect(
      client.createSuite(evalSuiteRequest),
    ).resolves.toMatchObject({
      suiteId: "suite-1",
      workspaceRevision: 2,
    });
    await expect(
      client.runCase(evalCaseRequest),
    ).resolves.toMatchObject({
      evalRunId: "eval-run-1",
      workspaceRevision: 3,
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/eval/suites/suite-1/cases/case-emergency-train/run",
      expect.objectContaining({
        body: JSON.stringify(evalCaseRequest),
        method: "POST",
      }),
    );
  });

  it("preserves revision conflicts and rejects malformed results", async () => {
    const conflict = createHttpEvalClient(
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "revision_conflict",
            error: "Workspace revision is stale.",
            retryable: true,
          }),
          { status: 409 },
        ),
      ),
    );
    await expect(
      conflict.createSuite(evalSuiteRequest),
    ).rejects.toMatchObject({
      code: "revision_conflict",
      retryable: true,
    });

    const malformed = createHttpEvalClient(
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ suiteId: "private" }), {
          status: 200,
        }),
      ),
    );
    await expect(
      malformed.runCase(evalCaseRequest),
    ).rejects.toMatchObject({
      code: "provider_failed",
      retryable: true,
    });
  });
});

describe("HTTP Telegram outbound client", () => {
  it("posts exact visitor-approved text and validates provider acceptance", async () => {
    const result = {
      deliveryIds: ["send-42"],
      status: "sent",
      text: {
        providerMessageId: "9001",
        acceptedAt: "2026-07-13T12:01:00.000Z",
      },
    };
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      createHttpTelegramOutboundClient(fetcher).send(sendRequest),
    ).resolves.toEqual(result);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/outbound/send",
      expect.objectContaining({
        body: JSON.stringify(sendRequest),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
  });

  it("returns a valid provider failure for an explicit retry", async () => {
    const result = {
      deliveryIds: ["send-42"],
      status: "failed",
      failedParts: ["text"],
    };
    const client = createHttpTelegramOutboundClient(
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(result), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(client.send(sendRequest)).resolves.toEqual(result);
  });

  it("reconciles provider-accepted text without another send request", async () => {
    const result = {
      deliveryId: "send-42",
      workspaceSyncStatus: "synced",
      workspaceRevision: 2,
    };
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createHttpTelegramOutboundClient(fetcher);

    await expect(
      client.reconcile("send-42", {
        expectedConversationRevision: 1,
      }),
    ).resolves.toEqual(result);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/outbound/deliveries/send-42/reconcile",
      expect.objectContaining({
        body: JSON.stringify({
          expectedConversationRevision: 1,
        }),
        method: "POST",
      }),
    );
  });

  it("maps bounded API errors and rejects malformed success bodies", async () => {
    const conflict = createHttpTelegramOutboundClient(
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "revision_conflict",
            error: "Conversation changed before Telegram send.",
            retryable: true,
          }),
          {
            status: 409,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );
    await expect(conflict.send(sendRequest)).rejects.toMatchObject({
      code: "revision_conflict",
      retryable: true,
    });

    const malformed = createHttpTelegramOutboundClient(
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ provider: "private detail" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const error = await malformed
      .send(sendRequest)
      .catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      code: "provider_failed",
      retryable: true,
    });
  });
});
