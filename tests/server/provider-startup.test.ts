import { afterEach, describe, expect, it, vi } from "vitest";

import { createJudgeApp } from "../../server/index";

function stubProviderEnvironment(apiKey: string, baseUrl: string): void {
  vi.stubEnv("LLM_API_KEY", apiKey);
  vi.stubEnv("LLM_BASE_URL", baseUrl);
  vi.stubEnv("LLM_MODEL", "gpt-5.5");
  vi.stubEnv("LLM_API_MODE", "responses");
  vi.stubEnv("JUDGE_MODEL", "");
  vi.stubEnv("LIVE_AGENT_ENABLED", "false");
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubEnv("KAUNTER_WORKSPACE_ID", "demo");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
  vi.stubEnv("LIVE_TELEGRAM_ENABLED", "false");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("provider startup configuration", () => {
  it("keeps an empty copied environment safely disabled", () => {
    stubProviderEnvironment("", "");

    expect(() => createJudgeApp()).not.toThrow();
  });

  it("fails startup when a configured provider has an invalid base URL", () => {
    stubProviderEnvironment("provider-key", "not-a-url");

    expect(() => createJudgeApp()).toThrow(
      "Agent provider configuration is invalid",
    );
  });

  it("fails startup when the provider key contains only whitespace", () => {
    stubProviderEnvironment("   ", "");

    expect(() => createJudgeApp()).toThrow(
      "Agent provider configuration is invalid",
    );
  });
});
