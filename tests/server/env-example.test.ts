import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

import { describe, expect, it } from "vitest";

import {
  readAgentProviderConfig,
  readJudgeProviderConfig,
} from "../../server/agent-provider";
import { readTelegramConfig } from "../../server/telegram-adapter";

const example = parseEnv(
  readFileSync(resolve(process.cwd(), ".env.example"), "utf8"),
);

describe("environment example", () => {
  it("uses OpenAI defaults when the compatible-provider override is empty", () => {
    const environment = {
      ...example,
      LLM_API_KEY: "provider-key",
    };

    expect(readAgentProviderConfig(environment)).toMatchObject({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.6",
    });
    expect(readJudgeProviderConfig(environment)).toMatchObject({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.6",
    });
  });

  it("contains the complete Telegram and fixed-workspace contract", () => {
    expect(
      readTelegramConfig({
        ...example,
        TELEGRAM_BOT_TOKEN: "123456:replacement-token",
        TELEGRAM_WEBHOOK_SECRET:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      }),
    ).toEqual({
      botToken: "123456:replacement-token",
      webhookSecret:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      liveEnabled: false,
    });
    expect(example).toMatchObject({
      KAUNTER_WORKSPACE_ID: "demo",
      SUPABASE_SERVICE_ROLE_KEY: "",
      SUPABASE_URL: "",
    });
  });
});
