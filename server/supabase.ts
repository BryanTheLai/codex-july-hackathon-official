import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { z } from "zod";

import {
  revisionSchema,
  serverDomainStateSchema,
} from "../src/contracts/app-state";
import { workspaceIdSchema } from "../src/contracts/api";
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
    status: z.string(),
    workspace_sync_status: z.string(),
    provider_message_id: z.string().nullable(),
    provider_accepted_at: z.string().nullable(),
    error: z.unknown().nullable(),
    created_at: z.string(),
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
    status: record.status,
    workspace_sync_status: record.workspaceSyncStatus,
    provider_message_id: record.providerMessageId,
    provider_accepted_at: record.providerAcceptedAt,
    error: record.error,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
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
  "update_id,workspace_id,payload_hash,status,normalized_message_id,error,created_at,updated_at";
const telegramDeliveryColumns =
  "request_id,part,workspace_id,conversation_id,target_language,approved_text,approved_text_hash,status,workspace_sync_status,provider_message_id,provider_accepted_at,error,created_at,updated_at";

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
