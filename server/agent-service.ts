import { randomUUID } from "node:crypto";

import {
  AUTONOMOUS_BOOKING_TOOL_POLICY_VERSION,
  agentRunRequestSchema,
  agentRunResultSchema,
  providerAgentResultSchema,
  type AgentToolCall,
  type AgentRunRequest,
  type AgentRunResult,
  type ProviderAgentResult,
} from "../src/contracts/agent";
import type { ApiErrorCode } from "../src/contracts/api";
import {
  buildAgentPrompt,
  type AGENT_JSON_SCHEMA,
} from "./agent-prompt";

export type AgentProviderFunctionTool = {
  type: "function";
  name: string;
  description: string;
  strict: true;
  parameters: Record<string, unknown>;
};

export type AgentProviderToolCall = {
  callId: string;
  name: string;
  argumentsJson: string;
};

export type AgentProviderToolOutput = {
  callId: string;
  output: string;
};

export type AgentProviderToolRound = {
  calls: AgentProviderToolCall[];
  outputs: AgentProviderToolOutput[];
};

export type AgentProviderCreateInput = {
  model: string;
  instructions: string;
  input: string;
  text: {
    format: {
      type: "json_schema";
      name: "kaunter_agent_result";
      strict: true;
      schema: typeof AGENT_JSON_SCHEMA;
    };
  };
  tools: AgentProviderFunctionTool[];
  toolChoice: "auto" | "none";
  previousResponseId?: string;
  toolOutputs?: AgentProviderToolOutput[];
  toolHistory?: AgentProviderToolRound[];
};

export type AgentProviderCreateOutput = {
  model?: string;
  outputText: string;
  responseId?: string;
  toolCalls?: AgentProviderToolCall[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

export type CreateAgentProviderResponse = (
  input: AgentProviderCreateInput,
  signal?: AbortSignal,
) => Promise<AgentProviderCreateOutput>;

export type AgentToolExecution = {
  conversationRevision: number | null;
  output: unknown;
  status: "completed" | "failed";
  summary: string;
};

export type AgentToolExecutor = (input: {
  call: AgentProviderToolCall;
  request: AgentRunRequest;
}) => Promise<AgentToolExecution>;

type AgentServiceOptions = {
  createResponse: CreateAgentProviderResponse;
  toolExecutor?: AgentToolExecutor;
  tools?: AgentProviderFunctionTool[];
  liveEnabled: boolean;
  model: string;
  createRunId?: () => string;
  now?: () => number;
};

export class AgentServiceError extends Error {
  readonly code: Extract<
    ApiErrorCode,
    "feature_disabled" | "provider_failed"
  >;
  readonly retryable: boolean;

  constructor(
    code: Extract<
      ApiErrorCode,
      "feature_disabled" | "provider_failed"
    >,
    message: string,
    retryable: boolean,
  ) {
    super(message);
    this.name = "AgentServiceError";
    this.code = code;
    this.retryable = retryable;
  }
}

function parseProviderResult(outputText: string): ProviderAgentResult {
  try {
    return providerAgentResultSchema.parse(JSON.parse(outputText));
  } catch {
    throw new AgentServiceError(
      "provider_failed",
      "Agent provider returned invalid structured output.",
      true,
    );
  }
}

function hasTemporaryAvailabilityFailure(
  rounds: AgentProviderToolRound[],
): boolean {
  return rounds.some((round) =>
    round.calls.some((call) => {
      if (
        call.name !== "list_available_slots" &&
        call.name !== "create_booking" &&
        call.name !== "reschedule_booking"
      ) {
        return false;
      }
      const output = round.outputs.find(
        (candidate) => candidate.callId === call.callId,
      );
      if (!output) return false;
      try {
        const parsed = JSON.parse(output.output) as Record<string, unknown>;
        return (
          parsed.success === false &&
          parsed.error_type === "provider_failed" &&
          parsed.reason_code === "availability_unavailable"
        );
      } catch {
        return false;
      }
    }),
  );
}

function isAvailabilityFailureHandoff(result: ProviderAgentResult): boolean {
  const reason = result.handoffReason?.toLowerCase() ?? "";
  return (
    reason.includes("calendar") ||
    (reason.includes("availability") &&
      ["disconnected", "failed", "not connected", "unavailable"].some(
        (term) => reason.includes(term),
      ))
  );
}

function validateEvidence(
  request: AgentRunRequest,
  result: ProviderAgentResult,
): void {
  const pinnedVersions = new Map(
    request.playbookBundle.versions.map((version) => [
      `${version.fileId}\u0000${version.versionId}\u0000${version.contentHash}`,
      version.content,
    ]),
  );

  for (const evidence of result.evidence) {
    const content = pinnedVersions.get(
      `${evidence.fileId}\u0000${evidence.versionId}\u0000${evidence.contentHash}`,
    );
    if (!content || !content.includes(evidence.excerpt)) {
      throw new AgentServiceError(
        "provider_failed",
        "Agent evidence is not present in the pinned playbook.",
        true,
      );
    }
  }
}

function normalizeSandboxEvidencePins(
  request: AgentRunRequest,
  result: ProviderAgentResult,
): ProviderAgentResult {
  if (request.mode !== "sandbox") return result;
  const pinnedByFileId = new Map(
    request.playbookBundle.versions.map((version) => [version.fileId, version]),
  );
  return {
    ...result,
    evidence: result.evidence.map((item) => {
      const pinned = pinnedByFileId.get(item.fileId);
      return pinned?.content.includes(item.excerpt)
        ? {
            ...item,
            versionId: pinned.versionId,
            contentHash: pinned.contentHash,
          }
        : item;
    }),
  };
}

const MAX_TOOL_ROUNDS = 4;
const MAX_TOOL_CALLS = 8;

function addUsage(
  total: { inputTokens: number; outputTokens: number; totalTokens: number },
  usage: AgentProviderCreateOutput["usage"],
): { inputTokens: number; outputTokens: number; totalTokens: number } {
  if (!usage) {
    throw new AgentServiceError(
      "provider_failed",
      "Agent response did not include token usage.",
      true,
    );
  }
  return {
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    totalTokens: total.totalTokens + usage.totalTokens,
  };
}

function toolTrace(
  call: AgentProviderToolCall,
  execution: AgentToolExecution,
): AgentToolCall {
  const evalCaseId =
    typeof execution.output === "object" &&
    execution.output !== null &&
    "evalCaseId" in execution.output &&
    typeof execution.output.evalCaseId === "string"
      ? execution.output.evalCaseId
      : undefined;
  return {
    callId: call.callId,
    name: call.name,
    status: execution.status,
    summary: execution.summary,
    conversationRevision: execution.conversationRevision,
    ...(evalCaseId ? { evalCaseId } : {}),
  };
}

export function createAgentService({
  createResponse,
  toolExecutor,
  tools = [],
  liveEnabled,
  model,
  createRunId = randomUUID,
  now = Date.now,
}: AgentServiceOptions) {
  return async (
    input: AgentRunRequest,
    signal?: AbortSignal,
  ): Promise<AgentRunResult> => {
    const request = agentRunRequestSchema.parse(input);
    if (request.mode === "live" && !liveEnabled) {
      throw new AgentServiceError(
        "feature_disabled",
        "Live agent generation is disabled.",
        false,
      );
    }
    let prompt: ReturnType<typeof buildAgentPrompt>;
    try {
      prompt = buildAgentPrompt(request);
    } catch {
      throw new AgentServiceError(
        "provider_failed",
        "Agent prompt configuration is invalid.",
        false,
      );
    }
    const startedAt = now();
    const allowTools =
      request.mode === "live" &&
      request.toolPolicyVersion === AUTONOMOUS_BOOKING_TOOL_POLICY_VERSION &&
      toolExecutor !== undefined &&
      tools.length > 0;
    const configuredTools = allowTools ? tools : [];
    const toolChoice = allowTools ? ("auto" as const) : ("none" as const);
    const baseInput = {
      model,
      instructions: prompt.instructions,
      input: prompt.input,
      text: {
        format: {
          type: "json_schema" as const,
          name: "kaunter_agent_result" as const,
          strict: true as const,
          schema: prompt.outputSchema,
        },
      },
      tools: configuredTools,
      toolChoice,
    };
    let response = await createResponse(baseInput, signal);
    let usage = addUsage(
      { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      response.usage,
    );
    const traces: AgentToolCall[] = [];
    const toolHistory: AgentProviderToolRound[] = [];

    for (let round = 0; response.toolCalls?.length; round += 1) {
      if (!allowTools || !toolExecutor) {
        throw new AgentServiceError(
          "provider_failed",
          "Agent requested a tool outside its active tool policy.",
          false,
        );
      }
      if (!response.responseId) {
        throw new AgentServiceError(
          "provider_failed",
          "Agent provider did not return a response ID for tool continuation.",
          true,
        );
      }
      if (round >= MAX_TOOL_ROUNDS || traces.length + response.toolCalls.length > MAX_TOOL_CALLS) {
        throw new AgentServiceError(
          "provider_failed",
          "Agent exceeded the autonomous tool-call limit.",
          false,
        );
      }

      const outputs: AgentProviderToolOutput[] = [];
      for (const call of response.toolCalls) {
        const execution = await toolExecutor({ call, request });
        traces.push(toolTrace(call, execution));
        outputs.push({
          callId: call.callId,
          output: JSON.stringify(execution.output),
        });
      }
      toolHistory.push({ calls: response.toolCalls, outputs });
      response = await createResponse(
        {
          ...baseInput,
          previousResponseId: response.responseId,
          toolHistory,
          toolOutputs: outputs,
        },
        signal,
      );
      usage = addUsage(usage, response.usage);
    }

    let providerResult: ProviderAgentResult;
    try {
      providerResult = parseProviderResult(response.outputText);
    } catch (error) {
      if (
        request.mode !== "sandbox" ||
        !(error instanceof AgentServiceError) ||
        error.code !== "provider_failed"
      ) {
        throw error;
      }
      response = await createResponse(baseInput, signal);
      usage = addUsage(usage, response.usage);
      if (response.toolCalls?.length) {
        throw new AgentServiceError(
          "provider_failed",
          "Agent requested a tool outside its active tool policy.",
          false,
        );
      }
      try {
        providerResult = parseProviderResult(response.outputText);
      } catch {
        throw new AgentServiceError(
          "provider_failed",
          "Agent provider returned invalid structured output twice. Retry validation; if it repeats, verify the configured model supports strict JSON schema output.",
          true,
        );
      }
    }
    if (
      providerResult.proposedAction === "staff_handoff" &&
      isAvailabilityFailureHandoff(providerResult) &&
      hasTemporaryAvailabilityFailure(toolHistory)
    ) {
      response = await createResponse(
        {
          ...baseInput,
          instructions: `${baseInput.instructions}
<availability_recovery>
Live availability is temporarily unavailable. Do not mention Calendar configuration and do not hand off. Reply that a time cannot be confirmed yet, ask for one useful missing service detail when available, and remain active.
</availability_recovery>`,
          tools: [],
          toolChoice: "none",
        },
        signal,
      );
      usage = addUsage(usage, response.usage);
      if (response.toolCalls?.length) {
        throw new AgentServiceError(
          "provider_failed",
          "Agent requested a tool during availability recovery.",
          false,
        );
      }
      providerResult = parseProviderResult(response.outputText);
      if (providerResult.proposedAction !== "reply") {
        throw new AgentServiceError(
          "provider_failed",
          "Agent could not produce a safe availability fallback.",
          true,
        );
      }
    }
    providerResult = normalizeSandboxEvidencePins(request, providerResult);
    try {
      validateEvidence(request, providerResult);
    } catch (error) {
      if (
        request.mode !== "sandbox" ||
        !(error instanceof AgentServiceError) ||
        error.message !== "Agent evidence is not present in the pinned playbook."
      ) {
        throw error;
      }
      response = await createResponse(
        {
          ...baseInput,
          instructions: `${baseInput.instructions}
<evidence_recovery>
Return the answer again using only exact evidence excerpts copied from the pinned playbook bundle. Use the exact fileId, versionId, and contentHash supplied with each excerpt.
</evidence_recovery>`,
          tools: [],
          toolChoice: "none",
        },
        signal,
      );
      usage = addUsage(usage, response.usage);
      if (response.toolCalls?.length) {
        throw new AgentServiceError(
          "provider_failed",
          "Agent requested a tool during evidence recovery.",
          false,
        );
      }
      providerResult = normalizeSandboxEvidencePins(
        request,
        parseProviderResult(response.outputText),
      );
      validateEvidence(request, providerResult);
    }

    const result = agentRunResultSchema.safeParse({
      runId: createRunId(),
      ...providerResult,
      toolCalls: traces,
      stopReason:
        providerResult.proposedAction === "staff_handoff"
          ? "handoff"
          : "completed",
      usage,
      latencyMs: Math.max(0, now() - startedAt),
    });
    if (!result.success) {
      throw new AgentServiceError(
        "provider_failed",
        "Agent run evidence is invalid.",
        true,
      );
    }
    return result.data;
  };
}
