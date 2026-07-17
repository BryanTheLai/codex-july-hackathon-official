import type { OutboxJob, OutboxRepository } from "./outbox-repository";

export interface OutboxWorker {
  drain(): Promise<void>;
  start(): void;
  stop(): void;
  wake(): void;
}

type OutboxWorkerOptions = {
  execute(job: OutboxJob): Promise<void>;
  intervalMs?: number;
  onDrainError?: (error: unknown) => void;
  onError?: (job: OutboxJob, error: unknown, outcome: "retrying" | "failed") => void;
  repository: OutboxRepository;
  workspaceId: string;
};

export function createOutboxWorker({
  execute,
  intervalMs = 5_000,
  onDrainError,
  onError,
  repository,
  workspaceId,
}: OutboxWorkerOptions): OutboxWorker {
  let draining: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const drainInBackground = () => {
    void drain().catch((error: unknown) => {
      onDrainError?.(error);
    });
  };

  const drain = async () => {
    if (draining) return draining;
    draining = (async () => {
      const jobs = await repository.claim(workspaceId);
      for (const job of jobs) {
        try {
          await execute(job);
          await repository.complete(job);
        } catch (error) {
          const outcome = await repository.retry(job, error);
          onError?.(job, error, outcome);
        }
      }
    })().finally(() => {
      draining = null;
    });
    return draining;
  };

  return {
    drain,
    start() {
      if (timer) return;
      timer = setInterval(() => {
        drainInBackground();
      }, intervalMs);
      timer.unref?.();
      drainInBackground();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
    wake() {
      drainInBackground();
    },
  };
}
