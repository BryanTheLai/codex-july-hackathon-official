import { z } from "zod";

import { workspaceIdSchema } from "../src/contracts/api";

const timestampSchema = z.iso.datetime({ offset: true });
const connectionStatusSchema = z.enum(["connected", "revoked", "error"]);

export const googleCalendarConnectionSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    calendarId: z.string().trim().min(1).max(512),
    refreshTokenCiphertext: z.string().trim().min(1).max(8_192),
    grantedScope: z.string().trim().min(1).max(4_096),
    status: connectionStatusSchema,
    lastError: z.string().trim().min(1).max(2_000).nullable(),
    connectedAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const googleCalendarEventRecordSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    conversationId: z.string().trim().min(1).max(256),
    eventId: z.string().trim().min(5).max(1_024),
    bookingRevision: z.number().int().positive(),
    status: z.enum(["active", "cancelled"]),
    eventEtag: z.string().trim().min(1).max(1_024).nullable(),
    lastSyncedAt: timestampSchema,
  })
  .strict();

export type GoogleCalendarConnection = z.infer<typeof googleCalendarConnectionSchema>;
export type GoogleCalendarEventRecord = z.infer<typeof googleCalendarEventRecordSchema>;

export interface GoogleCalendarConnectionDataSource {
  read(workspaceId: string): Promise<GoogleCalendarConnection | null>;
  upsert(record: GoogleCalendarConnection): Promise<void>;
}

export interface GoogleCalendarEventDataSource {
  upsert(record: GoogleCalendarEventRecord): Promise<void>;
  listByWorkspace(workspaceId: string): Promise<GoogleCalendarEventRecord[]>;
  deleteMapping(workspaceId: string, conversationId: string): Promise<void>;
}

export interface GoogleCalendarConnectionRepository {
  get(workspaceId: string): Promise<GoogleCalendarConnection | null>;
  save(input: Omit<GoogleCalendarConnection, "connectedAt" | "updatedAt">): Promise<void>;
}

export interface GoogleCalendarEventRepository {
  save(input: Omit<GoogleCalendarEventRecord, "lastSyncedAt">): Promise<void>;
  listByWorkspace(workspaceId: string): Promise<GoogleCalendarEventRecord[]>;
  deleteMapping(workspaceId: string, conversationId: string): Promise<void>;
}

export function createGoogleCalendarConnectionRepository(
  dataSource: GoogleCalendarConnectionDataSource,
  now: () => string = () => new Date().toISOString(),
): GoogleCalendarConnectionRepository {
  return {
    async get(workspaceId) {
      const record = await dataSource.read(workspaceIdSchema.parse(workspaceId));
      return record ? googleCalendarConnectionSchema.parse(record) : null;
    },
    async save(input) {
      const timestamp = timestampSchema.parse(now());
      const existing = await dataSource.read(input.workspaceId);
      await dataSource.upsert(
        googleCalendarConnectionSchema.parse({
          ...input,
          connectedAt: existing?.connectedAt ?? timestamp,
          updatedAt: timestamp,
        }),
      );
    },
  };
}

export function createGoogleCalendarEventRepository(
  dataSource: GoogleCalendarEventDataSource,
  now: () => string = () => new Date().toISOString(),
): GoogleCalendarEventRepository {
  return {
    async save(input) {
      await dataSource.upsert(
        googleCalendarEventRecordSchema.parse({
          ...input,
          lastSyncedAt: timestampSchema.parse(now()),
        }),
      );
    },
    async listByWorkspace(workspaceId) {
      const records = await dataSource.listByWorkspace(
        workspaceIdSchema.parse(workspaceId),
      );
      return records.map((record) => googleCalendarEventRecordSchema.parse(record));
    },
    async deleteMapping(workspaceId, conversationId) {
      await dataSource.deleteMapping(
        workspaceIdSchema.parse(workspaceId),
        conversationId,
      );
    },
  };
}
