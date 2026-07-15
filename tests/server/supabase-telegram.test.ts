import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  createSupabaseTelegramDeliveryDataSource,
  createSupabaseTelegramEventDataSource,
} from "../../server/supabase";
import type {
  TelegramDeliveryRecord,
  TelegramEventRecord,
} from "../../server/telegram-repository";

type QueryResponse = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

class FakeSupabaseQuery {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];

  constructor(private readonly response: QueryResponse) {}

  select(...args: unknown[]): this {
    this.calls.push({ method: "select", args });
    return this;
  }

  eq(...args: unknown[]): this {
    this.calls.push({ method: "eq", args });
    return this;
  }

  insert(...args: unknown[]): this {
    this.calls.push({ method: "insert", args });
    return this;
  }

  update(...args: unknown[]): this {
    this.calls.push({ method: "update", args });
    return this;
  }

  async maybeSingle(): Promise<QueryResponse> {
    this.calls.push({ method: "maybeSingle", args: [] });
    return this.response;
  }
}

function fakeClient(query: FakeSupabaseQuery): SupabaseClient {
  return {
    from: (table: string) => {
      query.calls.push({ method: "from", args: [table] });
      return query;
    },
  } as unknown as SupabaseClient;
}

const event: TelegramEventRecord = {
  updateId: 1001,
  workspaceId: "demo",
  payloadHash: "a".repeat(64),
  status: "received",
  normalizedMessageId: "telegram-message:-10042:88",
  error: null,
  createdAt: "2026-07-13T12:00:00.000Z",
  updatedAt: "2026-07-13T12:00:00.000Z",
};

const delivery: TelegramDeliveryRecord = {
  requestId: "send-42",
  part: "text",
  workspaceId: "demo",
  conversationId: "telegram-conversation:-10042",
  targetLanguage: "Malay",
  approvedText: "Klinik akan menghubungi anda.",
  approvedTextHash: "b".repeat(64),
  status: "sending",
  workspaceSyncStatus: "pending",
  providerMessageId: null,
  providerAcceptedAt: null,
  error: null,
  createdAt: "2026-07-13T12:00:00.000Z",
  updatedAt: "2026-07-13T12:00:00.000Z",
};

describe("Supabase Telegram data sources", () => {
  it("maps an inbound event row without exposing database field names", async () => {
    const query = new FakeSupabaseQuery({
      data: {
        update_id: event.updateId,
        workspace_id: event.workspaceId,
        payload_hash: event.payloadHash,
        status: event.status,
        normalized_message_id: event.normalizedMessageId,
        error: event.error,
        created_at: event.createdAt,
        updated_at: event.updatedAt,
      },
      error: null,
    });
    const source = createSupabaseTelegramEventDataSource(fakeClient(query));

    await expect(source.read(event.updateId)).resolves.toEqual(event);
    expect(query.calls).toEqual([
      { method: "from", args: ["telegram_events"] },
      {
        method: "select",
        args: [
          "update_id,workspace_id,payload_hash,status,normalized_message_id,error,created_at,updated_at",
        ],
      },
      { method: "eq", args: ["update_id", event.updateId] },
      { method: "maybeSingle", args: [] },
    ]);
  });

  it("claims one delivery using its compound identity and prior status", async () => {
    const claimed = { ...delivery, status: "sending" as const };
    const query = new FakeSupabaseQuery({
      data: {
        request_id: claimed.requestId,
        part: claimed.part,
        workspace_id: claimed.workspaceId,
        conversation_id: claimed.conversationId,
        target_language: claimed.targetLanguage,
        approved_text: claimed.approvedText,
        approved_text_hash: claimed.approvedTextHash,
        status: claimed.status,
        workspace_sync_status: claimed.workspaceSyncStatus,
        provider_message_id: claimed.providerMessageId,
        provider_accepted_at: claimed.providerAcceptedAt,
        error: claimed.error,
        created_at: claimed.createdAt,
        updated_at: claimed.updatedAt,
      },
      error: null,
    });
    const source = createSupabaseTelegramDeliveryDataSource(
      fakeClient(query),
      () => "2026-07-13T12:00:00.000Z",
    );

    await expect(
      source.updateIfStatus(claimed, "pending"),
    ).resolves.toEqual(claimed);
    expect(query.calls).toContainEqual({
      method: "eq",
      args: ["request_id", delivery.requestId],
    });
    expect(query.calls).toContainEqual({
      method: "eq",
      args: ["part", "text"],
    });
    expect(query.calls).toContainEqual({
      method: "eq",
      args: ["status", "pending"],
    });
    expect(query.calls).toContainEqual({
      method: "update",
      args: [
        {
          workspace_id: delivery.workspaceId,
          conversation_id: delivery.conversationId,
          target_language: delivery.targetLanguage,
          approved_text: delivery.approvedText,
          approved_text_hash: delivery.approvedTextHash,
          status: "sending",
          workspace_sync_status: "pending",
          provider_message_id: null,
          provider_accepted_at: null,
          error: null,
          updated_at: "2026-07-13T12:00:00.000Z",
        },
      ],
    });
  });
});
