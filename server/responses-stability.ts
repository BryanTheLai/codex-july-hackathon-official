/** Shared Responses API knobs for LiteLLM gpt-5.x and OpenAI gpt-5.x. */

export const RESPONSES_MAX_OUTPUT_TOKENS = 2048;

export type ResponsesReasoningEffort = "none" | "low" | "medium" | "high";

export function responsesStabilityFields(effort: ResponsesReasoningEffort = "none") {
  return {
    max_output_tokens: RESPONSES_MAX_OUTPUT_TOKENS,
    reasoning: { effort },
  };
}

export function isUnsupportedReasoningError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /reasoning|unknown[_ ]parameter|unsupported.*param|unrecognized.*request/i.test(
    message,
  );
}

type ResponsesTextCarrier = {
  output_text?: string | null;
  output?: Array<{
    type: string;
    content?: Array<{ type: string; text?: string }>;
  }>;
};

export function extractResponsesOutputText(response: ResponsesTextCarrier): string {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }
  const parts: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }
  return parts.join("");
}

export async function createResponsesWithStability<T>(
  create: (input: Record<string, unknown>, options: { signal?: AbortSignal }) => Promise<T>,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await create(
      {
        ...payload,
        ...responsesStabilityFields(),
      },
      { signal },
    );
  } catch (error) {
    // OpenAI-compatible hosts that reject reasoning still get a token cap.
    if (!isUnsupportedReasoningError(error)) {
      throw error;
    }
    return create(
      {
        ...payload,
        max_output_tokens: RESPONSES_MAX_OUTPUT_TOKENS,
      },
      { signal },
    );
  }
}
