import { z } from "zod";

import {
  apiErrorCodeSchema,
  requestIdSchema,
  workspaceIdSchema,
  type ApiErrorCode,
} from "../src/contracts/api";
import { deliveryReceiptSchema, type DeliveryReceipt } from "../src/contracts/channel";

const timestampSchema = z.iso.datetime({ offset: true });
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const statusSchema = z.enum(["pending", "sending", "sent", "failed", "unknown"]);

export type CalendarDeliveryStatus = z.infer<typeof statusSchema>;

export const calendarDeliveryRecordSchema = z
  .object({
    requestId: requestIdSchema,
    workspaceId: workspaceIdSchema,
    conversationId: z.string().min(1).max(128),
    calendarUid: z.string().min(1).max(512),
    calendarSequence: z.number().int().nonnegative(),
    kind: z.enum(["publish", "cancel"]),
    contentHash: hashSchema,
    status: statusSchema,
    providerMessageId: z.string().min(1).max(128).nullable(),
    providerAcceptedAt: timestampSchema.nullable(),
    error: z.object({ code: apiErrorCodeSchema }).strict().nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.status === "sent" &&
      (value.providerMessageId === null || value.providerAcceptedAt === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["providerMessageId"],
        message: "Sent calendar deliveries require a provider receipt",
      });
    }
    if (value.status === "failed" && value.error === null) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "Failed calendar deliveries require an error code",
      });
    }
  });

const createInputSchema = z
  .object({
    requestId: requestIdSchema,
    workspaceId: workspaceIdSchema,
    conversationId: z.string().min(1).max(128),
    calendarUid: z.string().min(1).max(512),
    calendarSequence: z.number().int().nonnegative(),
    kind: z.enum(["publish", "cancel"]),
    contentHash: hashSchema,
  })
  .strict();

export type CalendarDeliveryRecord = z.infer<typeof calendarDeliveryRecordSchema>;
export type CreateCalendarDeliveryInput = z.infer<typeof createInputSchema>;

export interface CalendarDeliveryDataSource {
  read(requestId: string): Promise<CalendarDeliveryRecord | null>;
  insertIfAbsent(record: CalendarDeliveryRecord): Promise<CalendarDeliveryRecord | null>;
  updateIfStatus(
    record: CalendarDeliveryRecord,
    expectedStatus: CalendarDeliveryStatus,
  ): Promise<CalendarDeliveryRecord | null>;
}

export interface CalendarDeliveryRepository {
  read(requestId: string): Promise<CalendarDeliveryRecord | null>;
  createOrLoad(input: CreateCalendarDeliveryInput): Promise<{
    inserted: boolean;
    record: CalendarDeliveryRecord;
  }>;
  claim(requestId: string): Promise<CalendarDeliveryRecord | null>;
  markSent(requestId: string, receipt: DeliveryReceipt): Promise<CalendarDeliveryRecord>;
  markFailed(requestId: string, code: ApiErrorCode): Promise<CalendarDeliveryRecord>;
  markUnknown(requestId: string, code: ApiErrorCode): Promise<CalendarDeliveryRecord>;
}

export class CalendarRepositoryError extends Error {
  constructor(message: string) {
    super(message);
  }
}

function nowIso(now: () => string): string {
  return timestampSchema.parse(now());
}

async function requireRecord(
  source: CalendarDeliveryDataSource,
  requestId: string,
): Promise<CalendarDeliveryRecord> {
  const record = await source.read(requestId);
  if (!record) throw new CalendarRepositoryError("Calendar delivery was not found");
  return calendarDeliveryRecordSchema.parse(record);
}

export function createCalendarDeliveryRepository(
  source: CalendarDeliveryDataSource,
  now: () => string = () => new Date().toISOString(),
): CalendarDeliveryRepository {
  return {
    async read(requestId) {
      requestIdSchema.parse(requestId);
      const record = await source.read(requestId);
      return record ? calendarDeliveryRecordSchema.parse(record) : null;
    },

    async createOrLoad(input) {
      const value = createInputSchema.parse(input);
      const timestamp = nowIso(now);
      const record = calendarDeliveryRecordSchema.parse({
        ...value,
        status: "pending",
        providerMessageId: null,
        providerAcceptedAt: null,
        error: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const inserted = await source.insertIfAbsent(record);
      if (inserted) return { inserted: true, record: calendarDeliveryRecordSchema.parse(inserted) };
      return { inserted: false, record: await requireRecord(source, value.requestId) };
    },

    async claim(requestId) {
      requestIdSchema.parse(requestId);
      const current = await requireRecord(source, requestId);
      if (current.status !== "pending" && current.status !== "failed") return null;
      const next = calendarDeliveryRecordSchema.parse({
        ...current,
        status: "sending",
        error: null,
        updatedAt: nowIso(now),
      });
      const updated = await source.updateIfStatus(next, current.status);
      return updated ? calendarDeliveryRecordSchema.parse(updated) : null;
    },

    async markSent(requestId, receipt) {
      const current = await requireRecord(source, requestId);
      if (current.status === "sent") return current;
      if (current.status !== "sending") {
        throw new CalendarRepositoryError("Calendar delivery is not being sent");
      }
      const accepted = deliveryReceiptSchema.parse(receipt);
      const next = calendarDeliveryRecordSchema.parse({
        ...current,
        status: "sent",
        providerMessageId: accepted.providerMessageId,
        providerAcceptedAt: accepted.acceptedAt,
        updatedAt: nowIso(now),
      });
      const updated = await source.updateIfStatus(next, "sending");
      return updated ? calendarDeliveryRecordSchema.parse(updated) : requireRecord(source, requestId);
    },

    async markFailed(requestId, code) {
      const current = await requireRecord(source, requestId);
      if (current.status === "failed") return current;
      if (current.status !== "sending") {
        throw new CalendarRepositoryError("Calendar delivery is not being sent");
      }
      const next = calendarDeliveryRecordSchema.parse({
        ...current,
        status: "failed",
        error: { code: apiErrorCodeSchema.parse(code) },
        updatedAt: nowIso(now),
      });
      const updated = await source.updateIfStatus(next, "sending");
      return updated ? calendarDeliveryRecordSchema.parse(updated) : requireRecord(source, requestId);
    },

    async markUnknown(requestId, code) {
      const current = await requireRecord(source, requestId);
      if (current.status === "unknown") return current;
      if (current.status !== "sending") {
        throw new CalendarRepositoryError("Calendar delivery is not being sent");
      }
      const next = calendarDeliveryRecordSchema.parse({
        ...current,
        status: "unknown",
        error: { code: apiErrorCodeSchema.parse(code) },
        updatedAt: nowIso(now),
      });
      const updated = await source.updateIfStatus(next, "sending");
      return updated ? calendarDeliveryRecordSchema.parse(updated) : requireRecord(source, requestId);
    },
  };
}
