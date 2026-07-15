import { z } from "zod";

import { requestIdSchema, type ApiErrorCode } from "../src/contracts/api";
import {
  deliveryReceiptSchema,
  normalizedInboundEventSchema,
  type ChannelAdapter,
  type TelegramVoicePayload,
} from "../src/contracts/channel";

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const telegramEnvironmentSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[A-Za-z0-9_-]+$/),
  LIVE_TELEGRAM_ENABLED: z.enum(["true", "false"]),
});

const telegramUserSchema = z
  .object({
    id: z.number().int().safe(),
    first_name: z.string().min(1),
    last_name: z.string().optional(),
    username: z.string().optional(),
    language_code: z.string().optional(),
  })
  .passthrough();

const telegramSenderChatSchema = z
  .object({
    id: z.number().int().safe(),
    title: z.string().optional(),
    username: z.string().optional(),
  })
  .passthrough();

const telegramChatSchema = z
  .object({
    id: z.number().int().safe(),
    type: z.string().min(1),
    title: z.string().optional(),
    username: z.string().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
  })
  .passthrough();

const telegramVoiceSchema = z
  .object({
    file_id: z.string().min(1).max(512),
  })
  .passthrough();

const telegramMessageSchema = z
  .object({
    message_id: z.number().int().nonnegative(),
    date: z.number().int().nonnegative(),
    from: telegramUserSchema.optional(),
    sender_chat: telegramSenderChatSchema.optional(),
    chat: telegramChatSchema,
    text: z.string().optional(),
    voice: telegramVoiceSchema.optional(),
  })
  .passthrough();

const telegramUpdateSchema = z
  .object({
    update_id: z.number().int().nonnegative(),
    message: telegramMessageSchema.optional(),
  })
  .passthrough();

const telegramSendSuccessSchema = z
  .object({
    ok: z.literal(true),
    result: z
      .object({
        message_id: z.number().int().nonnegative(),
        date: z.number().int().nonnegative(),
      })
      .passthrough(),
  })
  .passthrough();

const telegramSendFailureSchema = z
  .object({
    ok: z.literal(false),
  })
  .passthrough();

const telegramSendResponseSchema = z.discriminatedUnion("ok", [
  telegramSendSuccessSchema,
  telegramSendFailureSchema,
]);

const telegramFileResponseSchema = z
  .object({
    ok: z.literal(true),
    result: z
      .object({
        file_path: z.string().min(1).max(1024),
        file_size: z.number().int().nonnegative().optional(),
      })
      .passthrough(),
  })
  .strict();

const MAX_TELEGRAM_DOWNLOAD_BYTES = 20 * 1024 * 1024;

export type TelegramConfig = {
  botToken: string;
  webhookSecret: string;
  liveEnabled: boolean;
};

export type TelegramAdapterOptions = {
  botToken: string;
  fetcher?: Fetcher;
  requestTimeoutMs?: number;
  baseUrl?: string;
};

export type TelegramVoiceDownloader = {
  downloadVoice(fileId: string, signal?: AbortSignal): Promise<Uint8Array>;
};

export class TelegramAdapterError extends Error {
  readonly code: Extract<ApiErrorCode, "provider_timeout" | "provider_failed">;

  constructor(
    code: Extract<ApiErrorCode, "provider_timeout" | "provider_failed">,
    message: string,
  ) {
    super(message);
    this.name = "TelegramAdapterError";
    this.code = code;
  }
}

export function readTelegramConfig(
  environment: Record<string, string | undefined> = process.env,
): TelegramConfig {
  const parsed = telegramEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error("Telegram server configuration is invalid");
  }
  return {
    botToken: parsed.data.TELEGRAM_BOT_TOKEN,
    webhookSecret: parsed.data.TELEGRAM_WEBHOOK_SECRET,
    liveEnabled: parsed.data.LIVE_TELEGRAM_ENABLED === "true",
  };
}

function displayName(
  message: z.infer<typeof telegramMessageSchema>,
): string | null {
  if (message.from) {
    return [message.from.first_name, message.from.last_name]
      .filter(Boolean)
      .join(" ");
  }
  return (
    message.sender_chat?.title ??
    message.sender_chat?.username ??
    message.chat.title ??
    message.chat.username ??
    [message.chat.first_name, message.chat.last_name]
      .filter(Boolean)
      .join(" ") ??
    null
  );
}

function senderId(message: z.infer<typeof telegramMessageSchema>): string {
  return String(message.from?.id ?? message.sender_chat?.id ?? message.chat.id);
}

async function telegramReceipt(
  response: Response,
  rejectedMessage: string,
) {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new TelegramAdapterError(
      "provider_failed",
      "Telegram returned an invalid response",
    );
  }
  const parsed = telegramSendResponseSchema.safeParse(body);
  if (!response.ok || !parsed.success || !parsed.data.ok) {
    throw new TelegramAdapterError("provider_failed", rejectedMessage);
  }
  return deliveryReceiptSchema.parse({
    providerMessageId: String(parsed.data.result.message_id),
    acceptedAt: new Date(parsed.data.result.date * 1_000).toISOString(),
  });
}

export function createTelegramAdapter({
  botToken,
  fetcher = fetch,
  requestTimeoutMs = 10_000,
  baseUrl = "https://api.telegram.org",
}: TelegramAdapterOptions): ChannelAdapter & TelegramVoiceDownloader {
  const token = z.string().min(1).parse(botToken);
  const endpoint = z.url().parse(baseUrl).replace(/\/$/, "");
  const timeout = z.number().int().positive().max(60_000).parse(
    requestTimeoutMs,
  );

  return {
    normalizeInbound(payload) {
      const update = telegramUpdateSchema.parse(payload);
      const message = update.message;
      if (!message || (!message.text && !message.voice)) {
        return null;
      }
      return normalizedInboundEventSchema.parse({
        channel: "telegram",
        externalEventId: String(update.update_id),
        externalConversationId: String(message.chat.id),
        externalMessageId: String(message.message_id),
        sender: {
          externalId: senderId(message),
          displayName: displayName(message) || null,
        },
        message: message.text
          ? {
              kind: "text",
              text: message.text,
              language: message.from?.language_code ?? null,
            }
          : {
              kind: "voice",
              telegramFileId: message.voice?.file_id,
              language: message.from?.language_code ?? null,
            },
        receivedAt: new Date(message.date * 1_000).toISOString(),
      });
    },

    async sendText(target, text, idempotencyKey) {
      const chatId = z.string().min(1).max(128).parse(target);
      const approvedText = z.string().trim().min(1).max(4096).parse(text);
      requestIdSchema.parse(idempotencyKey);
      const signal = AbortSignal.timeout(timeout);
      let response: Response;
      try {
        response = await fetcher(`${endpoint}/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: approvedText,
          }),
          signal,
        });
      } catch {
        if (signal.aborted) {
          throw new TelegramAdapterError(
            "provider_timeout",
            "Telegram text send timed out",
          );
        }
        throw new TelegramAdapterError(
          "provider_failed",
          "Telegram text send failed",
        );
      }

      return telegramReceipt(response, "Telegram rejected the text message");
    },

    async sendVoice(target, voice, idempotencyKey) {
      const chatId = z.string().min(1).max(128).parse(target);
      const payload: TelegramVoicePayload = {
        bytes: z
          .instanceof(Uint8Array)
          .refine((value) => value.byteLength > 0)
          .parse(voice.bytes),
        contentType: z.literal("audio/ogg").parse(voice.contentType),
        filename: z.string().trim().min(1).max(128).parse(voice.filename),
      };
      requestIdSchema.parse(idempotencyKey);
      const body = new FormData();
      body.set("chat_id", chatId);
      body.set(
        "voice",
        new Blob([Uint8Array.from(payload.bytes)], { type: payload.contentType }),
        payload.filename,
      );
      const signal = AbortSignal.timeout(timeout);
      let response: Response;
      try {
        response = await fetcher(`${endpoint}/bot${token}/sendVoice`, {
          method: "POST",
          body,
          signal,
        });
      } catch {
        if (signal.aborted) {
          throw new TelegramAdapterError(
            "provider_timeout",
            "Telegram voice send timed out",
          );
        }
        throw new TelegramAdapterError(
          "provider_failed",
          "Telegram voice send failed",
        );
      }
      return telegramReceipt(response, "Telegram rejected the voice message");
    },

    async downloadVoice(fileId, callerSignal) {
      const id = z.string().trim().min(1).max(512).parse(fileId);
      const signal = callerSignal
        ? AbortSignal.any([callerSignal, AbortSignal.timeout(timeout)])
        : AbortSignal.timeout(timeout);
      let metadataResponse: Response;
      try {
        metadataResponse = await fetcher(
          `${endpoint}/bot${token}/getFile?file_id=${encodeURIComponent(id)}`,
          { signal },
        );
      } catch {
        throw new TelegramAdapterError(
          signal.aborted ? "provider_timeout" : "provider_failed",
          signal.aborted
            ? "Telegram voice download timed out"
            : "Telegram voice metadata request failed",
        );
      }
      let metadata: unknown;
      try {
        metadata = await metadataResponse.json();
      } catch {
        throw new TelegramAdapterError(
          "provider_failed",
          "Telegram returned invalid voice metadata",
        );
      }
      const parsed = telegramFileResponseSchema.safeParse(metadata);
      if (!metadataResponse.ok || !parsed.success) {
        throw new TelegramAdapterError(
          "provider_failed",
          "Telegram could not prepare the voice download",
        );
      }
      if (
        parsed.data.result.file_size !== undefined &&
        parsed.data.result.file_size > MAX_TELEGRAM_DOWNLOAD_BYTES
      ) {
        throw new TelegramAdapterError(
          "provider_failed",
          "Telegram voice file exceeds the supported size",
        );
      }
      const filePath = parsed.data.result.file_path
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
      let downloadResponse: Response;
      try {
        downloadResponse = await fetcher(
          `${endpoint}/file/bot${token}/${filePath}`,
          { signal },
        );
      } catch {
        throw new TelegramAdapterError(
          signal.aborted ? "provider_timeout" : "provider_failed",
          signal.aborted
            ? "Telegram voice download timed out"
            : "Telegram voice download failed",
        );
      }
      const contentLength = Number(downloadResponse.headers.get("content-length"));
      if (
        !downloadResponse.ok ||
        (Number.isFinite(contentLength) &&
          contentLength > MAX_TELEGRAM_DOWNLOAD_BYTES)
      ) {
        throw new TelegramAdapterError(
          "provider_failed",
          "Telegram voice file exceeds the supported size",
        );
      }
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await downloadResponse.arrayBuffer());
      } catch {
        throw new TelegramAdapterError(
          signal.aborted ? "provider_timeout" : "provider_failed",
          signal.aborted
            ? "Telegram voice download timed out"
            : "Telegram voice download failed",
        );
      }
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_TELEGRAM_DOWNLOAD_BYTES) {
        throw new TelegramAdapterError(
          "provider_failed",
          "Telegram voice file exceeds the supported size",
        );
      }
      return bytes;
    },
  };
}
