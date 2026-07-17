import { loadCompiledServerSeed } from "../src/domain/server-seed";
import type { ResetDemoWorkspaceResult } from "./supabase";
import type { DemoWorkspaceResetDataSource } from "./supabase";
import { SupabaseDataSourceError } from "./supabase";
import type { GoogleCalendarService } from "./google-calendar-service";
import { GoogleCalendarError } from "./google-calendar-service";
import type { VoiceArtifactStore } from "./voice-artifact-store";
import { VoiceArtifactStoreError } from "./voice-artifact-store";
import type { CompiledSeedLoader } from "../src/domain/server-seed";
import type { WorkspaceRepository } from "./workspace-repository";
import { WorkspaceRepositoryError } from "./workspace-repository";
import {
  beginWorkspaceReset,
  endWorkspaceReset,
  isWorkspaceResetInProgress,
} from "./workspace-reset-lock";

export { isWorkspaceResetInProgress };

export function assertWorkspaceMutationAllowed(workspaceId: string): void {
  if (isWorkspaceResetInProgress(workspaceId)) {
    throw new WorkspaceRepositoryError(
      "reset_in_progress",
      "Workspace cannot be modified while factory reset is running.",
    );
  }
}

export class FactoryResetServiceError extends Error {
  readonly code:
    | "invalid_request"
    | "not_found"
    | "revision_conflict"
    | "provider_failed"
    | "reset_in_progress";
  readonly retryable: boolean;

  constructor(
    code: FactoryResetServiceError["code"],
    message: string,
    retryable: boolean,
  ) {
    super(message);
    this.name = "FactoryResetServiceError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type FactoryResetService = {
  reset(
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<ResetDemoWorkspaceResult>;
};

type FactoryResetServiceOptions = {
  workspaceId: string;
  seedKey: string;
  workspaceRepository: WorkspaceRepository;
  loadCompiledSeed: CompiledSeedLoader;
  resetDataSource: DemoWorkspaceResetDataSource;
  voiceArtifactStore: VoiceArtifactStore;
  googleCalendar?: GoogleCalendarService | null;
};

export function createFactoryResetService({
  workspaceId,
  seedKey,
  workspaceRepository,
  loadCompiledSeed,
  resetDataSource,
  voiceArtifactStore,
  googleCalendar = null,
}: FactoryResetServiceOptions): FactoryResetService {
  return {
    async reset(expectedRevision, signal) {
      try {
        await loadCompiledServerSeed(loadCompiledSeed, seedKey);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Compiled demo seed is unavailable.";
        throw new FactoryResetServiceError("invalid_request", message, false);
      }

      if (isWorkspaceResetInProgress(workspaceId)) {
        throw new FactoryResetServiceError(
          "reset_in_progress",
          "A factory reset is already running for this workspace.",
          true,
        );
      }
      beginWorkspaceReset(workspaceId);
      try {
        const current = await workspaceRepository.load(workspaceId);
        if (!current) {
          throw new FactoryResetServiceError(
            "not_found",
            "Workspace not found.",
            false,
          );
        }
        if (current.revision !== expectedRevision) {
          return {
            ok: false,
            code: "revision_conflict",
            workspace: current,
          };
        }

        if (googleCalendar) {
          try {
            await googleCalendar.deleteTrackedEvents(workspaceId, signal);
          } catch (error) {
            if (error instanceof GoogleCalendarError) {
              throw new FactoryResetServiceError(
                "provider_failed",
                error.message,
                error.retryable,
              );
            }
            throw error;
          }
        }

        let result: ResetDemoWorkspaceResult;
        try {
          result = await resetDataSource.reset(
            workspaceId,
            seedKey,
            expectedRevision,
          );
        } catch (error) {
          if (error instanceof SupabaseDataSourceError) {
            throw new FactoryResetServiceError(
              "provider_failed",
              error.message,
              true,
            );
          }
          throw error;
        }

        if (!result.ok) {
          return result;
        }

        try {
          await voiceArtifactStore.clearWorkspace(workspaceId);
        } catch (error) {
          const message =
            error instanceof VoiceArtifactStoreError
              ? "Workspace reset completed but voice artifact cleanup failed."
              : error instanceof Error
                ? error.message
                : "Workspace reset completed but voice artifact cleanup failed.";
          throw new FactoryResetServiceError(
            "provider_failed",
            message,
            true,
          );
        }

        return result;
      } finally {
        endWorkspaceReset(workspaceId);
      }
    },
  };
}
