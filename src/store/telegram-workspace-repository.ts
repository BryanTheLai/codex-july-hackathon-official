import { z } from "zod";

import { revisionSchema } from "../contracts/app-state";

const telegramDeliveryNoticeSchema = z
  .object({
    conversationId: z.string().min(1),
    requestId: z.string().min(1),
    targetLanguage: z.string().min(1),
    approvedPatientText: z.string().min(1),
    mode: z.enum(["text", "voice", "both"]),
    voiceSource: z.enum(["tts", "recorded"]).nullable(),
    status: z.enum(["sending", "sent", "voice_sent", "partial_failure", "failed"]),
    retryStage: z.enum(["send", "voice_prepare"]),
    failedParts: z.array(z.enum(["text", "voice"])),
    message: z.string().min(1),
  })
  .strict();

export const TELEGRAM_WORKSPACE_STORAGE_KEY =
  "kaunter-ai-telegram-workspace-v1";

const telegramWorkspaceStateSchema = z
  .object({
    status: z.enum(["local", "loading", "ready", "error"]),
    workspaceRevision: revisionSchema.nullable(),
    conversationRevisions: z.record(
      z.string(),
      revisionSchema,
    ),
    speechArtifacts: z.record(
      z.string(),
      z
        .object({
          status: z.enum(["pending", "transcribing", "ready", "failed"]),
          error: z.string().nullable(),
        })
        .strict(),
    ),
    pendingDelivery: z
      .object({
        conversationId: z.string().min(1),
        deliveryId: z.string().min(1),
      })
      .strict()
      .nullable(),
    deliveryNotice: telegramDeliveryNoticeSchema.nullable().default(null),
  })
  .strict();

const persistedTelegramWorkspaceSchema = z
  .object({
    version: z.literal(1),
    state: telegramWorkspaceStateSchema,
  })
  .strict();

export type TelegramWorkspaceState = z.infer<
  typeof telegramWorkspaceStateSchema
>;
export type TelegramDeliveryNotice = z.infer<
  typeof telegramDeliveryNoticeSchema
>;

export const INITIAL_TELEGRAM_WORKSPACE: TelegramWorkspaceState = {
  status: "local",
  workspaceRevision: null,
  conversationRevisions: {},
  speechArtifacts: {},
  pendingDelivery: null,
  deliveryNotice: null,
};

export interface TelegramWorkspaceRepository {
  clear(): void;
  load(): TelegramWorkspaceState;
  save(state: TelegramWorkspaceState): void;
}

export function createTelegramWorkspaceRepository(
  storage: Storage,
): TelegramWorkspaceRepository {
  return {
    clear() {
      storage.removeItem(TELEGRAM_WORKSPACE_STORAGE_KEY);
    },

    load() {
      const raw = storage.getItem(TELEGRAM_WORKSPACE_STORAGE_KEY);
      if (!raw) {
        return structuredClone(INITIAL_TELEGRAM_WORKSPACE);
      }
      try {
        const parsed = persistedTelegramWorkspaceSchema.parse(
          JSON.parse(raw),
        );
        return {
          ...parsed.state,
          status:
            parsed.state.workspaceRevision === null
              ? "local"
              : "ready",
        };
      } catch {
        storage.removeItem(TELEGRAM_WORKSPACE_STORAGE_KEY);
        return structuredClone(INITIAL_TELEGRAM_WORKSPACE);
      }
    },

    save(state) {
      storage.setItem(
        TELEGRAM_WORKSPACE_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          state: telegramWorkspaceStateSchema.parse(state),
        }),
      );
    },
  };
}
