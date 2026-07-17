import { describe, expect, it, vi } from "vitest";

import {
  AUTONOMOUS_BOOKING_TOOL_POLICY_VERSION,
  type AgentRunRequest,
} from "../../src/contracts/agent";
import {
  createAgentService,
  AgentServiceError,
} from "../../server/agent-service";
import {
  AGENT_INSTRUCTIONS,
  AGENT_JSON_SCHEMA,
  AGENT_PROMPT_VERSION,
} from "../../server/agent-prompt";

const hash = "c".repeat(64);
const request = {
  mode: "live",
  conversation: {
    id: "conversation-1",
    revision: 2,
    messages: [
      {
        id: "message-1",
        role: "patient",
        text: "Boleh saya buat temujanji?",
        language: "Malay",
        sentAt: "2026-07-13T12:00:00.000Z",
      },
    ],
  },
  patientContext: {
    preferredLanguage: "Malay",
  },
  bookingContext: null,
  playbookBundle: {
    versions: [
      {
        fileId: "playbook-booking",
        versionId: "playbook-version-1",
        contentHash: hash,
        content: "Confirm the requested date before booking.",
      },
    ],
    bundleHash: hash,
  },
  agentConfigVersion: "agent-config-1",
  promptVersion: AGENT_PROMPT_VERSION,
  toolPolicyVersion: "demo-no-tools-v1",
} satisfies AgentRunRequest;

const providerResult = {
  draft: {
    englishText: "The clinic will contact you to confirm.",
    patientLanguage: "Malay",
    patientText: "Klinik akan menghubungi anda untuk pengesahan.",
  },
  proposedAction: "reply",
  handoffReason: null,
  evidence: [
    {
      fileId: "playbook-booking",
      versionId: "playbook-version-1",
      contentHash: hash,
      excerpt: "Confirm the requested date before booking.",
    },
  ],
} as const;

describe("shared agent service", () => {
  it("tells sandbox Eval runs to answer without requesting autonomous tools", async () => {
    const createResponse = vi.fn(async () => ({
      outputText: JSON.stringify(providerResult),
      usage: {
        inputTokens: 20,
        outputTokens: 10,
        totalTokens: 30,
      },
    }));
    const runAgentTurn = createAgentService({
      createResponse,
      liveEnabled: true,
      model: "agent-model",
      createRunId: () => "agent-run-sandbox",
    });

    await expect(
      runAgentTurn({ ...request, mode: "sandbox" }),
    ).resolves.toMatchObject({ runId: "agent-run-sandbox" });
    expect(createResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining(
          "This is an evaluation replay. Do not request or call tools.",
        ),
        tools: [],
        toolChoice: "none",
      }),
      undefined,
    );
  });

  it("retries one malformed sandbox result without weakening structured output validation", async () => {
    const createResponse = vi
      .fn()
      .mockResolvedValueOnce({
        outputText: '{"draft":',
        usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
      })
      .mockResolvedValueOnce({
        outputText: JSON.stringify(providerResult),
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      });
    const runAgentTurn = createAgentService({
      createResponse,
      liveEnabled: true,
      model: "agent-model",
      createRunId: () => "agent-run-sandbox-retry",
    });

    await expect(
      runAgentTurn({ ...request, mode: "sandbox" }),
    ).resolves.toMatchObject({ runId: "agent-run-sandbox-retry" });
    expect(createResponse).toHaveBeenCalledTimes(2);
  });

  it("does not duplicate a malformed live provider call", async () => {
    const createResponse = vi.fn(async () => ({
      outputText: '{"draft":',
      usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
    }));
    const runAgentTurn = createAgentService({
      createResponse,
      liveEnabled: true,
      model: "agent-model",
      createRunId: () => "agent-run-live-invalid",
    });

    await expect(runAgentTurn(request)).rejects.toMatchObject({
      code: "provider_failed",
      retryable: true,
    });
    expect(createResponse).toHaveBeenCalledTimes(1);
  });

  it("runs one no-tools turn and returns server-owned evidence", async () => {
    const createResponse = vi.fn(async () => ({
      model: "provider-model",
      outputText: JSON.stringify(providerResult),
      usage: {
        inputTokens: 100,
        outputTokens: 30,
        totalTokens: 130,
      },
    }));
    const runAgentTurn = createAgentService({
      createResponse,
      liveEnabled: true,
      model: "agent-model",
      createRunId: () => "agent-run-1",
      now: vi
        .fn()
        .mockReturnValueOnce(1_000)
        .mockReturnValueOnce(1_420),
    });

    const controller = new AbortController();
    await expect(
      runAgentTurn(request, controller.signal),
    ).resolves.toEqual({
      runId: "agent-run-1",
      ...providerResult,
      toolCalls: [],
      stopReason: "completed",
      usage: {
        inputTokens: 100,
        outputTokens: 30,
        totalTokens: 130,
      },
      latencyMs: 420,
    });
    expect(createResponse).toHaveBeenCalledWith(
      {
        model: "agent-model",
        instructions: AGENT_INSTRUCTIONS,
        input: expect.stringContaining("<playbook_bundle>"),
        text: {
          format: {
            type: "json_schema",
            name: "kaunter_agent_result",
            strict: true,
            schema: AGENT_JSON_SCHEMA,
          },
        },
        tools: [],
        toolChoice: "none",
      },
      controller.signal,
    );
  });

  it("derives a handoff stop reason without exposing a tool call", async () => {
    const createResponse = vi.fn(async () => ({
      outputText: JSON.stringify({
        ...providerResult,
        proposedAction: "staff_handoff",
        handoffReason: "A clinician must review this request.",
      }),
      usage: {
        inputTokens: 50,
        outputTokens: 20,
        totalTokens: 70,
      },
    }));
    const runAgentTurn = createAgentService({
      createResponse,
      liveEnabled: true,
      model: "agent-model",
      createRunId: () => "agent-run-2",
    });

    await expect(runAgentTurn(request)).resolves.toMatchObject({
      proposedAction: "staff_handoff",
      handoffReason: "A clinician must review this request.",
      stopReason: "handoff",
      toolCalls: [],
    });
  });

  it("continues a real function-call loop and exposes only an audited action trace", async () => {
    const createResponse = vi
      .fn()
      .mockResolvedValueOnce({
        responseId: "response-1",
        outputText: "",
        toolCalls: [
          {
            callId: "call-1",
            name: "list_available_slots",
            argumentsJson: '{"date":null}',
          },
        ],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      })
      .mockResolvedValueOnce({
        outputText: JSON.stringify(providerResult),
        usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
      });
    const toolExecutor = vi.fn(async () => ({
      status: "completed" as const,
      summary: "Found 2 available slots.",
      conversationRevision: null,
      output: {
        success: true,
        action: "availability_listed",
        slots: [],
      },
    }));
    const runAgentTurn = createAgentService({
      createResponse,
      liveEnabled: true,
      model: "agent-model",
      toolExecutor,
      tools: [
        {
          type: "function",
          name: "list_available_slots",
          description: "Find slots",
          strict: true,
          parameters: { type: "object" },
        },
      ],
      createRunId: () => "agent-run-tool-loop",
    });

    await expect(
      runAgentTurn({
        ...request,
        toolPolicyVersion: AUTONOMOUS_BOOKING_TOOL_POLICY_VERSION,
      }),
    ).resolves.toMatchObject({
      runId: "agent-run-tool-loop",
      toolCalls: [
        {
          callId: "call-1",
          name: "list_available_slots",
          status: "completed",
          summary: "Found 2 available slots.",
          conversationRevision: null,
        },
      ],
      usage: { inputTokens: 18, outputTokens: 9, totalTokens: 27 },
    });
    expect(toolExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        call: expect.objectContaining({ callId: "call-1" }),
      }),
    );
    expect(createResponse).toHaveBeenLastCalledWith(
      expect.objectContaining({
        previousResponseId: "response-1",
        toolOutputs: [
          expect.objectContaining({
            callId: "call-1",
            output: expect.stringContaining('"success":true'),
          }),
        ],
      }),
      undefined,
    );
  });

  it("turns a Calendar availability handoff into a customer-safe reply", async () => {
    const fallback = {
      ...providerResult,
      draft: {
        englishText:
          "I cannot confirm a time yet. Could you confirm the unit horsepower?",
        patientLanguage: "Malay",
        patientText:
          "Saya belum dapat mengesahkan masa. Boleh sahkan kuasa kuda unit?",
      },
    };
    const createResponse = vi
      .fn()
      .mockResolvedValueOnce({
        responseId: "response-calendar-1",
        outputText: "",
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
        toolCalls: [
          {
            callId: "call-calendar-1",
            name: "list_available_slots",
            argumentsJson: '{"date":null}',
          },
        ],
      })
      .mockResolvedValueOnce({
        outputText: JSON.stringify({
          ...providerResult,
          proposedAction: "staff_handoff",
          handoffReason: "Google Calendar is disconnected.",
        }),
        usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
      })
      .mockResolvedValueOnce({
        outputText: JSON.stringify(fallback),
        usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
      });
    const runAgentTurn = createAgentService({
      createResponse,
      liveEnabled: true,
      model: "agent-model",
      toolExecutor: vi.fn().mockResolvedValue({
        status: "failed",
        summary: "Live availability is temporarily unavailable.",
        conversationRevision: null,
        output: {
          success: false,
          error_type: "provider_failed",
          message: "Live availability is temporarily unavailable.",
          reason_code: "availability_unavailable",
          suggestion:
            "Tell the customer a time cannot be confirmed yet, continue collecting service details, and remain active.",
        },
      }),
      tools: [
        {
          type: "function",
          name: "list_available_slots",
          description: "Find slots",
          strict: true,
          parameters: { type: "object" },
        },
      ],
      createRunId: () => "agent-run-calendar-recovery",
    });

    await expect(
      runAgentTurn({
        ...request,
        toolPolicyVersion: AUTONOMOUS_BOOKING_TOOL_POLICY_VERSION,
      }),
    ).resolves.toMatchObject({
      proposedAction: "reply",
      handoffReason: null,
      draft: fallback.draft,
      stopReason: "completed",
    });
    expect(createResponse).toHaveBeenCalledTimes(3);
    expect(createResponse).toHaveBeenLastCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining(
          "Do not mention Calendar configuration and do not hand off",
        ),
        tools: [],
        toolChoice: "none",
      }),
      undefined,
    );
  });

  it("preserves a non-availability handoff when availability also failed", async () => {
    const safetyHandoff = {
      ...providerResult,
      proposedAction: "staff_handoff" as const,
      handoffReason: "Customer reported exposed electrical wiring.",
    };
    const createResponse = vi
      .fn()
      .mockResolvedValueOnce({
        responseId: "response-safety-1",
        outputText: "",
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
        toolCalls: [
          {
            callId: "call-safety-1",
            name: "list_available_slots",
            argumentsJson: '{"date":null}',
          },
        ],
      })
      .mockResolvedValueOnce({
        outputText: JSON.stringify(safetyHandoff),
        usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
      })
      .mockResolvedValueOnce({
        outputText: JSON.stringify(providerResult),
        usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
      });
    const runAgentTurn = createAgentService({
      createResponse,
      liveEnabled: true,
      model: "agent-model",
      toolExecutor: vi.fn().mockResolvedValue({
        status: "failed",
        summary: "Live availability is temporarily unavailable.",
        conversationRevision: null,
        output: {
          success: false,
          error_type: "provider_failed",
          message: "Live availability is temporarily unavailable.",
          reason_code: "availability_unavailable",
        },
      }),
      tools: [
        {
          type: "function",
          name: "list_available_slots",
          description: "Find slots",
          strict: true,
          parameters: { type: "object" },
        },
      ],
      createRunId: () => "agent-run-safety-handoff",
    });

    await expect(
      runAgentTurn({
        ...request,
        toolPolicyVersion: AUTONOMOUS_BOOKING_TOOL_POLICY_VERSION,
      }),
    ).resolves.toMatchObject({
      proposedAction: "staff_handoff",
      handoffReason: safetyHandoff.handoffReason,
      stopReason: "handoff",
    });
    expect(createResponse).toHaveBeenCalledTimes(2);
  });

  it("exposes a server-created feedback Eval candidate in the action trace", async () => {
    const createResponse = vi
      .fn()
      .mockResolvedValueOnce({
        responseId: "response-feedback-1",
        outputText: "",
        toolCalls: [
          {
            callId: "call-feedback-1",
            name: "flag_autonomous_action_wrong",
            argumentsJson: '{"reason":"Wrong date"}',
          },
        ],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      })
      .mockResolvedValueOnce({
        outputText: JSON.stringify(providerResult),
        usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
      });
    const runAgentTurn = createAgentService({
      createResponse,
      liveEnabled: true,
      model: "agent-model",
      toolExecutor: vi.fn().mockResolvedValue({
        status: "completed",
        summary: "Autonomous agent flagged patient feedback as Eval candidate case-agent-feedback-1.",
        conversationRevision: 3,
        output: {
          success: true,
          action: "feedback_flagged",
          evalCaseId: "case-agent-feedback-1",
        },
      }),
      tools: [
        {
          type: "function",
          name: "flag_autonomous_action_wrong",
          description: "Flag feedback",
          strict: true,
          parameters: { type: "object" },
        },
      ],
      createRunId: () => "agent-run-feedback",
    });

    await expect(
      runAgentTurn({
        ...request,
        toolPolicyVersion: AUTONOMOUS_BOOKING_TOOL_POLICY_VERSION,
      }),
    ).resolves.toMatchObject({
      toolCalls: [
        expect.objectContaining({ evalCaseId: "case-agent-feedback-1" }),
      ],
    });
  });

  it("rejects evidence not grounded in the pinned Knowledge bundle", async () => {
    const createResponse = vi.fn(async () => ({
      outputText: JSON.stringify({
        ...providerResult,
        evidence: [
          {
            ...providerResult.evidence[0],
            excerpt: "Text that is not in the pinned playbook.",
          },
        ],
      }),
      usage: {
        inputTokens: 50,
        outputTokens: 20,
        totalTokens: 70,
      },
    }));
    const runAgentTurn = createAgentService({
      createResponse,
      liveEnabled: true,
      model: "agent-model",
      createRunId: () => "agent-run-3",
    });

    await expect(runAgentTurn(request)).rejects.toMatchObject({
      code: "provider_failed",
      retryable: true,
      message: "Agent evidence is not present in the pinned playbook.",
    });
  });

  it("rejects evidence with the wrong pinned identity", async () => {
    const createResponse = vi.fn(async () => ({
      outputText: JSON.stringify({
        ...providerResult,
        evidence: [
          {
            ...providerResult.evidence[0],
            versionId: "different-version",
          },
        ],
      }),
      usage: {
        inputTokens: 50,
        outputTokens: 20,
        totalTokens: 70,
      },
    }));
    const runAgentTurn = createAgentService({
      createResponse,
      liveEnabled: true,
      model: "agent-model",
      createRunId: () => "agent-run-identity",
    });

    await expect(runAgentTurn(request)).rejects.toMatchObject({
      code: "provider_failed",
      retryable: true,
      message: "Agent evidence is not present in the pinned playbook.",
    });
  });

  it("blocks live runs when the live-agent kill switch is off", async () => {
    const createResponse = vi.fn();
    const runAgentTurn = createAgentService({
      createResponse,
      liveEnabled: false,
      model: "agent-model",
      createRunId: () => "agent-run-disabled",
    });

    await expect(runAgentTurn(request)).rejects.toMatchObject({
      code: "feature_disabled",
      retryable: false,
      message: "Live agent generation is disabled.",
    });
    expect(createResponse).not.toHaveBeenCalled();
  });

  it("rejects malformed output and missing usage without inventing evidence", async () => {
    const malformed = createAgentService({
      createResponse: async () => ({
        outputText: '{"draft":',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
        },
      }),
      liveEnabled: true,
      model: "agent-model",
      createRunId: () => "agent-run-4",
    });
    const missingUsage = createAgentService({
      createResponse: async () => ({
        outputText: JSON.stringify(providerResult),
      }),
      liveEnabled: true,
      model: "agent-model",
      createRunId: () => "agent-run-5",
    });

    await expect(malformed(request)).rejects.toBeInstanceOf(
      AgentServiceError,
    );
    await expect(malformed(request)).rejects.toMatchObject({
      code: "provider_failed",
      retryable: true,
    });
    await expect(missingUsage(request)).rejects.toMatchObject({
      code: "provider_failed",
      retryable: true,
      message: "Agent response did not include token usage.",
    });
  });

  it("normalizes prompt-pin and result-evidence validation failures", async () => {
    const createResponse = vi.fn(async () => ({
      outputText: JSON.stringify(providerResult),
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 999,
      },
    }));
    const runAgentTurn = createAgentService({
      createResponse,
      liveEnabled: true,
      model: "agent-model",
      createRunId: () => "agent-run-invalid",
    });

    await expect(
      runAgentTurn({
        ...request,
        promptVersion: "stale-agent-prompt",
      }),
    ).rejects.toMatchObject({
      code: "provider_failed",
      retryable: false,
      message: "Agent prompt configuration is invalid.",
    });
    await expect(runAgentTurn(request)).rejects.toMatchObject({
      code: "provider_failed",
      retryable: true,
      message: "Agent run evidence is invalid.",
    });
  });
});
