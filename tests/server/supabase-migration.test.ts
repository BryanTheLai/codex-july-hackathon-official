import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { DataType, newDb } from "pg-mem";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/001_demo_platform.sql",
);

function readMigration(): string {
  return readFileSync(migrationPath, "utf8");
}

function executableCore(sql: string): string {
  return sql.replace(
    /-- SUPABASE ACCESS START[\s\S]*-- SUPABASE ACCESS END/,
    "",
  );
}

function migratedDatabase() {
  const database = newDb();
  database.public.registerFunction({
    name: "btrim",
    args: [DataType.text],
    returns: DataType.text,
    implementation: (value: string) => value.trim(),
  });
  database.public.registerFunction({
    name: "length",
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (value: string) => value.length,
  });
  database.public.registerFunction({
    name: "jsonb_typeof",
    args: [DataType.jsonb],
    returns: DataType.text,
    implementation: (value: unknown) => {
      if (Array.isArray(value)) return "array";
      if (value === null) return "null";
      return typeof value === "object" ? "object" : typeof value;
    },
  });
  database.public.none(executableCore(readMigration()));
  return database;
}

function expectSqlFailure(run: () => void): void {
  expect(run).toThrow();
}

describe("Supabase platform migration", () => {
  it("creates only the three POC tables and locks them to the service role", () => {
    const sql = readMigration();

    expect(sql.match(/create table public\./gi)).toHaveLength(3);
    for (const table of ["demo_state", "telegram_events", "telegram_deliveries"]) {
      expect(sql).toMatch(
        new RegExp(`alter table public\\.${table} enable row level security`, "i"),
      );
      expect(sql).toMatch(
        new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, "i"),
      );
      expect(sql).toMatch(
        new RegExp(
          `grant select, insert, update, delete on table public\\.${table} to service_role`,
          "i",
        ),
      );
    }
  });

  it("enforces positive revisions and object-shaped aggregate state", () => {
    const database = migratedDatabase();

    database.public.none(`
      insert into public.demo_state (
        workspace_id,
        schema_version,
        revision,
        state
      ) values (
        'demo',
        4,
        1,
        '{"conversations":[]}'::jsonb
      )
    `);

    expectSqlFailure(() =>
      database.public.none(`
        insert into public.demo_state (
          workspace_id,
          schema_version,
          revision,
          state
        ) values (
          'zero-revision',
          4,
          0,
          '{}'::jsonb
        )
      `),
    );
    expectSqlFailure(() =>
      database.public.none(`
        insert into public.demo_state (
          workspace_id,
          schema_version,
          revision,
          state
        ) values (
          'array-state',
          4,
          1,
          '[]'::jsonb
        )
      `),
    );
  });

  it("deduplicates Telegram updates and validates inbound status", () => {
    const database = migratedDatabase();
    database.public.none(`
      insert into public.demo_state (
        workspace_id,
        schema_version,
        revision,
        state
      ) values ('demo', 4, 1, '{}'::jsonb)
    `);
    database.public.none(`
      insert into public.telegram_events (
        update_id,
        workspace_id,
        payload_hash,
        status,
        normalized_message_id
      ) values (101, 'demo', 'sha256:first', 'received', 'telegram:101')
    `);

    expectSqlFailure(() =>
      database.public.none(`
        insert into public.telegram_events (
          update_id,
          workspace_id,
          payload_hash,
          status,
          normalized_message_id
        ) values (101, 'demo', 'sha256:first', 'processed', 'telegram:101')
      `),
    );
    expectSqlFailure(() =>
      database.public.none(`
        insert into public.telegram_events (
          update_id,
          workspace_id,
          payload_hash,
          status,
          normalized_message_id
        ) values (102, 'demo', 'sha256:second', 'queued', 'telegram:102')
      `),
    );
  });

  it("deduplicates each outbound part and validates delivery state", () => {
    const database = migratedDatabase();
    database.public.none(`
      insert into public.demo_state (
        workspace_id,
        schema_version,
        revision,
        state
      ) values ('demo', 4, 1, '{}'::jsonb)
    `);
    database.public.none(`
      insert into public.telegram_deliveries (
        request_id,
        part,
        workspace_id,
        conversation_id,
        target_language,
        approved_text,
        approved_text_hash,
        status,
        workspace_sync_status
      ) values (
        'request-1',
        'text',
        'demo',
        'conversation-1',
        'Malay',
        'Approved patient text',
        'sha256:text',
        'pending',
        'pending'
      )
    `);
    database.public.none(`
      insert into public.telegram_deliveries (
        request_id,
        part,
        workspace_id,
        conversation_id,
        target_language,
        approved_text,
        approved_text_hash,
        status,
        workspace_sync_status
      ) values (
        'request-1',
        'voice',
        'demo',
        'conversation-1',
        'Malay',
        'Approved patient text',
        'sha256:text',
        'pending',
        'pending'
      )
    `);

    expectSqlFailure(() =>
      database.public.none(`
        insert into public.telegram_deliveries (
          request_id,
          part,
          workspace_id,
          conversation_id,
          target_language,
          approved_text,
          approved_text_hash,
          status,
          workspace_sync_status
        ) values (
          'request-1',
          'text',
          'demo',
          'conversation-1',
          'Malay',
          'Approved patient text',
          'sha256:text',
          'pending',
          'pending'
        )
      `),
    );
    expectSqlFailure(() =>
      database.public.none(`
        insert into public.telegram_deliveries (
          request_id,
          part,
          workspace_id,
          conversation_id,
          target_language,
          approved_text,
          approved_text_hash,
          status,
          workspace_sync_status
        ) values (
          'request-2',
          'image',
          'demo',
          'conversation-1',
          'Malay',
          'Approved patient text',
          'sha256:text',
          'sent',
          'lost'
        )
      `),
    );
    expectSqlFailure(() =>
      database.public.none(`
        insert into public.telegram_deliveries (
          request_id,
          part,
          workspace_id,
          conversation_id,
          target_language,
          approved_text,
          approved_text_hash,
          status,
          workspace_sync_status,
          provider_message_id
        ) values (
          'request-3',
          'text',
          'demo',
          'conversation-1',
          'Malay',
          'Approved patient text',
          'sha256:text',
          'sent',
          'pending',
          '9001'
        )
      `),
    );
    database.public.none(`
      insert into public.telegram_deliveries (
        request_id,
        part,
        workspace_id,
        conversation_id,
        target_language,
        approved_text,
        approved_text_hash,
        status,
        workspace_sync_status,
        provider_message_id,
        provider_accepted_at
      ) values (
        'request-4',
        'text',
        'demo',
        'conversation-1',
        'Malay',
        'Approved patient text',
        'sha256:text',
        'sent',
        'pending',
        '9001',
        '2026-07-13T12:01:00.000Z'
      )
    `);
  });
});
