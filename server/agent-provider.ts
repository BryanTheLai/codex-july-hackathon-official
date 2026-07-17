import { createHash } from "node:crypto";

import OpenAI from "openai";
import { z } from "zod";

import type { ApiErrorCode } from "../src/contracts/api";
import { isAbortError } from "../src/shared/errors";
import type {
  AgentProviderCreateInput,
  AgentProviderCreateOutput,
  AgentProviderFunctionTool,
  AgentProviderToolCall,
  CreateAgentProviderResponse,
} from "./agent-service";
import {
  createResponsesWithStability,
  extractResponsesOutputText,
} from "./responses-stability";

const agentProviderEnvironmentSchema = z
  .object({
    LLM_BASE_URL: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === ""
          ? undefined
          : typeof value === "string"
            ? value.trim()
            : value,
      z.url().default("https://api.openai.com/v1"),
    ),
    LLM_API_KEY: z.string().trim().min(1),
    LLM_MODEL: z.string().trim().min(1).default("gpt-5.6-luna"),
    LLM_API_MODE: z
      .enum(["responses", "chat_completions"])
      .default("responses"),
    LIVE_AGENT_ENABLED: z.enum(["true", "false"]),
  })
  .passthrough();

export type AgentProviderConfig = {
  apiKey: string;
  apiMode: "responses" | "chat_completions";
  baseUrl: string;
  liveEnabled: boolean;
  model: string;
};

export type JudgeProviderConfig = Pick<
  AgentProviderConfig,
  "apiKey" | "apiMode" | "baseUrl"
> & {
  model: string;
};

export function createAgentConfigVersion(
  config: AgentProviderConfig,
): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        apiMode: config.apiMode,
        baseUrl: config.baseUrl,
        model: config.model,
      }),
    )
    .digest("hex");
  return `agent-config-${digest}`;
}

type ResponsesOutput = {
  id?: string;
  model?: string;
  output_text?: string | null;
  output?: Array<{
    type: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    content?: Array<{ type: string; text?: string }>;
  }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
};

type ChatToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type ChatCompletionsOutput = {
  id?: string;
  model?: string;
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: ChatToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

type ResponsesInput = {
  model: string;
  instructions: string;
  input:
    | string
    | Array<{
        type: "function_call_output";
        call_id: string;
        output: string;
      }>;
  previous_response_id?: string;
  text: AgentProviderCreateInput["text"];
  tools: AgentProviderFunctionTool[];
  tool_choice: AgentProviderCreateInput["toolChoice"];
  max_output_tokens?: number;
  reasoning?: { effort: "none" | "low" | "medium" | "high" };
};

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: null; tool_calls: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type ChatInput = {
  model: string;
  messages: ChatMessage[];
  response_format: {
    type: "json_schema";
    json_schema: {
      name: "kaunter_agent_result";
      strict: true;
      schema: AgentProviderCreateInput["text"]["format"]["schema"];
    };
  };
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      strict: true;
      parameters: Record<string, unknown>;
    };
  }>;
  tool_choice?: "auto" | "none";
};

type AgentProviderClient = {
  responses: {
    create(
      input: ResponsesInput,
      options: { signal?: AbortSignal },
    ): Promise<ResponsesOutput>;
  };
  chat: {
    completions: {
      create(
        input: ChatInput,
        options: { signal?: AbortSignal },
      ): Promise<ChatCompletionsOutput>;
    };
  };
};

export class AgentProviderError extends Error {
  readonly code: Extract<
    ApiErrorCode,
    "provider_timeout" | "provider_failed"
  >;
  readonly retryable = true;

  constructor(
    code: Extract<
      ApiErrorCode,
      "provider_timeout" | "provider_failed"
    >,
    message: string,
  ) {
    super(message);
    this.name = "AgentProviderError";
    this.code = code;
  }
}

export function readAgentProviderConfig(
  environment: Record<string, string | undefined> = process.env,
): AgentProviderConfig {
  const parsed = agentProviderEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error("Agent provider configuration is invalid");
  }
  return {
    apiKey: parsed.data.LLM_API_KEY,
    apiMode: parsed.data.LLM_API_MODE,
    baseUrl: parsed.data.LLM_BASE_URL.replace(/\/$/, ""),
    liveEnabled: parsed.data.LIVE_AGENT_ENABLED === "true",
    model: parsed.data.LLM_MODEL,
  };
}

export function readJudgeProviderConfig(
  environment: Record<string, string | undefined> = process.env,
): JudgeProviderConfig {
  const shared = readAgentProviderConfig(environment);
  const model = z
    .string()
    .trim()
    .min(1)
    .max(256)
    .parse(environment.JUDGE_MODEL?.trim() || shared.model);
  return {
    apiKey: shared.apiKey,
    apiMode: shared.apiMode,
    baseUrl: shared.baseUrl,
    model,
  };
}

function defaultClient(config: AgentProviderConfig): AgentProviderClient {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: 45_000,
    maxRetries: 1,
  });
  return {
    responses: {
      async create(input, options) {
        return client.responses.create(input as never, options) as Promise<ResponsesOutput>;
      },
    },
    chat: {
      completions: {
        async create(input, options) {
          return client.chat.completions.create(input as never, options) as Promise<ChatCompletionsOutput>;
        },
      },
    },
  };
}

function responseToolCalls(response: ResponsesOutput): AgentProviderToolCall[] {
  return (response.output ?? [])
    .filter(
      (item) =>
        item.type === "function_call" &&
        typeof item.call_id === "string" &&
        typeof item.name === "string" &&
        typeof item.arguments === "string",
    )
    .map((item) => ({
      callId: item.call_id!,
      name: item.name!,
      argumentsJson: item.arguments!,
    }));
}

function responsesOutput(
  response: ResponsesOutput,
): AgentProviderCreateOutput {
  const toolCalls = responseToolCalls(response);
  const outputText = extractResponsesOutputText(response);
  if (toolCalls.length === 0 && !outputText.trim()) {
    throw new AgentProviderError(
      "provider_failed",
      "Agent provider returned empty Responses output (reasoning-only).",
    );
  }
  return {
    model: response.model,
    outputText,
    ...(response.id ? { responseId: response.id } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    usage: response.usage
      ? {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : undefined,
  };
}

function chatOutput(
  response: ChatCompletionsOutput,
): AgentProviderCreateOutput {
  const message = response.choices[0]?.message;
  const toolCalls = (message?.tool_calls ?? []).map((call) => ({
    callId: call.id,
    name: call.function.name,
    argumentsJson: call.function.arguments,
  }));
  return {
    model: response.model,
    outputText: message?.content ?? "",
    ...(response.id ? { responseId: response.id } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    usage: response.usage
      ? {
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : undefined,
  };
}

function chatMessages(input: AgentProviderCreateInput): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: "system", content: input.instructions },
    { role: "user", content: input.input },
  ];
  for (const round of input.toolHistory ?? []) {
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: round.calls.map((call) => ({
        id: call.callId,
        type: "function",
        function: { name: call.name, arguments: call.argumentsJson },
      })),
    });
    for (const output of round.outputs) {
      messages.push({
        role: "tool",
        tool_call_id: output.callId,
        content: output.output,
      });
    }
  }
  return messages;
}

export function createAgentProviderAdapter(
  config: AgentProviderConfig,
  client: AgentProviderClient = defaultClient(config),
): CreateAgentProviderResponse {
  return async (input, signal) => {
    try {
      if (config.apiMode === "responses") {
        const payload = {
          model: input.model,
          instructions: input.instructions,
          input: input.previousResponseId
            ? (input.toolOutputs ?? []).map((output) => ({
                type: "function_call_output" as const,
                call_id: output.callId,
                output: output.output,
              }))
            : input.input,
          ...(input.previousResponseId
            ? { previous_response_id: input.previousResponseId }
            : {}),
          text: input.text,
          tools: input.tools,
          tool_choice: input.toolChoice,
        };
        return responsesOutput(
          await createResponsesWithStability(
            (stablePayload, options) =>
              client.responses.create(stablePayload as ResponsesInput, options),
            payload,
            signal,
          ),
        );
      }

      return chatOutput(
        await client.chat.completions.create(
          {
            model: input.model,
            messages: chatMessages(input),
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "kaunter_agent_result",
                strict: true,
                schema: input.text.format.schema,
              },
            },
            ...(input.tools.length > 0
              ? {
                  tools: input.tools.map((tool) => ({
                    type: "function" as const,
                    function: {
                      name: tool.name,
                      description: tool.description,
                      strict: tool.strict,
                      parameters: tool.parameters,
                    },
                  })),
                  tool_choice: input.toolChoice,
                }
              : {}),
          },
          { signal },
        ),
      );
    } catch (error) {
      if (error instanceof AgentProviderError) {
        throw error;
      }
      if (isAbortError(error)) {
        throw new AgentProviderError(
          "provider_timeout",
          "Agent provider request timed out.",
        );
      }
      throw new AgentProviderError(
        "provider_failed",
        "Agent provider request failed.",
      );
    }
  };
}
