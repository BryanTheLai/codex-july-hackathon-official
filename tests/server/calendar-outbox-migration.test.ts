import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260717110000_calendar_sync_outbox.sql"),
  "utf8",
);
const validationSql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260717110100_validate_calendar_outbox.sql"),
  "utf8",
);

describe("calendar outbox migration", () => {
  it("creates a service-role-only durable outbox and Google sync ledger", () => {
    for (const table of [
      "outbox_jobs",
      "google_calendar_connections",
      "google_calendar_events",
    ]) {
      expect(sql).toMatch(new RegExp(`create table public\\.${table}`, "i"));
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, "i"));
      expect(sql).toMatch(new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, "i"));
    }
    expect(sql).toMatch(/telegram_events_enqueue_auto_reply/i);
    expect(sql).toMatch(/demo_state_enqueue_google_calendar_sync/i);
    expect(sql).toMatch(/claim_outbox_jobs/i);
    expect(sql).toMatch(/enqueue_outbox_job/i);
    expect(sql).toMatch(/grant usage on sequence public\.outbox_jobs_id_seq to service_role/i);
    expect(sql).toMatch(/where public\.outbox_jobs\.status = 'failed'/i);
    expect(sql).toMatch(/conversation->>'source' = 'telegram'/i);
    expect(sql).toMatch(/telegram_events_normalized_event_check[\s\S]*not valid/i);
    expect(validationSql).toMatch(/validate constraint telegram_events_normalized_event_check/i);
    expect(sql).toMatch(/revoke all on function public\.enqueue_telegram_auto_reply_job\(\) from public, anon, authenticated/i);
    expect(sql).toMatch(/revoke all on function public\.enqueue_google_calendar_sync_jobs\(\) from public, anon, authenticated/i);
  });
});
