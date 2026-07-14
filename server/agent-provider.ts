import { createHash } from "node:crypto";

import OpenAI from "openai";
import { z } from "zod";

import type { ApiErrorCode } from "../src/contracts/api";
import { isAbortError } from "../src/shared/errors";
import type {
  AgentProviderCreateInput,
  AgentProviderCreateOutput,
  CreateAgentProviderResponse,
} from "./agent-service";

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
    LLM_MODEL: z.string().trim().min(1).default("gpt-5.5"),
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
  model?: string;
  output_text: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
};

type ChatCompletionsOutput = {
  model?: string;
  choices: Array<{
    message: {
      content: string | null;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

type AgentProviderClient = {
  responses: {
    create(
      input: {
        model: string;
        instructions: string;
        input: string;
        text: AgentProviderCreateInput["text"];
        tools: [];
        tool_choice: "none";
      },
      options: { signal?: AbortSignal },
    ): Promise<ResponsesOutput>;
  };
  chat: {
    completions: {
      create(
        input: {
          model: string;
          messages: Array<{
            role: "system" | "user";
            content: string;
          }>;
          response_format: {
            type: "json_schema";
            json_schema: {
              name: "kaunter_agent_result";
              strict: true;
              schema: AgentProviderCreateInput["text"]["format"]["schema"];
            };
          };
        },
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
        return client.responses.create(input, options);
      },
    },
    chat: {
      completions: {
        async create(input, options) {
          return client.chat.completions.create(input, options);
        },
      },
    },
  };
}

function responsesOutput(
  response: ResponsesOutput,
): AgentProviderCreateOutput {
  return {
    model: response.model,
    outputText: response.output_text,
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
  return {
    model: response.model,
    outputText: response.choices[0]?.message.content ?? "",
    usage: response.usage
      ? {
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : undefined,
  };
}

export function createAgentProviderAdapter(
  config: AgentProviderConfig,
  client: AgentProviderClient = defaultClient(config),
): CreateAgentProviderResponse {
  return async (input, signal) => {
    try {
      if (config.apiMode === "responses") {
        return responsesOutput(
          await client.responses.create(
            {
              model: input.model,
              instructions: input.instructions,
              input: input.input,
              text: input.text,
              tools: [],
              tool_choice: "none",
            },
            { signal },
          ),
        );
      }

      return chatOutput(
        await client.chat.completions.create(
          {
            model: input.model,
            messages: [
              { role: "system", content: input.instructions },
              { role: "user", content: input.input },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "kaunter_agent_result",
                strict: true,
                schema: input.text.format.schema,
              },
            },
          },
          { signal },
        ),
      );
    } catch (error) {
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
