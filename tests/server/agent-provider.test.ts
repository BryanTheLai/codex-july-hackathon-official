import { describe, expect, it, vi } from "vitest";

import type { AgentProviderCreateInput } from "../../server/agent-service";
import {
  AgentProviderError,
  createAgentConfigVersion,
  createAgentProviderAdapter,
  readAgentProviderConfig,
  readJudgeProviderConfig,
} from "../../server/agent-provider";
import { AGENT_JSON_SCHEMA } from "../../server/agent-prompt";

const input: AgentProviderCreateInput = {
  model: "agent-model",
  instructions: "Fixed instructions",
  input: "<playbook_bundle>{}</playbook_bundle>",
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
};

describe("agent provider adapter", () => {
  it("reads bounded server-only provider configuration", () => {
    expect(
      readAgentProviderConfig({
        LLM_API_KEY: "provider-key",
        LIVE_AGENT_ENABLED: "false",
      }),
    ).toEqual({
      apiKey: "provider-key",
      apiMode: "responses",
      baseUrl: "https://api.openai.com/v1",
      liveEnabled: false,
      model: "gpt-5.6-luna",
    });
    expect(() =>
      readAgentProviderConfig({
        LLM_API_KEY: "provider-key",
        LLM_API_MODE: "unsupported",
        LIVE_AGENT_ENABLED: "true",
      }),
    ).toThrow("Agent provider configuration is invalid");
    expect(() => readAgentProviderConfig({})).toThrow(
      "Agent provider configuration is invalid",
    );
    expect(
      readAgentProviderConfig({
        LLM_API_KEY: "provider-key",
        LLM_BASE_URL: "https://provider.example/v1/",
        LIVE_AGENT_ENABLED: "true",
      }).baseUrl,
    ).toBe("https://provider.example/v1");
    expect(
      readAgentProviderConfig({
        LLM_API_KEY: "provider-key",
        LLM_BASE_URL: "http://127.0.0.1:4000",
        LIVE_AGENT_ENABLED: "true",
      }).baseUrl,
    ).toBe("http://127.0.0.1:4000");
  });

  it("uses OpenAI when the optional compatible-provider base URL is empty", () => {
    for (const baseUrl of ["", "   "]) {
      expect(
        readAgentProviderConfig({
          LLM_API_KEY: "provider-key",
          LLM_BASE_URL: baseUrl,
          LIVE_AGENT_ENABLED: "false",
        }).baseUrl,
      ).toBe("https://api.openai.com/v1");
    }
    expect(() =>
      readAgentProviderConfig({
        LLM_API_KEY: "provider-key",
        LLM_BASE_URL: "not-a-url",
        LIVE_AGENT_ENABLED: "false",
      }),
    ).toThrow("Agent provider configuration is invalid");
    expect(() =>
      readAgentProviderConfig({
        LLM_API_KEY: "   ",
        LIVE_AGENT_ENABLED: "false",
      }),
    ).toThrow("Agent provider configuration is invalid");
  });

  it("shares the OpenAI-compatible provider with the judge", () => {
    expect(
      readJudgeProviderConfig({
        LLM_API_KEY: "provider-key",
        LLM_BASE_URL: "",
        LLM_MODEL: "shared-model",
        LLM_API_MODE: "responses",
        LIVE_AGENT_ENABLED: "false",
      }),
    ).toEqual({
      apiKey: "provider-key",
      apiMode: "responses",
      baseUrl: "https://api.openai.com/v1",
      model: "shared-model",
    });
    expect(
      readJudgeProviderConfig({
        LLM_API_KEY: "litellm-key",
        LLM_BASE_URL: "https://litellm.example/v1/",
        LLM_MODEL: "shared-model",
        LLM_API_MODE: "responses",
        JUDGE_MODEL: "judge-model",
        LIVE_AGENT_ENABLED: "true",
      }),
    ).toEqual({
      apiKey: "litellm-key",
      apiMode: "responses",
      baseUrl: "https://litellm.example/v1",
      model: "judge-model",
    });
  });

  it("versions non-secret provider behavior deterministically", () => {
    const config = readAgentProviderConfig({
      LLM_API_KEY: "provider-key",
      LLM_MODEL: "agent-model",
      LIVE_AGENT_ENABLED: "true",
    });

    expect(createAgentConfigVersion(config)).toMatch(
      /^agent-config-[a-f0-9]{64}$/,
    );
    expect(
      createAgentConfigVersion({
        ...config,
        apiKey: "rotated-key",
      }),
    ).toBe(createAgentConfigVersion(config));
    expect(
      createAgentConfigVersion({
        ...config,
        model: "different-model",
      }),
    ).not.toBe(createAgentConfigVersion(config));
  });

  it("maps the Responses API without registering tools", async () => {
    const responsesCreate = vi.fn(async () => ({
      model: "provider-model",
      output_text: '{"proposedAction":"reply"}',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
      },
    }));
    const createResponse = createAgentProviderAdapter(
      {
        apiKey: "provider-key",
        apiMode: "responses",
        baseUrl: "https://provider.example/v1",
        liveEnabled: true,
        model: "agent-model",
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
      outputText: '{"proposedAction":"reply"}',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
    });
    expect(responsesCreate).toHaveBeenCalledWith(
      {
        model: "agent-model",
        instructions: "Fixed instructions",
        input: "<playbook_bundle>{}</playbook_bundle>",
        text: input.text,
        tools: [],
        tool_choice: "none",
        max_output_tokens: 2048,
        reasoning: { effort: "none" },
      },
      { signal: controller.signal },
    );
  });

  it("rejects reasoning-only empty Responses output for non-tool turns", async () => {
    const createResponse = createAgentProviderAdapter(
      {
        apiKey: "provider-key",
        apiMode: "responses",
        baseUrl: "https://provider.example/v1",
        liveEnabled: true,
        model: "agent-model",
      },
      {
        responses: {
          create: vi.fn(async () => ({
            model: "provider-model",
            output_text: "",
            output: [{ type: "reasoning" }],
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              total_tokens: 15,
            },
          })),
        },
        chat: { completions: { create: vi.fn() } },
      },
    );

    await expect(createResponse(input)).rejects.toEqual(
      new AgentProviderError(
        "provider_failed",
        "Agent provider returned empty Responses output (reasoning-only).",
      ),
    );
  });

  it("maps Chat Completions structured output without tools", async () => {
    const chatCreate = vi.fn(async () => ({
      model: "chat-model",
      choices: [
        {
          message: {
            content: '{"proposedAction":"staff_handoff"}',
          },
        },
      ],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 7,
        total_tokens: 27,
      },
    }));
    const createResponse = createAgentProviderAdapter(
      {
        apiKey: "provider-key",
        apiMode: "chat_completions",
        baseUrl: "https://provider.example/v1",
        liveEnabled: true,
        model: "agent-model",
      },
      {
        responses: { create: vi.fn() },
        chat: { completions: { create: chatCreate } },
      },
    );

    await expect(createResponse(input)).resolves.toEqual({
      model: "chat-model",
      outputText: '{"proposedAction":"staff_handoff"}',
      usage: {
        inputTokens: 20,
        outputTokens: 7,
        totalTokens: 27,
      },
    });
    expect(chatCreate).toHaveBeenCalledWith(
      {
        model: "agent-model",
        messages: [
          { role: "system", content: "Fixed instructions" },
          {
            role: "user",
            content: "<playbook_bundle>{}</playbook_bundle>",
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "kaunter_agent_result",
            strict: true,
            schema: AGENT_JSON_SCHEMA,
          },
        },
      },
      { signal: undefined },
    );
  });

  it("maps Responses function calls and returns their output through previous_response_id", async () => {
    const responsesCreate = vi
      .fn()
      .mockResolvedValueOnce({
        id: "response-1",
        model: "provider-model",
        output_text: "",
        output: [
          {
            type: "function_call",
            call_id: "call-1",
            name: "list_available_slots",
            arguments: '{"date":null}',
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      })
      .mockResolvedValueOnce({
        id: "response-2",
        model: "provider-model",
        output_text: '{"proposedAction":"reply"}',
        usage: { input_tokens: 8, output_tokens: 4, total_tokens: 12 },
      });
    const createResponse = createAgentProviderAdapter(
      {
        apiKey: "provider-key",
        apiMode: "responses",
        baseUrl: "https://provider.example/v1",
        liveEnabled: true,
        model: "agent-model",
      },
      {
        responses: { create: responsesCreate },
        chat: { completions: { create: vi.fn() } },
      },
    );
    const toolInput: AgentProviderCreateInput = {
      ...input,
      tools: [
        {
          type: "function",
          name: "list_available_slots",
          description: "Find slots",
          strict: true,
          parameters: { type: "object" },
        },
      ],
      toolChoice: "auto",
    };

    const first = await createResponse(toolInput);
    expect(first).toMatchObject({
      responseId: "response-1",
      toolCalls: [
        {
          callId: "call-1",
          name: "list_available_slots",
        },
      ],
    });
    await expect(
      createResponse({
        ...toolInput,
        previousResponseId: first.responseId,
        toolOutputs: [{ callId: "call-1", output: '{"success":true}' }],
      }),
    ).resolves.toMatchObject({
      responseId: "response-2",
      outputText: '{"proposedAction":"reply"}',
    });
    expect(responsesCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        previous_response_id: "response-1",
        input: [
          {
            type: "function_call_output",
            call_id: "call-1",
            output: '{"success":true}',
          },
        ],
      }),
      { signal: undefined },
    );
  });

  it("continues Chat Completions function calls with the completion ID and tool history", async () => {
    const chatCreate = vi
      .fn()
      .mockResolvedValueOnce({
        id: "chat-1",
        model: "chat-model",
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "list_available_slots",
                    arguments: '{"date":null}',
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })
      .mockResolvedValueOnce({
        id: "chat-2",
        model: "chat-model",
        choices: [{ message: { content: '{"proposedAction":"reply"}' } }],
        usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
      });
    const createResponse = createAgentProviderAdapter(
      {
        apiKey: "provider-key",
        apiMode: "chat_completions",
        baseUrl: "https://provider.example/v1",
        liveEnabled: true,
        model: "agent-model",
      },
      {
        responses: { create: vi.fn() },
        chat: { completions: { create: chatCreate } },
      },
    );
    const toolInput: AgentProviderCreateInput = {
      ...input,
      tools: [
        {
          type: "function",
          name: "list_available_slots",
          description: "Find slots",
          strict: true,
          parameters: { type: "object" },
        },
      ],
      toolChoice: "auto",
    };

    const first = await createResponse(toolInput);
    expect(first).toMatchObject({
      responseId: "chat-1",
      toolCalls: [
        { callId: "call-1", name: "list_available_slots" },
      ],
    });
    await expect(
      createResponse({
        ...toolInput,
        previousResponseId: first.responseId,
        toolHistory: [
          {
            calls: first.toolCalls!,
            outputs: [{ callId: "call-1", output: '{"success":true}' }],
          },
        ],
      }),
    ).resolves.toMatchObject({ responseId: "chat-2" });
    expect(chatCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "assistant",
            tool_calls: [
              expect.objectContaining({ id: "call-1" }),
            ],
          }),
          {
            role: "tool",
            tool_call_id: "call-1",
            content: '{"success":true}',
          },
        ]),
      }),
      { signal: undefined },
    );
  });

  it("sanitizes provider failures and classifies aborts as timeouts", async () => {
    const providerFailure = createAgentProviderAdapter(
      {
        apiKey: "provider-key",
        apiMode: "responses",
        baseUrl: "https://provider.example/v1",
        liveEnabled: true,
        model: "agent-model",
      },
      {
        responses: {
          create: vi.fn(async () => {
            throw new Error("secret provider body");
          }),
        },
        chat: { completions: { create: vi.fn() } },
      },
    );
    const timeout = createAgentProviderAdapter(
      {
        apiKey: "provider-key",
        apiMode: "responses",
        baseUrl: "https://provider.example/v1",
        liveEnabled: true,
        model: "agent-model",
      },
      {
        responses: {
          create: vi.fn(async () => {
            throw new DOMException("Aborted", "AbortError");
          }),
        },
        chat: { completions: { create: vi.fn() } },
      },
    );
    const chatTimeout = createAgentProviderAdapter(
      {
        apiKey: "provider-key",
        apiMode: "chat_completions",
        baseUrl: "https://provider.example/v1",
        liveEnabled: true,
        model: "agent-model",
      },
      {
        responses: { create: vi.fn() },
        chat: {
          completions: {
            create: vi.fn(async () => {
              throw new DOMException("Aborted", "AbortError");
            }),
          },
        },
      },
    );

    await expect(providerFailure(input)).rejects.toEqual(
      new AgentProviderError(
        "provider_failed",
        "Agent provider request failed.",
      ),
    );
    await expect(timeout(input)).rejects.toEqual(
      new AgentProviderError(
        "provider_timeout",
        "Agent provider request timed out.",
      ),
    );
    await expect(chatTimeout(input)).rejects.toEqual(
      new AgentProviderError(
        "provider_timeout",
        "Agent provider request timed out.",
      ),
    );
  });
});
