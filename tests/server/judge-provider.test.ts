import { describe, expect, it, vi } from "vitest";

import { createJudgeProviderAdapter } from "../../server/judge-provider";
import { JUDGE_JSON_SCHEMA } from "../../server/judge-prompt";

const input = {
  model: "judge-model",
  instructions: "Judge instructions",
  input: "<judge_data>{}</judge_data>",
  text: {
    format: {
      type: "json_schema" as const,
      name: "kaunter_judge_result",
      strict: true as const,
      schema: JUDGE_JSON_SCHEMA,
    },
  },
};

describe("judge provider adapter", () => {
  it("maps the Responses API through the shared provider mode", async () => {
    const responsesCreate = vi.fn(async () => ({
      model: "provider-model",
      output_text: '{"score":1}',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
      },
    }));
    const createResponse = createJudgeProviderAdapter(
      {
        apiKey: "provider-key",
        apiMode: "responses",
        baseUrl: "https://provider.example/v1",
        model: "judge-model",
      },
      {
        responses: { create: responsesCreate },
        chat: { completions: { create: vi.fn() } },
      },
    );
    const controller = new AbortController();

    await expect(
      createResponse(input, controller.signal),
    ).resolves.toEqual({
      model: "provider-model",
      output_text: '{"score":1}',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
      },
    });
    expect(responsesCreate).toHaveBeenCalledWith(
      {
        ...input,
        max_output_tokens: 2048,
        reasoning: { effort: "none" },
      },
      {
        signal: controller.signal,
      },
    );
  });

  it("recovers message output_text when the top-level field is empty", async () => {
    const responsesCreate = vi.fn(async () => ({
      model: "provider-model",
      output_text: "",
      output: [
        { type: "reasoning" },
        {
          type: "message",
          content: [{ type: "output_text", text: '{"score":0.5}' }],
        },
      ],
    }));
    const createResponse = createJudgeProviderAdapter(
      {
        apiKey: "provider-key",
        apiMode: "responses",
        baseUrl: "https://provider.example/v1",
        model: "judge-model",
      },
      {
        responses: { create: responsesCreate },
        chat: { completions: { create: vi.fn() } },
      },
    );

    await expect(createResponse(input)).resolves.toEqual({
      model: "provider-model",
      output_text: '{"score":0.5}',
    });
  });

  it("rejects reasoning-only empty Responses output", async () => {
    const createResponse = createJudgeProviderAdapter(
      {
        apiKey: "provider-key",
        apiMode: "responses",
        baseUrl: "https://provider.example/v1",
        model: "judge-model",
      },
      {
        responses: {
          create: vi.fn(async () => ({
            model: "provider-model",
            output_text: "",
            output: [{ type: "reasoning" }],
          })),
        },
        chat: { completions: { create: vi.fn() } },
      },
    );

    await expect(createResponse(input)).rejects.toThrow(
      /empty Responses output \(reasoning-only\)/,
    );
  });

  it("maps Chat Completions structured output through the shared provider mode", async () => {
    const chatCreate = vi.fn(async () => ({
      model: "provider-model",
      choices: [{ message: { content: '{"score":1}' } }],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 7,
        total_tokens: 27,
      },
    }));
    const createResponse = createJudgeProviderAdapter(
      {
        apiKey: "provider-key",
        apiMode: "chat_completions",
        baseUrl: "https://provider.example/v1",
        model: "judge-model",
      },
      {
        responses: { create: vi.fn() },
        chat: { completions: { create: chatCreate } },
      },
    );

    await expect(createResponse(input)).resolves.toEqual({
      model: "provider-model",
      output_text: '{"score":1}',
      usage: {
        input_tokens: 20,
        output_tokens: 7,
        total_tokens: 27,
      },
    });
    expect(chatCreate).toHaveBeenCalledWith(
      {
        model: "judge-model",
        messages: [
          { role: "system", content: "Judge instructions" },
          { role: "user", content: "<judge_data>{}</judge_data>" },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "kaunter_judge_result",
            strict: true,
            schema: JUDGE_JSON_SCHEMA,
          },
        },
      },
      { signal: undefined },
    );
  });
});
