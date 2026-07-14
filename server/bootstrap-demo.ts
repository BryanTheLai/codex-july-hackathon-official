import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ServerDomainStatePayload } from "../src/contracts/app-state";
import {
  createCanonicalServerState,
} from "../src/domain";
import {
  createSupabaseServerClient,
  createSupabaseWorkspaceDataSource,
  readSupabaseConfig,
} from "./supabase";
import {
  createWorkspaceRepository,
  type WorkspaceRepository,
} from "./workspace-repository";

export async function bootstrapDemo(
  repository: WorkspaceRepository,
  workspaceId: string,
  createState: () => Promise<ServerDomainStatePayload> =
    createCanonicalServerState,
) {
  return repository.bootstrap(workspaceId, await createState());
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
  const config = readSupabaseConfig();
  const client = createSupabaseServerClient(config);
  const repository = createWorkspaceRepository(
    createSupabaseWorkspaceDataSource(client),
  );
  const workspace = await bootstrapDemo(
    repository,
    config.workspaceId,
  );
  console.log(
    `Demo workspace ready: ${workspace.workspaceId} revision ${workspace.revision}`,
  );
}

const directRun =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (directRun) {
  await run();
}
