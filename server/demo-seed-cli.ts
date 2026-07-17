import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compileDemoSeedSource } from "./demo-seed-builder";
import {
  createSupabaseDemoSeedDataSource,
  createSupabaseServerClient,
  readSupabaseConfig,
} from "./supabase";

const DEFAULT_SEED_KEY = "msme-aircon-v1";

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

  const args = parseArgs(process.argv);
  const seedKey = args.seed ?? DEFAULT_SEED_KEY;
  const config = readSupabaseConfig();
  const client = createSupabaseServerClient(config);
  const dataSource = createSupabaseDemoSeedDataSource(client);
  const template = await dataSource.readSource(seedKey).catch(() => {
    throw new Error(
      "Seed template is unavailable. Verify Supabase credentials, apply migration 20260718010000_demo_seed_templates.sql, and load supabase/seed.sql.",
    );
  });
  if (!template) {
    console.error(`Seed template not found: ${seedKey}`);
    process.exit(1);
  }

  const compiled = await compileDemoSeedSource(template.sourceState);
  const compiledAt = new Date().toISOString();
  await dataSource.updateCompiled(seedKey, compiled, compiledAt);
  console.log(`seed=${seedKey}`);
  console.log(`schema_version=${template.schemaVersion}`);
  console.log(`compiled_at=${compiledAt}`);
  console.log("status=ready");
}

const directRun =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (directRun) {
  await run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Demo seed compile failed");
    process.exit(1);
  });
}
