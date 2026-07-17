import { z } from "zod";

import {
  apiErrorCodeSchema,
  requestIdSchema,
  workspaceIdSchema,
  type ApiErrorCode,
} from "../src/contracts/api";
import {
  deliveryReceiptSchema,
  telegramVoiceSourceSchema,
  type DeliveryReceipt,
} from "../src/contracts/channel";

const timestampSchema = z.iso.datetime({ offset: true });
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const storedErrorSchema = z
  .object({
    code: apiErrorCodeSchema,
  })
  .strict();
const audioObjectPathSchema = z.string().trim().min(1).max(1024);
const audioContentTypeSchema = z.literal("audio/ogg");
const normalizedEventSchema = z.record(z.string(), z.unknown());

export const TELEGRAM_EVENT_STATUSES = [
  "received",
  "processed",
  "duplicate",
  "failed",
] as const;
export const TELEGRAM_DELIVERY_STATUSES = [
  "pending",
  "sending",
  "sent",
  "failed",
] as const;
export const TELEGRAM_DELIVERY_PARTS = ["text", "voice"] as const;
export const TELEGRAM_WORKSPACE_SYNC_STATUSES = ["pending", "synced"] as const;

const telegramEventStatusSchema = z.enum(TELEGRAM_EVENT_STATUSES);
const telegramDeliveryStatusSchema = z.enum(TELEGRAM_DELIVERY_STATUSES);
const telegramDeliveryPartSchema = z.enum(TELEGRAM_DELIVERY_PARTS);
const telegramWorkspaceSyncStatusSchema = z.enum(
  TELEGRAM_WORKSPACE_SYNC_STATUSES,
);

export const telegramEventRecordSchema = z
  .object({
    updateId: z.number().int().nonnegative(),
    workspaceId: workspaceIdSchema,
    payloadHash: hashSchema,
    status: telegramEventStatusSchema,
    normalizedMessageId: z.string().min(1).max(256),
    normalizedEvent: normalizedEventSchema.default({}),
    error: storedErrorSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (record.status === "failed" && record.error === null) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "Failed Telegram events require an error code",
      });
    }
  });

export const telegramDeliveryRecordSchema = z
  .object({
    requestId: requestIdSchema,
    part: telegramDeliveryPartSchema,
    workspaceId: workspaceIdSchema,
    conversationId: z.string().min(1).max(128),
    targetLanguage: z.string().trim().min(1).max(64),
    approvedText: z.string().trim().min(1).max(4096),
    approvedTextHash: hashSchema,
    voiceSource: telegramVoiceSourceSchema.nullable(),
    audioObjectPath: audioObjectPathSchema.nullable(),
    audioContentType: audioContentTypeSchema.nullable(),
    audioSha256: hashSchema.nullable(),
    ttsModel: z.string().trim().min(1).max(256).nullable(),
    ttsVoice: z.string().trim().min(1).max(128).nullable(),
    status: telegramDeliveryStatusSchema,
    workspaceSyncStatus: telegramWorkspaceSyncStatusSchema,
    providerMessageId: z.string().min(1).max(128).nullable(),
    providerAcceptedAt: timestampSchema.nullable(),
    error: storedErrorSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.status === "sent" &&
      (record.providerMessageId === null ||
        record.providerAcceptedAt === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["providerMessageId"],
        message: "Sent Telegram deliveries require provider acceptance",
      });
    }
    if (record.status === "failed" && record.error === null) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "Failed Telegram deliveries require an error code",
      });
    }
  });

const registerEventInputSchema = z
  .object({
    updateId: z.number().int().nonnegative(),
    workspaceId: workspaceIdSchema,
    payloadHash: hashSchema,
    normalizedMessageId: z.string().min(1).max(256),
    normalizedEvent: normalizedEventSchema.optional(),
  })
  .strict();

const createDeliveryInputSchema = z
  .object({
    requestId: requestIdSchema,
    part: telegramDeliveryPartSchema,
    workspaceId: workspaceIdSchema,
    conversationId: z.string().min(1).max(128),
    targetLanguage: z.string().trim().min(1).max(64),
    approvedText: z.string().trim().min(1).max(4096),
    approvedTextHash: hashSchema,
    voiceSource: telegramVoiceSourceSchema.nullable().optional(),
  })
  .strict();

export type TelegramEventStatus = z.infer<typeof telegramEventStatusSchema>;
export type TelegramDeliveryStatus = z.infer<
  typeof telegramDeliveryStatusSchema
>;
export type TelegramWorkspaceSyncStatus = z.infer<
  typeof telegramWorkspaceSyncStatusSchema
>;
export type TelegramEventRecord = z.infer<typeof telegramEventRecordSchema>;
export type TelegramDeliveryRecord = z.infer<
  typeof telegramDeliveryRecordSchema
>;
export type RegisterTelegramEventInput = z.infer<
  typeof registerEventInputSchema
>;
export type CreateTelegramDeliveryInput = z.infer<
  typeof createDeliveryInputSchema
>;

export type AttachTelegramVoiceArtifactInput = {
  requestId: string;
  objectPath: string;
  contentType: "audio/ogg";
  sha256: string;
  ttsModel?: string;
  ttsVoice?: string;
};

export interface TelegramEventDataSource {
  read(updateId: number): Promise<TelegramEventRecord | null>;
  insertIfAbsent(
    record: TelegramEventRecord,
  ): Promise<TelegramEventRecord | null>;
  updateIfStatus(
    record: TelegramEventRecord,
    expectedStatus: TelegramEventStatus,
  ): Promise<TelegramEventRecord | null>;
}

export interface TelegramDeliveryDataSource {
  read(
    requestId: string,
    part: TelegramDeliveryRecord["part"],
  ): Promise<TelegramDeliveryRecord | null>;
  insertIfAbsent(
    record: TelegramDeliveryRecord,
  ): Promise<TelegramDeliveryRecord | null>;
  updateIfStatus(
    record: TelegramDeliveryRecord,
    expectedStatus: TelegramDeliveryStatus,
  ): Promise<TelegramDeliveryRecord | null>;
  updateIfSyncStatus(
    record: TelegramDeliveryRecord,
    expectedStatus: TelegramWorkspaceSyncStatus,
  ): Promise<TelegramDeliveryRecord | null>;
}

export class TelegramRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramRepositoryError";
  }
}

export interface TelegramEventRepository {
  read(updateId: number): Promise<TelegramEventRecord | null>;
  register(input: RegisterTelegramEventInput): Promise<{
    inserted: boolean;
    record: TelegramEventRecord;
  }>;
  markProcessed(updateId: number): Promise<TelegramEventRecord>;
  markFailed(
    updateId: number,
    code: ApiErrorCode,
  ): Promise<TelegramEventRecord>;
}

export interface TelegramDeliveryRepository {
  read(
    requestId: string,
    part: TelegramDeliveryRecord["part"],
  ): Promise<TelegramDeliveryRecord | null>;
  createOrLoad(input: CreateTelegramDeliveryInput): Promise<{
    inserted: boolean;
    record: TelegramDeliveryRecord;
  }>;
  claim(
    requestId: string,
    part: TelegramDeliveryRecord["part"],
  ): Promise<TelegramDeliveryRecord | null>;
  markSent(
    requestId: string,
    part: TelegramDeliveryRecord["part"],
    receipt: DeliveryReceipt,
  ): Promise<TelegramDeliveryRecord>;
  markFailed(
    requestId: string,
    part: TelegramDeliveryRecord["part"],
    code: ApiErrorCode,
  ): Promise<TelegramDeliveryRecord>;
  markSynced(
    requestId: string,
    part: TelegramDeliveryRecord["part"],
  ): Promise<TelegramDeliveryRecord>;
  attachVoiceArtifact(
    input: AttachTelegramVoiceArtifactInput,
  ): Promise<TelegramDeliveryRecord>;
}

async function requireEvent(
  dataSource: TelegramEventDataSource,
  updateId: number,
): Promise<TelegramEventRecord> {
  const record = await dataSource.read(updateId);
  if (!record) {
    throw new TelegramRepositoryError("Telegram event not found");
  }
  return telegramEventRecordSchema.parse(record);
}

async function requireDelivery(
  dataSource: TelegramDeliveryDataSource,
  requestId: string,
  part: TelegramDeliveryRecord["part"],
): Promise<TelegramDeliveryRecord> {
  const record = await dataSource.read(requestId, part);
  if (!record) {
    throw new TelegramRepositoryError("Telegram delivery not found");
  }
  return telegramDeliveryRecordSchema.parse(record);
}

export function createTelegramEventRepository(
  dataSource: TelegramEventDataSource,
  now: () => string = () => new Date().toISOString(),
): TelegramEventRepository {
  return {
    async read(updateId) {
      const record = await dataSource.read(updateId);
      return record ? telegramEventRecordSchema.parse(record) : null;
    },

    async register(input) {
      const parsed = registerEventInputSchema.parse(input);
      const timestamp = timestampSchema.parse(now());
      const record = telegramEventRecordSchema.parse({
      ...parsed,
        normalizedEvent: parsed.normalizedEvent ?? {},
        status: "received",
        error: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const inserted = await dataSource.insertIfAbsent(record);
      if (inserted) {
        return {
          inserted: true,
          record: telegramEventRecordSchema.parse(inserted),
        };
      }
      return {
        inserted: false,
        record: await requireEvent(dataSource, parsed.updateId),
      };
    },

    async markProcessed(updateId) {
      const current = await requireEvent(dataSource, updateId);
      if (current.status === "processed") {
        return current;
      }
      const next = telegramEventRecordSchema.parse({
        ...current,
        status: "processed",
        error: null,
        updatedAt: now(),
      });
      const updated = await dataSource.updateIfStatus(next, current.status);
      if (updated) {
        return telegramEventRecordSchema.parse(updated);
      }
      return requireEvent(dataSource, updateId);
    },

    async markFailed(updateId, code) {
      const current = await requireEvent(dataSource, updateId);
      if (current.status === "processed") {
        return current;
      }
      const next = telegramEventRecordSchema.parse({
        ...current,
        status: "failed",
        error: { code: apiErrorCodeSchema.parse(code) },
        updatedAt: now(),
      });
      const updated = await dataSource.updateIfStatus(next, current.status);
      if (updated) {
        return telegramEventRecordSchema.parse(updated);
      }
      return requireEvent(dataSource, updateId);
    },
  };
}

export function createTelegramDeliveryRepository(
  dataSource: TelegramDeliveryDataSource,
  now: () => string = () => new Date().toISOString(),
): TelegramDeliveryRepository {
  return {
    async read(requestId, part) {
      const record = await dataSource.read(requestId, part);
      return record ? telegramDeliveryRecordSchema.parse(record) : null;
    },

    async createOrLoad(input) {
      const parsed = createDeliveryInputSchema.parse(input);
      const timestamp = timestampSchema.parse(now());
      const record = telegramDeliveryRecordSchema.parse({
        ...parsed,
        status: "pending",
        workspaceSyncStatus: "pending",
        providerMessageId: null,
        providerAcceptedAt: null,
        voiceSource: parsed.voiceSource ?? null,
        audioObjectPath: null,
        audioContentType: null,
        audioSha256: null,
        ttsModel: null,
        ttsVoice: null,
        error: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const inserted = await dataSource.insertIfAbsent(record);
      if (inserted) {
        return {
          inserted: true,
          record: telegramDeliveryRecordSchema.parse(inserted),
        };
      }
      return {
        inserted: false,
        record: await requireDelivery(
          dataSource,
          parsed.requestId,
          parsed.part,
        ),
      };
    },

    async claim(requestId, part) {
      const current = await requireDelivery(dataSource, requestId, part);
      if (current.status !== "pending" && current.status !== "failed") {
        return null;
      }
      const next = telegramDeliveryRecordSchema.parse({
        ...current,
        status: "sending",
        providerMessageId: null,
        providerAcceptedAt: null,
        error: null,
        updatedAt: now(),
      });
      const updated = await dataSource.updateIfStatus(next, current.status);
      return updated ? telegramDeliveryRecordSchema.parse(updated) : null;
    },

    async markSent(requestId, part, receipt) {
      const current = await requireDelivery(dataSource, requestId, part);
      if (current.status === "sent") {
        return current;
      }
      if (current.status !== "sending") {
        throw new TelegramRepositoryError(
          "Telegram delivery is not being sent",
        );
      }
      const accepted = deliveryReceiptSchema.parse(receipt);
      const next = telegramDeliveryRecordSchema.parse({
        ...current,
        status: "sent",
        providerMessageId: accepted.providerMessageId,
        providerAcceptedAt: accepted.acceptedAt,
        error: null,
        updatedAt: now(),
      });
      const updated = await dataSource.updateIfStatus(next, "sending");
      if (!updated) {
        return requireDelivery(dataSource, requestId, part);
      }
      return telegramDeliveryRecordSchema.parse(updated);
    },

    async markFailed(requestId, part, code) {
      const current = await requireDelivery(dataSource, requestId, part);
      if (current.status !== "sending") {
        throw new TelegramRepositoryError(
          "Telegram delivery is not being sent",
        );
      }
      const next = telegramDeliveryRecordSchema.parse({
        ...current,
        status: "failed",
        error: { code: apiErrorCodeSchema.parse(code) },
        updatedAt: now(),
      });
      const updated = await dataSource.updateIfStatus(next, "sending");
      if (!updated) {
        return requireDelivery(dataSource, requestId, part);
      }
      return telegramDeliveryRecordSchema.parse(updated);
    },

    async markSynced(requestId, part) {
      const current = await requireDelivery(dataSource, requestId, part);
      if (current.status !== "sent") {
        throw new TelegramRepositoryError(
          "Telegram delivery was not accepted",
        );
      }
      if (current.workspaceSyncStatus === "synced") {
        return current;
      }
      const next = telegramDeliveryRecordSchema.parse({
        ...current,
        workspaceSyncStatus: "synced",
        updatedAt: now(),
      });
      const updated = await dataSource.updateIfSyncStatus(next, "pending");
      if (!updated) {
        return requireDelivery(dataSource, requestId, part);
      }
      return telegramDeliveryRecordSchema.parse(updated);
    },

    async attachVoiceArtifact(input) {
      const requestId = requestIdSchema.parse(input.requestId);
      const current = await requireDelivery(dataSource, requestId, "voice");
      if (current.status === "sent" || current.status === "sending") {
        throw new TelegramRepositoryError(
          "Voice audio cannot change after delivery begins",
        );
      }
      const next = telegramDeliveryRecordSchema.parse({
        ...current,
        status: "pending",
        error: null,
        audioObjectPath: audioObjectPathSchema.parse(input.objectPath),
        audioContentType: audioContentTypeSchema.parse(input.contentType),
        audioSha256: hashSchema.parse(input.sha256),
        ttsModel: input.ttsModel
          ? z.string().trim().min(1).max(256).parse(input.ttsModel)
          : null,
        ttsVoice: input.ttsVoice
          ? z.string().trim().min(1).max(128).parse(input.ttsVoice)
          : null,
        updatedAt: now(),
      });
      const updated = await dataSource.updateIfStatus(next, current.status);
      return updated
        ? telegramDeliveryRecordSchema.parse(updated)
        : requireDelivery(dataSource, requestId, "voice");
    },
  };
}
