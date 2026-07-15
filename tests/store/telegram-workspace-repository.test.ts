import { describe, expect, it } from "vitest";

import {
  createTelegramWorkspaceRepository,
  INITIAL_TELEGRAM_WORKSPACE,
  TELEGRAM_WORKSPACE_STORAGE_KEY,
} from "../../src/store/telegram-workspace-repository";

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe("Telegram workspace repository", () => {
  it("starts with an isolated local workspace state", () => {
    const repository = createTelegramWorkspaceRepository(
      new MemoryStorage(),
    );

    const first = repository.load();
    first.conversationRevisions.changed = 9;

    expect(repository.load()).toEqual(INITIAL_TELEGRAM_WORKSPACE);
  });

  it("round-trips revisions and accepted pending delivery recovery", () => {
    const repository = createTelegramWorkspaceRepository(
      new MemoryStorage(),
    );
    repository.save({
      status: "loading",
      workspaceRevision: 3,
      conversationRevisions: {
        "telegram-conversation:-10042": 2,
      },
      pendingDelivery: {
        conversationId: "telegram-conversation:-10042",
        deliveryId: "send-42",
      },
    });

    expect(repository.load()).toEqual({
      status: "ready",
      workspaceRevision: 3,
      conversationRevisions: {
        "telegram-conversation:-10042": 2,
      },
      pendingDelivery: {
        conversationId: "telegram-conversation:-10042",
        deliveryId: "send-42",
      },
    });
  });

  it("clears malformed sidecar state instead of inventing revisions", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      TELEGRAM_WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          status: "ready",
          workspaceRevision: 2,
          conversationRevisions: {
            "telegram-conversation:-10042": 0,
          },
          pendingDelivery: null,
        },
      }),
    );
    const repository = createTelegramWorkspaceRepository(storage);

    expect(repository.load()).toEqual(INITIAL_TELEGRAM_WORKSPACE);
    expect(storage.getItem(TELEGRAM_WORKSPACE_STORAGE_KEY)).toBeNull();
  });
});
