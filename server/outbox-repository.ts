import { z } from "zod";

import { workspaceIdSchema } from "../src/contracts/api";

export const OUTBOX_JOB_KINDS = [
  "telegram_auto_reply",
  "google_calendar_sync",
] as const;

const timestampSchema = z.iso.datetime({ offset: true });
const outboxJobKindSchema = z.enum(OUTBOX_JOB_KINDS);
const outboxJobStatusSchema = z.enum(["pending", "running", "completed", "failed"]);

export const outboxJobSchema = z
  .object({
    id: z.number().int().positive(),
    workspaceId: workspaceIdSchema,
    kind: outboxJobKindSchema,
    dedupeKey: z.string().trim().min(1).max(256),
    payload: z.record(z.string(), z.unknown()),
    status: outboxJobStatusSchema,
    attempts: z.number().int().nonnegative().max(20),
    availableAt: timestampSchema,
    lockedAt: timestampSchema.nullable(),
    lastError: z.string().trim().min(1).max(2_000).nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

const enqueueOutboxJobSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    kind: outboxJobKindSchema,
    dedupeKey: z.string().trim().min(1).max(256),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export type OutboxJob = z.infer<typeof outboxJobSchema>;
export type OutboxJobKind = z.infer<typeof outboxJobKindSchema>;
export type EnqueueOutboxJob = z.infer<typeof enqueueOutboxJobSchema>;

export interface OutboxDataSource {
  claim(workspaceId: string, limit: number): Promise<OutboxJob[]>;
  complete(input: { id: number; lockedAt: string }): Promise<void>;
  enqueue(input: EnqueueOutboxJob): Promise<void>;
  retry(input: {
    id: number;
    lockedAt: string;
    availableAt: string;
    error: string;
    final: boolean;
  }): Promise<void>;
}

export interface OutboxRepository {
  claim(workspaceId: string, limit?: number): Promise<OutboxJob[]>;
  complete(job: OutboxJob): Promise<void>;
  enqueue(input: EnqueueOutboxJob): Promise<void>;
  retry(job: OutboxJob, error: unknown): Promise<"retrying" | "failed">;
}

export class OutboxRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboxRepositoryError";
  }
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : "Outbox job failed";
  return message.trim().slice(0, 2_000) || "Outbox job failed";
}

function isNonRetryable(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "retryable" in error
    && (error as { retryable?: unknown }).retryable === false;
}

function retryDelayMs(attempts: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1));
}

function claimedLock(job: OutboxJob): string {
  if (job.lockedAt === null) {
    throw new OutboxRepositoryError("Outbox job must be claimed before it can be finalized");
  }
  return job.lockedAt;
}

export function createOutboxRepository(
  dataSource: OutboxDataSource,
  now: () => Date = () => new Date(),
  maxAttempts = 5,
): OutboxRepository {
  const attempts = z.number().int().min(1).max(20).parse(maxAttempts);
  return {
    async claim(workspaceId, limit = 10) {
      const validWorkspaceId = workspaceIdSchema.parse(workspaceId);
      const validLimit = z.number().int().min(1).max(20).parse(limit);
      const jobs = await dataSource.claim(validWorkspaceId, validLimit);
      return z.array(outboxJobSchema).parse(jobs);
    },

    async complete(job) {
      const current = outboxJobSchema.parse(job);
      await dataSource.complete({
        id: current.id,
        lockedAt: claimedLock(current),
      });
    },

    async enqueue(input) {
      await dataSource.enqueue(enqueueOutboxJobSchema.parse(input));
    },

    async retry(job, error) {
      const current = outboxJobSchema.parse(job);
      const final = current.attempts >= attempts || isNonRetryable(error);
      await dataSource.retry({
        id: current.id,
        lockedAt: claimedLock(current),
        availableAt: new Date(now().getTime() + retryDelayMs(current.attempts)).toISOString(),
        error: errorText(error),
        final,
      });
      return final ? "failed" : "retrying";
    },
  };
}
