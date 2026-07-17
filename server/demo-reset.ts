import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_DEMO_SEED_KEY } from "./bootstrap-demo";
import { createFactoryResetService } from "./factory-reset-service";
import { readGoogleCalendarConfig } from "./google-calendar-config";
import {
  createGoogleCalendarConnectionRepository,
  createGoogleCalendarEventRepository,
} from "./google-calendar-repository";
import { createGoogleCalendarService } from "./google-calendar-service";
import { createOutboxRepository } from "./outbox-repository";
import {
  createSupabaseDemoSeedDataSource,
  createSupabaseDemoWorkspaceResetDataSource,
  createSupabaseGoogleCalendarConnectionDataSource,
  createSupabaseGoogleCalendarEventDataSource,
  createSupabaseOutboxDataSource,
  createSupabaseServerClient,
  createSupabaseWorkspaceDataSource,
  readSupabaseConfig,
} from "./supabase";
import { createSupabaseVoiceArtifactStore } from "./voice-artifact-store";
import { createWorkspaceRepository } from "./workspace-repository";

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

function configuredGoogleCalendar(
  client: ReturnType<typeof createSupabaseServerClient>,
  workspaceId: string,
) {
  const calendarConfig = readGoogleCalendarConfig();
  if (!calendarConfig.enabled) {
    return null;
  }
  const outboxRepository = createOutboxRepository(
    createSupabaseOutboxDataSource(client),
  );
  const workspaceRepository = createWorkspaceRepository(
    createSupabaseWorkspaceDataSource(client),
  );
  return createGoogleCalendarService({
    config: calendarConfig,
    connectionRepository: createGoogleCalendarConnectionRepository(
      createSupabaseGoogleCalendarConnectionDataSource(client),
    ),
    eventRepository: createGoogleCalendarEventRepository(
      createSupabaseGoogleCalendarEventDataSource(client),
    ),
    outboxRepository,
    workspaceId,
    workspaceRepository,
  });
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
  const seedKey = args.seed ?? DEFAULT_DEMO_SEED_KEY;
  const confirmation = args.confirm;
  if (confirmation !== RESET_CONFIRMATION) {
    throw new Error(`Confirmation must be exactly ${RESET_CONFIRMATION}`);
  }

  const config = readSupabaseConfig();
  const client = createSupabaseServerClient(config);
  const workspaceRepository = createWorkspaceRepository(
    createSupabaseWorkspaceDataSource(client),
  );
  const workspace = await workspaceRepository.load(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  const factoryReset = createFactoryResetService({
    workspaceId,
    seedKey,
    workspaceRepository,
    loadCompiledSeed: (key) =>
      createSupabaseDemoSeedDataSource(client).readCompiled(key),
    resetDataSource: createSupabaseDemoWorkspaceResetDataSource(client),
    googleCalendar: configuredGoogleCalendar(client, workspaceId),
    voiceArtifactStore: createSupabaseVoiceArtifactStore(client),
  });

  const result = await factoryReset.reset(workspace.revision);
  if (!result.ok) {
    throw new Error(`Reset rejected: ${result.code}`);
  }

  const summary = result.summary;
  console.log(`workspace=${workspaceId}`);
  console.log(`seed=${summary.seedKey}`);
  console.log(`previous_revision=${String(summary.previousRevision)}`);
  console.log(`new_revision=${String(summary.newRevision)}`);
  console.log(`google_events_removed=${String(summary.googleEventsRemoved)}`);
  console.log(`outbox_rows_removed=${String(summary.outboxRowsRemoved)}`);
  console.log(`oauth_preserved=${String(summary.oauthPreserved)}`);
  console.log(`status=ready`);
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
