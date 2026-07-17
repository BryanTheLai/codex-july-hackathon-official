import { createHash } from "node:crypto";

import { z } from "zod";

import type { ApiErrorCode } from "../src/contracts/api";
import type { ChannelAdapter } from "../src/contracts/channel";
import {
  mergeTelegramInboundText,
  mergeTelegramInboundVoice,
  telegramInboundMessageId,
} from "../src/domain";
import type { TelegramEventRepository } from "./telegram-repository";
import type { WorkspaceRepository } from "./workspace-repository";

export type TelegramInboundResult = {
  ok: true;
  status: "processed" | "duplicate" | "ignored";
};

export interface TelegramInboundService {
  process(payload: unknown): Promise<TelegramInboundResult>;
}

export class TelegramInboundError extends Error {
  readonly code: Extract<
    ApiErrorCode,
    "invalid_request" | "not_found" | "revision_conflict" | "provider_failed"
  >;

  constructor(
    code: TelegramInboundError["code"],
    message: string,
  ) {
    super(message);
    this.name = "TelegramInboundError";
    this.code = code;
  }
}

type TelegramInboundServiceOptions = {
  adapter: Pick<ChannelAdapter, "normalizeInbound">;
  eventRepository: TelegramEventRepository;
  workspaceId: string;
  workspaceRepository: WorkspaceRepository;
  maxCasAttempts?: number;
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

function payloadHash(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function failureCode(error: unknown): TelegramInboundError["code"] {
  return error instanceof TelegramInboundError
    ? error.code
    : "provider_failed";
}

export function createTelegramInboundService({
  adapter,
  eventRepository,
  workspaceId,
  workspaceRepository,
  maxCasAttempts = 3,
}: TelegramInboundServiceOptions): TelegramInboundService {
  const attempts = z.number().int().positive().max(10).parse(maxCasAttempts);

  return {
    async process(payload) {
      const event = adapter.normalizeInbound(payload);
      if (!event) {
        return { ok: true, status: "ignored" };
      }
      const updateId = z.coerce
        .number()
        .int()
        .nonnegative()
        .parse(event.externalEventId);
      const hash = payloadHash(payload);
      const registered = await eventRepository.register({
        updateId,
        workspaceId,
        payloadHash: hash,
        normalizedMessageId: telegramInboundMessageId(event),
        normalizedEvent: event,
      });
      if (registered.record.payloadHash !== hash) {
        throw new TelegramInboundError(
          "invalid_request",
          "Telegram update identity does not match its stored payload",
        );
      }
      if (registered.record.status === "processed") {
        return { ok: true, status: "duplicate" };
      }

      try {
        let workspace = await workspaceRepository.load(workspaceId);
        if (!workspace) {
          throw new TelegramInboundError(
            "not_found",
            "Workspace not found",
          );
        }

        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const durableMessage = workspace.state.conversations.some(
            (conversation) =>
              conversation.messages.some(
                (message) =>
                  message.id === registered.record.normalizedMessageId,
              ),
          );
          const durableVoiceArtifact =
            event.message.kind !== "voice" ||
            workspace.state.speechArtifacts.some(
              (artifact) =>
                artifact.messageId ===
                registered.record.normalizedMessageId,
            );
          const alreadyDurable = durableMessage && durableVoiceArtifact;
          if (alreadyDurable) {
            await eventRepository.markProcessed(updateId);
            return { ok: true, status: "processed" };
          }

          const mutation =
            event.message.kind === "text"
              ? mergeTelegramInboundText(workspace.state, {
                  ...event,
                  message: event.message,
                })
              : mergeTelegramInboundVoice(workspace.state, {
                  ...event,
                  message: event.message,
                });
          if (!mutation.ok) {
            throw new TelegramInboundError(
              "invalid_request",
              mutation.error,
            );
          }
          const saved = await workspaceRepository.save(
            workspaceId,
            workspace.revision,
            mutation.state,
          );
          if (saved.ok) {
            await eventRepository.markProcessed(updateId);
            return { ok: true, status: "processed" };
          }
          workspace = saved.workspace;
        }

        throw new TelegramInboundError(
          "revision_conflict",
          "Workspace changed during Telegram ingest",
        );
      } catch (error) {
        await eventRepository.markFailed(updateId, failureCode(error));
        throw error;
      }
    },
  };
}
