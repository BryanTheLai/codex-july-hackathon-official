import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createOutboxRepository } from "./outbox-repository";
import { readGoogleCalendarConfig } from "./google-calendar-config";
import {
  createGoogleCalendarConnectionRepository,
  createGoogleCalendarEventRepository,
} from "./google-calendar-repository";
import { createGoogleCalendarService } from "./google-calendar-service";
import {
  createSupabaseGoogleCalendarConnectionDataSource,
  createSupabaseGoogleCalendarEventDataSource,
  createSupabaseOutboxDataSource,
  createSupabaseServerClient,
  createSupabaseWorkspaceDataSource,
  readSupabaseConfig,
} from "./supabase";
import { createWorkspaceRepository } from "./workspace-repository";

const DEFAULT_SEED_KEY = "msme-aircon-v1";
const DEFAULT_WORKSPACE_ID = "demo";
const RESET_CONFIRMATION = "RESET_DEMO";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith("--")) continue;
    const body = argument.slice(2);
    const equalsIndex = body.indexOf("=");
    if (equalsIndex >= 0) {
      args[body.slice(0, equalsIndex)] = body.slice(equalsIndex + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[body] = next;
      index += 1;
    } else {
      args[body] = "true";
    }
  }
  return args;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function assertSafetyGates(): void {
  if (process.env.KAUNTER_ALLOW_DEMO_RESET !== "1") {
    throw new Error(
      "Demo reset blocked. Set KAUNTER_ALLOW_DEMO_RESET=1 after stopping the app.",
    );
  }
  if (process.env.LIVE_TELEGRAM_ENABLED === "true") {
    throw new Error(
      "Demo reset blocked while LIVE_TELEGRAM_ENABLED=true. Stop live Telegram first.",
    );
  }
}

async function cleanupGoogleEvents(workspaceId: string): Promise<number> {
  const calendarConfig = readGoogleCalendarConfig();
  if (!calendarConfig.enabled) {
    return 0;
  }

  const config = readSupabaseConfig();
  const client = createSupabaseServerClient(config);
  const eventRepository = createGoogleCalendarEventRepository(
    createSupabaseGoogleCalendarEventDataSource(client),
  );
  const outboxRepository = createOutboxRepository(
    createSupabaseOutboxDataSource(client),
  );
  const workspaceRepository = createWorkspaceRepository(
    createSupabaseWorkspaceDataSource(client),
  );
  const calendar = createGoogleCalendarService({
    config: calendarConfig,
    connectionRepository: createGoogleCalendarConnectionRepository(
      createSupabaseGoogleCalendarConnectionDataSource(client),
    ),
    eventRepository,
    outboxRepository,
    workspaceId,
    workspaceRepository,
  });

  const mappings = await eventRepository.listByWorkspace(workspaceId);
  let removed = 0;
  for (const mapping of mappings) {
    if (mapping.status !== "active") {
      await eventRepository.deleteMapping(workspaceId, mapping.conversationId);
      continue;
    }
    await calendar.deleteMappedEvent(mapping.eventId);
    await eventRepository.deleteMapping(workspaceId, mapping.conversationId);
    removed += 1;
  }
  return removed;
}

async function run(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }

  assertSafetyGates();
  requireEnv("SUPABASE_URL");
  requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const args = parseArgs(process.argv);
  const workspaceId = args.workspace ?? DEFAULT_WORKSPACE_ID;
  const seedKey = args.seed ?? DEFAULT_SEED_KEY;
  const confirmation = args.confirm;
  if (confirmation !== RESET_CONFIRMATION) {
    throw new Error(`Confirmation must be exactly ${RESET_CONFIRMATION}`);
  }

  const googleEventsRemoved = await cleanupGoogleEvents(workspaceId);
  const config = readSupabaseConfig();
  const client = createSupabaseServerClient(config);
  const { data, error } = await client.rpc("reset_demo_workspace", {
    p_workspace_id: workspaceId,
    p_seed_key: seedKey,
    p_confirmation: confirmation,
  });
  if (error) {
    throw new Error(error.message);
  }

  const summary = data as Record<string, unknown>;
  console.log(`workspace=${String(summary.workspace_id ?? workspaceId)}`);
  console.log(`seed=${String(summary.seed_key ?? seedKey)}`);
  console.log(`previous_revision=${String(summary.previous_revision ?? "")}`);
  console.log(`new_revision=${String(summary.new_revision ?? "")}`);
  console.log(
    `google_events_removed=${String(summary.google_events_removed ?? googleEventsRemoved)}`,
  );
  console.log(`outbox_rows_removed=${String(summary.outbox_rows_removed ?? 0)}`);
  console.log(`oauth_preserved=${String(summary.oauth_preserved ?? true)}`);
  console.log(
    `telegram_sent_audit_preserved=${String(summary.telegram_sent_audit_preserved ?? true)}`,
  );
  console.log(`status=${String(summary.status ?? "ready")}`);
}

const directRun =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (directRun) {
  await run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Demo reset failed");
    process.exit(1);
  });
}
