import OpenAI from "openai";

import type { JudgeProviderConfig } from "./agent-provider";
import type {
  CreateProviderResponse,
  JudgeProviderCreateInput,
  JudgeProviderCreateOutput,
} from "./judge-service";
import {
  createResponsesWithStability,
  extractResponsesOutputText,
} from "./responses-stability";

type ChatCompletionsOutput = {
  model?: string;
  choices: Array<{
    message: {
      content: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

type ResponsesCreateInput = JudgeProviderCreateInput & {
  max_output_tokens?: number;
  reasoning?: { effort: "none" | "low" | "medium" | "high" };
};

type ResponsesRawOutput = {
  model?: string;
  output_text?: string | null;
  output?: Array<{
    type: string;
    content?: Array<{ type: string; text?: string }>;
  }>;
  usage?: JudgeProviderCreateOutput["usage"];
};

type JudgeProviderClient = {
  responses: {
    create(
      input: ResponsesCreateInput,
      options: { signal?: AbortSignal },
    ): Promise<ResponsesRawOutput>;
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
            json_schema: Omit<
              JudgeProviderCreateInput["text"]["format"],
              "type"
            >;
          };
        },
        options: { signal?: AbortSignal },
      ): Promise<ChatCompletionsOutput>;
    };
  };
};

function defaultClient(config: JudgeProviderConfig): JudgeProviderClient {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: 30_000,
    maxRetries: 1,
  });
  return {
    responses: {
      async create(input, options) {
        return client.responses.create(input as never, options) as Promise<ResponsesRawOutput>;
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

function chatOutput(
  response: ChatCompletionsOutput,
): JudgeProviderCreateOutput {
  return {
    model: response.model,
    output_text: response.choices[0]?.message.content ?? "",
    usage: response.usage
      ? {
          input_tokens: response.usage.prompt_tokens,
          output_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens,
        }
      : undefined,
  };
}

export function createJudgeProviderAdapter(
  config: JudgeProviderConfig,
  client: JudgeProviderClient = defaultClient(config),
): CreateProviderResponse {
  if (config.apiMode === "responses") {
    return async (input, signal) => {
      const response = await createResponsesWithStability(
        (payload, options) =>
          client.responses.create(payload as ResponsesCreateInput, options),
        { ...input },
        signal,
      );
      const outputText = extractResponsesOutputText(response);
      if (!outputText.trim()) {
        throw new Error(
          "Judge provider returned empty Responses output (reasoning-only).",
        );
      }
      return {
        model: response.model,
        output_text: outputText,
        usage: response.usage,
      };
    };
  }
  return async (input, signal) =>
    chatOutput(
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
              name: input.text.format.name,
              strict: input.text.format.strict,
              schema: input.text.format.schema,
            },
          },
        },
        { signal },
      ),
    );
}
