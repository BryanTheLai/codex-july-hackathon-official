import { describe, expect, it, vi } from "vitest";

import {
  createTelegramAdapter,
  readTelegramConfig,
  TelegramAdapterError,
} from "../../server/telegram-adapter";

const update = {
  update_id: 1001,
  message: {
    message_id: 88,
    date: 1_783_944_000,
    from: {
      id: 42,
      is_bot: false,
      first_name: "Aina",
      last_name: "Zulkifli",
      language_code: "ms",
    },
    chat: {
      id: -10042,
      type: "group",
      title: "Clinic test chat",
    },
    text: "Boleh saya buat temujanji?",
  },
};

describe("Telegram adapter", () => {
  it("loads bounded server-only Telegram configuration", () => {
    expect(
      readTelegramConfig({
        TELEGRAM_BOT_TOKEN: "123456:test-token",
        TELEGRAM_WEBHOOK_SECRET: "webhook_secret-42",
        LIVE_TELEGRAM_ENABLED: "true",
      }),
    ).toEqual({
      botToken: "123456:test-token",
      webhookSecret: "webhook_secret-42",
      liveEnabled: true,
    });
    expect(() =>
      readTelegramConfig({
        TELEGRAM_BOT_TOKEN: "123456:test-token",
        TELEGRAM_WEBHOOK_SECRET: "contains spaces",
        LIVE_TELEGRAM_ENABLED: "true",
      }),
    ).toThrow("Telegram server configuration is invalid");
    expect(() => readTelegramConfig({})).toThrow(
      "Telegram server configuration is invalid",
    );
    expect(() =>
      readTelegramConfig({
        TELEGRAM_BOT_TOKEN: "123456:test-token",
      }),
    ).toThrow("Telegram server configuration is invalid");
  });

  it("normalizes Telegram text without leaking provider-only fields", () => {
    const adapter = createTelegramAdapter({
      botToken: "123456:test-token",
    });

    expect(adapter.normalizeInbound(update)).toEqual({
      channel: "telegram",
      externalEventId: "1001",
      externalConversationId: "-10042",
      externalMessageId: "88",
      sender: {
        externalId: "42",
        displayName: "Aina Zulkifli",
      },
      message: {
        kind: "text",
        text: "Boleh saya buat temujanji?",
        language: "ms",
      },
      receivedAt: "2026-07-13T12:00:00.000Z",
    });
  });

  it("normalizes Telegram voice metadata without downloading audio", () => {
    const adapter = createTelegramAdapter({
      botToken: "123456:test-token",
    });

    expect(
      adapter.normalizeInbound({
        ...update,
        message: {
          ...update.message,
          text: undefined,
          voice: { file_id: "voice-1" },
        },
      }),
    ).toEqual({
      channel: "telegram",
      externalEventId: "1001",
      externalConversationId: "-10042",
      externalMessageId: "88",
      sender: {
        externalId: "42",
        displayName: "Aina Zulkifli",
      },
      message: {
        kind: "voice",
        telegramFileId: "voice-1",
        language: "ms",
      },
      receivedAt: "2026-07-13T12:00:00.000Z",
    });
  });

  it("ignores unsupported updates and rejects malformed messages", () => {
    const adapter = createTelegramAdapter({
      botToken: "123456:test-token",
    });

    expect(
      adapter.normalizeInbound({
        ...update,
        message: {
          ...update.message,
          text: undefined,
          document: { file_id: "document-1" },
        },
      }),
    ).toBeNull();
    expect(() =>
      adapter.normalizeInbound({
        ...update,
        message: {
          ...update.message,
          chat: { id: "not-an-integer", type: "private" },
        },
      }),
    ).toThrow();
  });

  it("sends bounded plain text and validates Telegram provider evidence", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            message_id: 9001,
            date: 1_783_944_060,
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    const adapter = createTelegramAdapter({
      botToken: "123456:test-token",
      fetcher,
      requestTimeoutMs: 1_000,
    });

    await expect(
      adapter.sendText(
        "-10042",
        "Klinik akan menghubungi anda.",
        "send-42",
      ),
    ).resolves.toEqual({
      providerMessageId: "9001",
      acceptedAt: "2026-07-13T12:01:00.000Z",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.telegram.org/bot123456:test-token/sendMessage",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: "-10042",
          text: "Klinik akan menghubungi anda.",
        }),
      }),
    );
  });

  it("sanitizes Telegram rejection details", async () => {
    const adapter = createTelegramAdapter({
      botToken: "123456:test-token",
      fetcher: async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error_code: 400,
            description: "provider secret detail",
          }),
          { status: 400 },
        ),
    });

    await expect(
      adapter.sendText("-10042", "Approved text", "send-42"),
    ).rejects.toEqual(
      new TelegramAdapterError(
        "provider_failed",
        "Telegram rejected the text message",
      ),
    );
  });

  it("downloads bounded voice bytes only after Telegram returns a file path", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              file_id: "voice-1",
              file_unique_id: "voice-unique-1",
              file_path: "voice/file_1.oga",
              file_size: 3,
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-length": "3" },
        }),
      );
    const adapter = createTelegramAdapter({
      botToken: "123456:test-token",
      fetcher,
    });

    await expect(adapter.downloadVoice("voice-1")).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://api.telegram.org/bot123456:test-token/getFile?file_id=voice-1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://api.telegram.org/file/bot123456:test-token/voice/file_1.oga",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
