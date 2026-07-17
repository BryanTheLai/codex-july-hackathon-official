import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { z } from "zod";

import {
  revisionSchema,
  serverDomainStateSchema,
  type ServerDomainStatePayload,
} from "../src/contracts/app-state";
import {
  saveWorkspaceResultSchema,
  workspaceEnvelopeSchema,
  workspaceIdSchema,
  type SaveWorkspaceResult,
  type WorkspaceEnvelope,
} from "../src/contracts/api";
import { SCHEMA_VERSION } from "../src/contracts/constants";
import type {
  TelegramDeliveryDataSource,
  TelegramDeliveryRecord,
  TelegramEventDataSource,
  TelegramEventRecord,
} from "./telegram-repository";
import {
  telegramDeliveryRecordSchema,
  telegramEventRecordSchema,
} from "./telegram-repository";
import type {
  CalendarDeliveryDataSource,
  CalendarDeliveryRecord,
  CalendarDeliveryStatus,
} from "./calendar-repository";
import { calendarDeliveryRecordSchema } from "./calendar-repository";
import type {
  EnqueueOutboxJob,
  OutboxDataSource,
  OutboxJob,
} from "./outbox-repository";
import { outboxJobSchema } from "./outbox-repository";
import type {
  GoogleCalendarConnection,
  GoogleCalendarConnectionDataSource,
  GoogleCalendarEventDataSource,
} from "./google-calendar-repository";
import {
  googleCalendarConnectionSchema,
  googleCalendarEventRecordSchema,
  type GoogleCalendarEventRecord,
} from "./google-calendar-repository";
import type {
  WorkspaceDataSource,
  WorkspaceRecord,
} from "./workspace-repository";

const supabaseEnvironmentSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  KAUNTER_WORKSPACE_ID: workspaceIdSchema,
});

const workspaceRowSchema = z
  .object({
    workspace_id: workspaceIdSchema,
    schema_version: z.literal(SCHEMA_VERSION),
    revision: revisionSchema,
    state: serverDomainStateSchema,
  })
  .strict();

const telegramEventRowSchema = z
  .object({
    update_id: z.number().int().nonnegative(),
    workspace_id: workspaceIdSchema,
    payload_hash: z.string(),
    status: z.string(),
    normalized_message_id: z.string(),
    normalized_event: z.record(z.string(), z.unknown()).default({}),
    error: z.unknown().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();

const telegramDeliveryRowSchema = z
  .object({
    request_id: z.string(),
    part: z.string(),
    workspace_id: workspaceIdSchema,
    conversation_id: z.string(),
    target_language: z.string(),
    approved_text: z.string(),
    approved_text_hash: z.string(),
    voice_source: z.string().nullable(),
    audio_object_path: z.string().nullable(),
    audio_content_type: z.string().nullable(),
    audio_sha256: z.string().nullable(),
    tts_model: z.string().nullable(),
    tts_voice: z.string().nullable(),
    status: z.string(),
    workspace_sync_status: z.string(),
    provider_message_id: z.string().nullable(),
    provider_accepted_at: z.string().nullable(),
    error: z.unknown().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();

const calendarDeliveryRowSchema = z
  .object({
    request_id: z.string(),
    workspace_id: workspaceIdSchema,
    conversation_id: z.string(),
    calendar_uid: z.string(),
    calendar_sequence: z.number().int(),
    kind: z.string(),
    content_hash: z.string(),
    status: z.string(),
    provider_message_id: z.string().nullable(),
    provider_accepted_at: z.string().nullable(),
    error: z.unknown().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();

const outboxJobRowSchema = z
  .object({
    id: z.number().int().positive(),
    workspace_id: workspaceIdSchema,
    kind: z.string(),
    dedupe_key: z.string(),
    payload: z.record(z.string(), z.unknown()),
    status: z.string(),
    attempts: z.number().int().nonnegative(),
    available_at: z.string(),
    locked_at: z.string().nullable(),
    last_error: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();

const googleCalendarEventRowSchema = z
  .object({
    workspace_id: workspaceIdSchema,
    conversation_id: z.string(),
    event_id: z.string(),
    booking_revision: z.number().int().positive(),
    status: z.string(),
    event_etag: z.string().nullable(),
    last_synced_at: z.string(),
  })
  .strict();

const demoSeedTemplateRowSchema = z
  .object({
    seed_key: z.string(),
    schema_version: z.literal(SCHEMA_VERSION),
    source_state: z.record(z.string(), z.unknown()),
    state: serverDomainStateSchema.nullable(),
    compiled_at: z.string().nullable(),
  })
  .strict();

const googleCalendarConnectionRowSchema = z
  .object({
    workspace_id: workspaceIdSchema,
    calendar_id: z.string(),
    refresh_token_ciphertext: z.string(),
    granted_scope: z.string(),
    status: z.string(),
    last_error: z.string().nullable(),
    connected_at: z.string(),
    updated_at: z.string(),
  })
  .strict();

export type SupabaseConfig = {
  url: string;
  serviceRoleKey: string;
  workspaceId: string;
};

export type SupabaseDataSourceOperation = "read" | "insert" | "update";

export class SupabaseDataSourceError extends Error {
  readonly operation: SupabaseDataSourceOperation;

  constructor(operation: SupabaseDataSourceOperation, message: string) {
    super(message);
    this.name = "SupabaseDataSourceError";
    this.operation = operation;
  }
}

export function readSupabaseConfig(
  environment: Record<string, string | undefined> = process.env,
): SupabaseConfig {
  const parsed = supabaseEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error("Supabase server configuration is invalid");
  }
  return {
    url: parsed.data.SUPABASE_URL,
    serviceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
    workspaceId: parsed.data.KAUNTER_WORKSPACE_ID,
  };
}

export function createSupabaseServerClient(
  config: SupabaseConfig,
): SupabaseClient {
  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

function toWorkspaceRecord(row: unknown): WorkspaceRecord {
  const parsed = workspaceRowSchema.parse(row);
  return {
    workspaceId: parsed.workspace_id,
    schemaVersion: parsed.schema_version,
    revision: parsed.revision,
    state: parsed.state,
  };
}

function toInsertRow(record: WorkspaceRecord) {
  return {
    workspace_id: record.workspaceId,
    schema_version: record.schemaVersion,
    revision: record.revision,
    state: record.state,
  };
}

function toTelegramEventRecord(row: unknown): TelegramEventRecord {
  const parsed = telegramEventRowSchema.parse(row);
  return telegramEventRecordSchema.parse({
    updateId: parsed.update_id,
    workspaceId: parsed.workspace_id,
    payloadHash: parsed.payload_hash,
    status: parsed.status,
    normalizedMessageId: parsed.normalized_message_id,
    normalizedEvent: parsed.normalized_event,
    error: parsed.error,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
  });
}

function toTelegramEventRow(record: TelegramEventRecord) {
  return {
    update_id: record.updateId,
    workspace_id: record.workspaceId,
    payload_hash: record.payloadHash,
    status: record.status,
    normalized_message_id: record.normalizedMessageId,
    normalized_event: record.normalizedEvent,
    error: record.error,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function toTelegramDeliveryRecord(row: unknown): TelegramDeliveryRecord {
  const parsed = telegramDeliveryRowSchema.parse(row);
  return telegramDeliveryRecordSchema.parse({
    requestId: parsed.request_id,
    part: parsed.part,
    workspaceId: parsed.workspace_id,
    conversationId: parsed.conversation_id,
    targetLanguage: parsed.target_language,
    approvedText: parsed.approved_text,
    approvedTextHash: parsed.approved_text_hash,
    voiceSource: parsed.voice_source,
    audioObjectPath: parsed.audio_object_path,
    audioContentType: parsed.audio_content_type,
    audioSha256: parsed.audio_sha256,
    ttsModel: parsed.tts_model,
    ttsVoice: parsed.tts_voice,
    status: parsed.status,
    workspaceSyncStatus: parsed.workspace_sync_status,
    providerMessageId: parsed.provider_message_id,
    providerAcceptedAt: parsed.provider_accepted_at,
    error: parsed.error,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
  });
}

function toTelegramDeliveryRow(record: TelegramDeliveryRecord) {
  return {
    request_id: record.requestId,
    part: record.part,
    workspace_id: record.workspaceId,
    conversation_id: record.conversationId,
    target_language: record.targetLanguage,
    approved_text: record.approvedText,
    approved_text_hash: record.approvedTextHash,
    voice_source: record.voiceSource,
    audio_object_path: record.audioObjectPath,
    audio_content_type: record.audioContentType,
    audio_sha256: record.audioSha256,
    tts_model: record.ttsModel,
    tts_voice: record.ttsVoice,
    status: record.status,
    workspace_sync_status: record.workspaceSyncStatus,
    provider_message_id: record.providerMessageId,
    provider_accepted_at: record.providerAcceptedAt,
    error: record.error,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function toCalendarDeliveryRecord(row: unknown): CalendarDeliveryRecord {
  const parsed = calendarDeliveryRowSchema.parse(row);
  return calendarDeliveryRecordSchema.parse({
    requestId: parsed.request_id,
    workspaceId: parsed.workspace_id,
    conversationId: parsed.conversation_id,
    calendarUid: parsed.calendar_uid,
    calendarSequence: parsed.calendar_sequence,
    kind: parsed.kind,
    contentHash: parsed.content_hash,
    status: parsed.status,
    providerMessageId: parsed.provider_message_id,
    providerAcceptedAt: parsed.provider_accepted_at,
    error: parsed.error,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
  });
}

function toCalendarDeliveryRow(record: CalendarDeliveryRecord) {
  return {
    request_id: record.requestId,
    workspace_id: record.workspaceId,
    conversation_id: record.conversationId,
    calendar_uid: record.calendarUid,
    calendar_sequence: record.calendarSequence,
    kind: record.kind,
    content_hash: record.contentHash,
    status: record.status,
    provider_message_id: record.providerMessageId,
    provider_accepted_at: record.providerAcceptedAt,
    error: record.error,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function toOutboxJob(row: unknown): OutboxJob {
  const parsed = outboxJobRowSchema.parse(row);
  return outboxJobSchema.parse({
    id: parsed.id,
    workspaceId: parsed.workspace_id,
    kind: parsed.kind,
    dedupeKey: parsed.dedupe_key,
    payload: parsed.payload,
    status: parsed.status,
    attempts: parsed.attempts,
    availableAt: parsed.available_at,
    lockedAt: parsed.locked_at,
    lastError: parsed.last_error,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
  });
}

function toGoogleCalendarConnection(row: unknown): GoogleCalendarConnection {
  const parsed = googleCalendarConnectionRowSchema.parse(row);
  return googleCalendarConnectionSchema.parse({
    workspaceId: parsed.workspace_id,
    calendarId: parsed.calendar_id,
    refreshTokenCiphertext: parsed.refresh_token_ciphertext,
    grantedScope: parsed.granted_scope,
    status: parsed.status,
    lastError: parsed.last_error,
    connectedAt: parsed.connected_at,
    updatedAt: parsed.updated_at,
  });
}

function toGoogleCalendarEventRecord(row: unknown): GoogleCalendarEventRecord {
  const parsed = googleCalendarEventRowSchema.parse(row);
  return googleCalendarEventRecordSchema.parse({
    workspaceId: parsed.workspace_id,
    conversationId: parsed.conversation_id,
    eventId: parsed.event_id,
    bookingRevision: parsed.booking_revision,
    status: parsed.status,
    eventEtag: parsed.event_etag,
    lastSyncedAt: parsed.last_synced_at,
  });
}

function throwDataSourceError(
  operation: SupabaseDataSourceOperation,
): never {
  throw new SupabaseDataSourceError(
    operation,
    `Supabase workspace ${operation} failed`,
  );
}

const workspaceColumns = "workspace_id,schema_version,revision,state";
const telegramEventColumns =
  "update_id,workspace_id,payload_hash,status,normalized_message_id,normalized_event,error,created_at,updated_at";
const telegramDeliveryColumns =
  "request_id,part,workspace_id,conversation_id,target_language,approved_text,approved_text_hash,voice_source,audio_object_path,audio_content_type,audio_sha256,tts_model,tts_voice,status,workspace_sync_status,provider_message_id,provider_accepted_at,error,created_at,updated_at";
const calendarDeliveryColumns =
  "request_id,workspace_id,conversation_id,calendar_uid,calendar_sequence,kind,content_hash,status,provider_message_id,provider_accepted_at,error,created_at,updated_at";
const googleCalendarConnectionColumns =
  "workspace_id,calendar_id,refresh_token_ciphertext,granted_scope,status,last_error,connected_at,updated_at";
const googleCalendarEventColumns =
  "workspace_id,conversation_id,event_id,booking_revision,status,event_etag,last_synced_at";
const demoSeedTemplateColumns =
  "seed_key,schema_version,source_state,state,compiled_at";

const resetDemoWorkspaceRpcResultSchema = z
  .object({
    workspace_id: workspaceIdSchema,
    seed_key: z.string(),
    previous_revision: revisionSchema,
    new_revision: revisionSchema,
    outbox_rows_removed: z.number().int().nonnegative(),
    google_events_removed: z.number().int().nonnegative(),
    calendar_deliveries_removed: z.number().int().nonnegative(),
    telegram_deliveries_removed: z.number().int().nonnegative(),
    telegram_events_removed: z.number().int().nonnegative(),
    oauth_preserved: z.literal(true),
  })
  .strict();

export type DemoWorkspaceResetSummary = {
  seedKey: string;
  previousRevision: number;
  newRevision: number;
  outboxRowsRemoved: number;
  googleEventsRemoved: number;
  calendarDeliveriesRemoved: number;
  telegramDeliveriesRemoved: number;
  telegramEventsRemoved: number;
  oauthPreserved: true;
};

export type ResetDemoWorkspaceResult =
  | {
      ok: true;
      workspace: WorkspaceEnvelope;
      summary: DemoWorkspaceResetSummary;
    }
  | Extract<SaveWorkspaceResult, { ok: false }>;

export interface DemoWorkspaceResetDataSource {
  reset(
    workspaceId: string,
    seedKey: string,
    expectedRevision: number,
  ): Promise<ResetDemoWorkspaceResult>;
}

function toWorkspaceEnvelope(record: WorkspaceRecord): WorkspaceEnvelope {
  return workspaceEnvelopeSchema.parse({
    workspaceId: record.workspaceId,
    revision: record.revision,
    state: record.state,
  });
}

function toResetSummary(
  row: z.infer<typeof resetDemoWorkspaceRpcResultSchema>,
): DemoWorkspaceResetSummary {
  return {
    seedKey: row.seed_key,
    previousRevision: row.previous_revision,
    newRevision: row.new_revision,
    outboxRowsRemoved: row.outbox_rows_removed,
    googleEventsRemoved: row.google_events_removed,
    calendarDeliveriesRemoved: row.calendar_deliveries_removed,
    telegramDeliveriesRemoved: row.telegram_deliveries_removed,
    telegramEventsRemoved: row.telegram_events_removed,
    oauthPreserved: row.oauth_preserved,
  };
}

function isRevisionConflictError(
  error: { message?: string } | null,
): boolean {
  return error?.message?.includes("revision_conflict") ?? false;
}

export function createSupabaseWorkspaceDataSource(
  client: SupabaseClient,
  now: () => string = () => new Date().toISOString(),
): WorkspaceDataSource {
  return {
    async read(workspaceId) {
      const { data, error } = await client
        .from("demo_state")
        .select(workspaceColumns)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (error) {
        return throwDataSourceError("read");
      }
      return data ? toWorkspaceRecord(data) : null;
    },

    async insertIfAbsent(record) {
      const { data, error } = await client
        .from("demo_state")
        .insert(toInsertRow(record))
        .select(workspaceColumns)
        .maybeSingle();
      if (error?.code === "23505") {
        return null;
      }
      if (error) {
        return throwDataSourceError("insert");
      }
      return data ? toWorkspaceRecord(data) : null;
    },

    async updateIfRevision(record, expectedRevision) {
      const { workspace_id: _workspaceId, ...update } = toInsertRow(record);
      const { data, error } = await client
        .from("demo_state")
        .update({
          ...update,
          updated_at: now(),
        })
        .eq("workspace_id", record.workspaceId)
        .eq("revision", expectedRevision)
        .select(workspaceColumns)
        .maybeSingle();
      if (error) {
        return throwDataSourceError("update");
      }
      return data ? toWorkspaceRecord(data) : null;
    },
  };
}

export function createSupabaseTelegramEventDataSource(
  client: SupabaseClient,
  now: () => string = () => new Date().toISOString(),
): TelegramEventDataSource {
  return {
    async read(updateId) {
      const { data, error } = await client
        .from("telegram_events")
        .select(telegramEventColumns)
        .eq("update_id", updateId)
        .maybeSingle();
      if (error) {
        return throwDataSourceError("read");
      }
      return data ? toTelegramEventRecord(data) : null;
    },

    async insertIfAbsent(record) {
      const { data, error } = await client
        .from("telegram_events")
        .insert(toTelegramEventRow(record))
        .select(telegramEventColumns)
        .maybeSingle();
      if (error?.code === "23505") {
        return null;
      }
      if (error) {
        return throwDataSourceError("insert");
      }
      return data ? toTelegramEventRecord(data) : null;
    },

    async updateIfStatus(record, expectedStatus) {
      const {
        update_id: updateId,
        created_at: _createdAt,
        ...update
      } = toTelegramEventRow(record);
      const { data, error } = await client
        .from("telegram_events")
        .update({
          ...update,
          updated_at: now(),
        })
        .eq("update_id", updateId)
        .eq("status", expectedStatus)
        .select(telegramEventColumns)
        .maybeSingle();
      if (error) {
        return throwDataSourceError("update");
      }
      return data ? toTelegramEventRecord(data) : null;
    },
  };
}

export function createSupabaseTelegramDeliveryDataSource(
  client: SupabaseClient,
  now: () => string = () => new Date().toISOString(),
): TelegramDeliveryDataSource {
  const update = async (
    record: TelegramDeliveryRecord,
    filterColumn: "status" | "workspace_sync_status",
    filterValue: string,
  ): Promise<TelegramDeliveryRecord | null> => {
    const {
      request_id: requestId,
      part,
      created_at: _createdAt,
      ...changes
    } = toTelegramDeliveryRow(record);
    const { data, error } = await client
      .from("telegram_deliveries")
      .update({
        ...changes,
        updated_at: now(),
      })
      .eq("request_id", requestId)
      .eq("part", part)
      .eq(filterColumn, filterValue)
      .select(telegramDeliveryColumns)
      .maybeSingle();
    if (error) {
      return throwDataSourceError("update");
    }
    return data ? toTelegramDeliveryRecord(data) : null;
  };

  return {
    async read(requestId, part) {
      const { data, error } = await client
        .from("telegram_deliveries")
        .select(telegramDeliveryColumns)
        .eq("request_id", requestId)
        .eq("part", part)
        .maybeSingle();
      if (error) {
        return throwDataSourceError("read");
      }
      return data ? toTelegramDeliveryRecord(data) : null;
    },

    async insertIfAbsent(record) {
      const { data, error } = await client
        .from("telegram_deliveries")
        .insert(toTelegramDeliveryRow(record))
        .select(telegramDeliveryColumns)
        .maybeSingle();
      if (error?.code === "23505") {
        return null;
      }
      if (error) {
        return throwDataSourceError("insert");
      }
      return data ? toTelegramDeliveryRecord(data) : null;
    },

    updateIfStatus(record, expectedStatus) {
      return update(record, "status", expectedStatus);
    },

    updateIfSyncStatus(record, expectedStatus) {
      return update(record, "workspace_sync_status", expectedStatus);
    },
  };
}

export function createSupabaseCalendarDeliveryDataSource(
  client: SupabaseClient,
  now: () => string = () => new Date().toISOString(),
): CalendarDeliveryDataSource {
  const update = async (
    record: CalendarDeliveryRecord,
    expectedStatus: CalendarDeliveryStatus,
  ): Promise<CalendarDeliveryRecord | null> => {
    const {
      request_id: requestId,
      created_at: _createdAt,
      ...changes
    } = toCalendarDeliveryRow(record);
    const { data, error } = await client
      .from("calendar_deliveries")
      .update({ ...changes, updated_at: now() })
      .eq("request_id", requestId)
      .eq("status", expectedStatus)
      .select(calendarDeliveryColumns)
      .maybeSingle();
    if (error) return throwDataSourceError("update");
    return data ? toCalendarDeliveryRecord(data) : null;
  };

  return {
    async read(requestId) {
      const { data, error } = await client
        .from("calendar_deliveries")
        .select(calendarDeliveryColumns)
        .eq("request_id", requestId)
        .maybeSingle();
      if (error) return throwDataSourceError("read");
      return data ? toCalendarDeliveryRecord(data) : null;
    },

    async insertIfAbsent(record) {
      const { data, error } = await client
        .from("calendar_deliveries")
        .insert(toCalendarDeliveryRow(record))
        .select(calendarDeliveryColumns)
        .maybeSingle();
      if (error?.code === "23505") return null;
      if (error) return throwDataSourceError("insert");
      return data ? toCalendarDeliveryRecord(data) : null;
    },

    updateIfStatus(record, expectedStatus) {
      return update(record, expectedStatus);
    },
  };
}

export function createSupabaseOutboxDataSource(
  client: SupabaseClient,
  now: () => string = () => new Date().toISOString(),
): OutboxDataSource {
  return {
    async claim(workspaceId, limit) {
      const { data, error } = await client.rpc("claim_outbox_jobs", {
        p_workspace_id: workspaceId,
        p_limit: limit,
      });
      if (error) return throwDataSourceError("update");
      return z.array(outboxJobRowSchema).parse(data ?? []).map(toOutboxJob);
    },

    async enqueue(input: EnqueueOutboxJob) {
      const { error } = await client.rpc("enqueue_outbox_job", {
        p_workspace_id: input.workspaceId,
        p_kind: input.kind,
        p_dedupe_key: input.dedupeKey,
        p_payload: input.payload,
      });
      if (error) return throwDataSourceError("insert");
    },

    async complete(input) {
      const { error } = await client
        .from("outbox_jobs")
        .update({
          status: "completed",
          locked_at: null,
          last_error: null,
          updated_at: now(),
        })
        .eq("id", input.id)
        .eq("status", "running")
        .eq("locked_at", input.lockedAt);
      if (error) return throwDataSourceError("update");
    },

    async retry(input) {
      const { error } = await client
        .from("outbox_jobs")
        .update({
          status: input.final ? "failed" : "pending",
          available_at: input.availableAt,
          locked_at: null,
          last_error: input.error,
          updated_at: now(),
        })
        .eq("id", input.id)
        .eq("status", "running")
        .eq("locked_at", input.lockedAt);
      if (error) return throwDataSourceError("update");
    },
  };
}

export function createSupabaseGoogleCalendarConnectionDataSource(
  client: SupabaseClient,
): GoogleCalendarConnectionDataSource {
  return {
    async read(workspaceId) {
      const { data, error } = await client
        .from("google_calendar_connections")
        .select(googleCalendarConnectionColumns)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (error) return throwDataSourceError("read");
      return data ? toGoogleCalendarConnection(data) : null;
    },
    async upsert(record) {
      const { error } = await client.from("google_calendar_connections").upsert({
        workspace_id: record.workspaceId,
        calendar_id: record.calendarId,
        refresh_token_ciphertext: record.refreshTokenCiphertext,
        granted_scope: record.grantedScope,
        status: record.status,
        last_error: record.lastError,
        connected_at: record.connectedAt,
        updated_at: record.updatedAt,
      });
      if (error) return throwDataSourceError("update");
    },
  };
}

export function createSupabaseGoogleCalendarEventDataSource(
  client: SupabaseClient,
): GoogleCalendarEventDataSource {
  return {
    async upsert(record) {
      const { error } = await client.from("google_calendar_events").upsert({
        workspace_id: record.workspaceId,
        conversation_id: record.conversationId,
        event_id: record.eventId,
        booking_revision: record.bookingRevision,
        status: record.status,
        event_etag: record.eventEtag,
        last_synced_at: record.lastSyncedAt,
      });
      if (error) return throwDataSourceError("update");
    },
    async listByWorkspace(workspaceId) {
      const { data, error } = await client
        .from("google_calendar_events")
        .select(googleCalendarEventColumns)
        .eq("workspace_id", workspaceId);
      if (error) return throwDataSourceError("read");
      return (data ?? []).map(toGoogleCalendarEventRecord);
    },
    async deleteMapping(workspaceId, conversationId) {
      const { error } = await client
        .from("google_calendar_events")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("conversation_id", conversationId);
      if (error) return throwDataSourceError("update");
    },
  };
}

export interface DemoSeedDataSource {
  readSource(
    seedKey: string,
  ): Promise<{ schemaVersion: number; sourceState: unknown } | null>;
  readCompiled(seedKey: string): Promise<ServerDomainStatePayload | null>;
  updateCompiled(
    seedKey: string,
    state: ServerDomainStatePayload,
    compiledAt: string,
  ): Promise<void>;
}

export function createSupabaseDemoSeedDataSource(
  client: SupabaseClient,
  now: () => string = () => new Date().toISOString(),
): DemoSeedDataSource {
  return {
    async readSource(seedKey) {
      const { data, error } = await client
        .from("demo_seed_templates")
        .select(demoSeedTemplateColumns)
        .eq("seed_key", seedKey)
        .maybeSingle();
      if (error) return throwDataSourceError("read");
      if (!data) return null;
      const parsed = demoSeedTemplateRowSchema.parse(data);
      return {
        schemaVersion: parsed.schema_version,
        sourceState: parsed.source_state,
      };
    },
    async readCompiled(seedKey) {
      const { data, error } = await client
        .from("demo_seed_templates")
        .select(demoSeedTemplateColumns)
        .eq("seed_key", seedKey)
        .maybeSingle();
      if (error) return throwDataSourceError("read");
      if (!data) return null;
      const parsed = demoSeedTemplateRowSchema.parse(data);
      return parsed.state;
    },
    async updateCompiled(seedKey, state, compiledAt) {
      const { error } = await client
        .from("demo_seed_templates")
        .update({
          state,
          compiled_at: compiledAt,
          updated_at: now(),
        })
        .eq("seed_key", seedKey);
      if (error) return throwDataSourceError("update");
    },
  };
}

function throwDemoWorkspaceResetError(): never {
  throw new SupabaseDataSourceError(
    "update",
    "Supabase demo workspace reset failed",
  );
}

export function createSupabaseDemoWorkspaceResetDataSource(
  client: SupabaseClient,
): DemoWorkspaceResetDataSource {
  const workspaceDataSource = createSupabaseWorkspaceDataSource(client);

  return {
    async reset(workspaceId, seedKey, expectedRevision) {
      const { data, error } = await client.rpc("reset_demo_workspace", {
        p_workspace_id: workspaceId,
        p_seed_key: seedKey,
        p_expected_revision: expectedRevision,
      });

      if (error) {
        if (isRevisionConflictError(error)) {
          const current = await workspaceDataSource.read(workspaceId);
          if (!current) {
            return throwDemoWorkspaceResetError();
          }
          return saveWorkspaceResultSchema.parse({
            ok: false,
            code: "revision_conflict",
            workspace: toWorkspaceEnvelope(current),
          }) as Extract<SaveWorkspaceResult, { ok: false }>;
        }
        return throwDemoWorkspaceResetError();
      }

      const parsed = resetDemoWorkspaceRpcResultSchema.parse(data);
      const updated = await workspaceDataSource.read(workspaceId);
      if (!updated) {
        return throwDemoWorkspaceResetError();
      }

      return {
        ok: true,
        workspace: toWorkspaceEnvelope(updated),
        summary: toResetSummary(parsed),
      };
    },
  };
}
