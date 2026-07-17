import { describe, expect, it } from "vitest";

import {
  createOutboxRepository,
  type OutboxDataSource,
  type OutboxJob,
} from "../../server/outbox-repository";
import { createOutboxWorker } from "../../server/outbox-worker";

function job(): OutboxJob {
  return {
    id: 1,
    workspaceId: "demo",
    kind: "telegram_auto_reply",
    dedupeKey: "telegram:1",
    payload: { event: {} },
    status: "running",
    attempts: 1,
    availableAt: "2026-07-17T01:00:00.000Z",
    lockedAt: "2026-07-17T01:00:00.000Z",
    lastError: null,
    createdAt: "2026-07-17T01:00:00.000Z",
    updatedAt: "2026-07-17T01:00:00.000Z",
  };
}

describe("outbox worker", () => {
  it("completes a claimed job and requeues a failed job with bounded retry state", async () => {
    const calls: string[] = [];
    const source: OutboxDataSource = {
      async claim() {
        return [job()];
      },
      async complete(input) {
        calls.push(`complete:${input.id}`);
      },
      async enqueue() {},
      async retry(input) {
        calls.push(`${input.final ? "failed" : "retry"}:${input.id}`);
      },
    };
    const repository = createOutboxRepository(source, () => new Date("2026-07-17T01:00:00.000Z"));
    const worker = createOutboxWorker({
      execute: async () => {
        calls.push("execute");
      },
      repository,
      workspaceId: "demo",
    });
    await worker.drain();
    expect(calls).toEqual(["execute", "complete:1"]);

    const failedWorker = createOutboxWorker({
      execute: async () => {
        throw new Error("provider unavailable");
      },
      repository,
      workspaceId: "demo",
    });
    await failedWorker.drain();
    expect(calls).toContain("retry:1");
  });

  it("marks an explicitly non-retryable provider failure as failed immediately", async () => {
    const calls: string[] = [];
    const source: OutboxDataSource = {
      async claim() {
        return [job()];
      },
      async complete() {},
      async enqueue() {},
      async retry(input) {
        calls.push(input.final ? "failed" : "retry");
      },
    };
    const worker = createOutboxWorker({
      execute: async () => {
        const error = new Error("reconnect required") as Error & { retryable: boolean };
        error.retryable = false;
        throw error;
      },
      repository: createOutboxRepository(source),
      workspaceId: "demo",
    });

    await worker.drain();

    expect(calls).toEqual(["failed"]);
  });

  it("does not finalize a newer lease after this worker's claimed lease expires", async () => {
    let activeLock = job().lockedAt!;
    const finalized: string[] = [];
    const source: OutboxDataSource = {
      async claim() {
        return [job()];
      },
      async complete(input) {
        if (input.lockedAt === activeLock) finalized.push("complete");
      },
      async enqueue() {},
      async retry(input) {
        if (input.lockedAt === activeLock) finalized.push("retry");
      },
    };
    const worker = createOutboxWorker({
      execute: async () => {
        activeLock = "2026-07-17T01:05:00.000Z";
      },
      repository: createOutboxRepository(source),
      workspaceId: "demo",
    });

    await worker.drain();

    expect(finalized).toEqual([]);
  });

  it("reports a failed background drain instead of creating an unhandled rejection", async () => {
    const failure = new Error("database temporarily unavailable");
    let report: ((error: unknown) => void) | undefined;
    const reported = new Promise<unknown>((resolve) => {
      report = resolve;
    });
    const source: OutboxDataSource = {
      async claim() {
        throw failure;
      },
      async complete() {},
      async enqueue() {},
      async retry() {},
    };
    const worker = createOutboxWorker({
      onDrainError: (error) => report?.(error),
      repository: createOutboxRepository(source),
      execute: async () => {},
      workspaceId: "demo",
    });

    worker.wake();

    await expect(reported).resolves.toBe(failure);
  });
});
