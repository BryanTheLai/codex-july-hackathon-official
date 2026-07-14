import { randomUUID } from "node:crypto";

import {
  agentRunRequestSchema,
  agentRunResultSchema,
  providerAgentResultSchema,
  type AgentRunRequest,
  type AgentRunResult,
  type ProviderAgentResult,
} from "../src/contracts/agent";
import type { ApiErrorCode } from "../src/contracts/api";
import {
  buildAgentPrompt,
  type AGENT_JSON_SCHEMA,
} from "./agent-prompt";

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
  tools: [];
  toolChoice: "none";
};

export type AgentProviderCreateOutput = {
  model?: string;
  outputText: string;
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

type AgentServiceOptions = {
  createResponse: CreateAgentProviderResponse;
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

export function createAgentService({
  createResponse,
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
    const response = await createResponse(
      {
        model,
        instructions: prompt.instructions,
        input: prompt.input,
        text: {
          format: {
            type: "json_schema",
            name: "kaunter_agent_result",
            strict: true,
            schema: prompt.outputSchema,
          },
        },
        tools: [],
        toolChoice: "none",
      },
      signal,
    );
    const providerResult = parseProviderResult(response.outputText);
    validateEvidence(request, providerResult);
    if (!response.usage) {
      throw new AgentServiceError(
        "provider_failed",
        "Agent response did not include token usage.",
        true,
      );
    }

    const result = agentRunResultSchema.safeParse({
      runId: createRunId(),
      ...providerResult,
      toolCalls: [],
      stopReason:
        providerResult.proposedAction === "staff_handoff"
          ? "handoff"
          : "completed",
      usage: response.usage,
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
