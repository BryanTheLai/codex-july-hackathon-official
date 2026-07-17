import { describe, expect, it, vi } from "vitest";

import {
  ApiClientError,
  type TelegramOutboundClient,
  type WorkspaceClient,
} from "../../src/services/api-client";
import {
  createCanonicalServerState,
  linkAcceptedTelegramOutboundText,
  mergeTelegramInboundText,
} from "../../src/domain";
import { createAppStore } from "../../src/store/use-app-store";

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

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function telegramServerState() {
  const result = mergeTelegramInboundText(await createCanonicalServerState(), {
    channel: "telegram",
    externalEventId: "1001",
    externalConversationId: "-10042",
    externalMessageId: "88",
    sender: {
      externalId: "42",
      displayName: "Aina Zulkifli",
    },
    message: {
      kind: "text",
      text: "Boleh saya buat temujanji?",
      language: "ms",
    },
    receivedAt: "2026-07-13T12:00:00.000Z",
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.state;
}

describe("Telegram browser store", () => {
  it("refreshes Telegram threads while preserving the synthetic workspace", async () => {
    const server = await telegramServerState();
    const workspaceClient: WorkspaceClient = {
      load: vi.fn().mockResolvedValue({
        workspaceId: "demo",
        revision: 4,
        state: server,
      }),
    };
    const store = createAppStore(new MemoryStorage(), { workspaceClient });
    const syntheticId = store.getState().state.conversations[0]!.id;

    const result = await store.getState().refreshTelegramWorkspace();

    expect(result.ok).toBe(true);
    expect(
      store.getState().state.conversations.map((conversation) => conversation.id),
    ).toEqual(
      expect.arrayContaining([
        "telegram-conversation:-10042",
        syntheticId,
      ]),
    );
    expect(store.getState().telegramWorkspace).toEqual({
      status: "ready",
      workspaceRevision: 4,
      conversationRevisions: {
        "telegram-conversation:-10042": 1,
      },
      speechArtifacts: {},
      pendingDelivery: null,
      deliveryNotice: null,
    });
  });

  it("persists a Telegram autopilot change instead of treating it as local demo state", async () => {
    const server = await telegramServerState();
    const conversation = server.conversations[0]!;
    const workspaceClient: WorkspaceClient = {
      load: vi.fn().mockResolvedValue({
        workspaceId: "demo",
        revision: 4,
        state: server,
      }),
      save: vi.fn(async (request) => ({
        ok: true as const,
        workspace: {
          workspaceId: "demo",
          revision: 5,
          state: request.state,
        },
      })),
    };
    const store = createAppStore(new MemoryStorage(), { workspaceClient });

    await store.getState().refreshTelegramWorkspace();
    const result = await store.getState().setTelegramAgentMode(
      conversation.id,
      "staff_only",
    );

    expect(result.ok).toBe(true);
    expect(workspaceClient.save).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 4,
        state: expect.objectContaining({
          conversations: expect.arrayContaining([
            expect.objectContaining({
              agentMode: "staff_only",
              id: conversation.id,
            }),
          ]),
        }),
      }),
      undefined,
    );
    expect(
      store.getState().state.conversations.find(
        (item) => item.id === conversation.id,
      )?.agentMode,
    ).toBe("staff_only");
    expect(store.getState().lastFeedback).toContain("autopilot paused");
  });

  it("keeps the local demo usable when server persistence is disabled", async () => {
    const workspaceClient: WorkspaceClient = {
      load: vi.fn().mockRejectedValue(
        new ApiClientError(
          "feature_disabled",
          "Workspace persistence is not configured.",
          false,
        ),
      ),
    };
    const store = createAppStore(new MemoryStorage(), { workspaceClient });
    const before = structuredClone(store.getState().state);

    const result = await store.getState().refreshTelegramWorkspace();

    expect(result.ok).toBe(true);
    expect(store.getState().state).toEqual(before);
    expect(store.getState().telegramWorkspace.status).toBe("local");
  });

  it("routes a cached Telegram thread through the provider boundary", async () => {
    const storage = new MemoryStorage();
    const server = await telegramServerState();
    const workspaceClient: WorkspaceClient = {
      load: vi.fn().mockResolvedValue({
        workspaceId: "demo",
        revision: 1,
        state: server,
      }),
    };
    const firstStore = createAppStore(storage, { workspaceClient });
    await firstStore.getState().refreshTelegramWorkspace();
    const outboundClient: TelegramOutboundClient = {
      send: vi.fn().mockRejectedValue(
        new ApiClientError(
          "feature_disabled",
          "Live Telegram sending is disabled.",
          false,
        ),
      ),
      reconcile: vi.fn(),
    };
    const reloadedStore = createAppStore(storage, { outboundClient });

    const result = await reloadedStore.getState().sendVisitorReply({
      requestId: "send-cached",
      conversationId: "telegram-conversation:-10042",
      kind: "reply",
      text: "This must not be local.",
    });

    expect(result.ok).toBe(false);
    expect(outboundClient.send).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "telegram-conversation:-10042",
        expectedConversationRevision: 1,
      }),
      undefined,
    );
    expect(result).toMatchObject({ error: "Live Telegram sending is disabled." });
    expect(
      reloadedStore
        .getState()
        .state.conversations.find(
          (conversation) =>
            conversation.id === "telegram-conversation:-10042",
        )
        ?.messages,
    ).toHaveLength(1);
  });

  it("discards an older refresh that finishes after a newer refresh", async () => {
    const first = deferred<Awaited<ReturnType<WorkspaceClient["load"]>>>();
    const second = deferred<Awaited<ReturnType<WorkspaceClient["load"]>>>();
    const olderState = await telegramServerState();
    const newerState = structuredClone(olderState);
    newerState.conversations[0]!.messages[0]!.text =
      "Newer Telegram state";
    const workspaceClient: WorkspaceClient = {
      load: vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
    };
    const store = createAppStore(new MemoryStorage(), { workspaceClient });

    const olderRefresh = store.getState().refreshTelegramWorkspace();
    const newerRefresh = store.getState().refreshTelegramWorkspace();
    second.resolve({
      workspaceId: "demo",
      revision: 2,
      state: newerState,
    });
    await newerRefresh;
    first.resolve({
      workspaceId: "demo",
      revision: 1,
      state: olderState,
    });
    await olderRefresh;

    expect(
      store
        .getState()
        .state.conversations.find(
          (conversation) =>
            conversation.id === "telegram-conversation:-10042",
        )
        ?.messages[0]?.text,
    ).toBe("Newer Telegram state");
    expect(store.getState().telegramWorkspace.workspaceRevision).toBe(2);
  });

  it("sends exact approved Telegram text then reloads provider-linked state", async () => {
    const inbound = await telegramServerState();
    const linked = linkAcceptedTelegramOutboundText(inbound, {
      conversationId: "telegram-conversation:-10042",
      messageId: "telegram-delivery:send-42:text",
      text: "Klinik akan menghubungi anda.",
      language: "Malay",
      sentAt: "2026-07-13T12:01:00.000Z",
    });
    if (!linked.ok) {
      throw new Error(linked.error);
    }
    const workspaceClient: WorkspaceClient = {
      load: vi
        .fn()
        .mockResolvedValueOnce({
          workspaceId: "demo",
          revision: 1,
          state: inbound,
        })
        .mockResolvedValueOnce({
          workspaceId: "demo",
          revision: 2,
          state: linked.state,
        }),
    };
    const outboundClient: TelegramOutboundClient = {
      send: vi.fn().mockResolvedValue({
        deliveryIds: ["send-42"],
        status: "sent",
        text: {
          providerMessageId: "9001",
          acceptedAt: "2026-07-13T12:01:00.000Z",
        },
      }),
      reconcile: vi.fn(),
    };
    const storage = new MemoryStorage();
    const store = createAppStore(storage, {
      outboundClient,
      workspaceClient,
    });
    await store.getState().refreshTelegramWorkspace();

    const result = await store.getState().sendVisitorReply({
      requestId: "send-42",
      conversationId: "telegram-conversation:-10042",
      kind: "reply",
      text: "Clinic will contact you.",
      translation: {
        language: "Malay",
        text: "Klinik akan menghubungi anda.",
      },
    });

    expect(result.ok).toBe(true);
    expect(outboundClient.send).toHaveBeenCalledWith(
      {
        requestId: "send-42",
        conversationId: "telegram-conversation:-10042",
        expectedConversationRevision: 1,
        targetLanguage: "Malay",
        approvedPatientText: "Klinik akan menghubungi anda.",
        mode: "text",
      },
      undefined,
    );
    expect(
      store
        .getState()
        .state.conversations.find(
          (conversation) =>
            conversation.id === "telegram-conversation:-10042",
        )
        ?.messages.at(-1),
    ).toMatchObject({
      id: "telegram-delivery:send-42:text",
      text: "Klinik akan menghubungi anda.",
    });
  });

  it("keeps failed Telegram text out of the transcript for same-ID retry", async () => {
    const server = await telegramServerState();
    const workspaceClient: WorkspaceClient = {
      load: vi.fn().mockResolvedValue({
        workspaceId: "demo",
        revision: 1,
        state: server,
      }),
    };
    const outboundClient: TelegramOutboundClient = {
      send: vi.fn().mockResolvedValue({
        deliveryIds: ["send-42"],
        status: "failed",
        failedParts: ["text"],
      }),
      reconcile: vi.fn(),
    };
    const storage = new MemoryStorage();
    const store = createAppStore(storage, {
      outboundClient,
      workspaceClient,
    });
    await store.getState().refreshTelegramWorkspace();
    const before = structuredClone(store.getState().state);
    const input = {
      requestId: "send-42",
      conversationId: "telegram-conversation:-10042",
      kind: "reply" as const,
      text: "Klinik akan menghubungi anda.",
    };

    const failed = await store.getState().sendVisitorReply(input);
    await store.getState().sendVisitorReply(input);

    expect(failed.ok).toBe(false);
    expect(store.getState().state).toEqual(before);
    expect(outboundClient.send).toHaveBeenCalledTimes(2);
    expect(outboundClient.send).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ requestId: "send-42" }),
      undefined,
    );
  });

  it("persists a partial delivery and retries the original request ID and mode", async () => {
    const server = await telegramServerState();
    const workspaceClient: WorkspaceClient = {
      load: vi.fn().mockResolvedValue({
        workspaceId: "demo",
        revision: 1,
        state: server,
      }),
    };
    const outboundClient: TelegramOutboundClient = {
      prepareVoice: vi.fn().mockResolvedValue({
        requestId: "send-both",
        source: "tts",
        status: "ready",
      }),
      send: vi
        .fn()
        .mockResolvedValueOnce({
          deliveryIds: ["send-both"],
          status: "partial_failure",
          text: {
            providerMessageId: "9001",
            acceptedAt: "2026-07-13T12:01:00.000Z",
          },
          failedParts: ["voice"],
        })
        .mockResolvedValueOnce({
          deliveryIds: ["send-both"],
          status: "sent",
          text: {
            providerMessageId: "9001",
            acceptedAt: "2026-07-13T12:01:00.000Z",
          },
          voice: {
            providerMessageId: "9002",
            acceptedAt: "2026-07-13T12:02:00.000Z",
          },
        }),
      reconcile: vi.fn(),
    };
    const storage = new MemoryStorage();
    const store = createAppStore(storage, { outboundClient, workspaceClient });
    await store.getState().refreshTelegramWorkspace();

    const first = await store.getState().sendVisitorReply({
      requestId: "send-both",
      conversationId: "telegram-conversation:-10042",
      kind: "reply",
      text: "Klinik akan menghubungi anda.",
      deliveryMode: "both",
      voiceSource: "tts",
    });

    expect(first.ok).toBe(false);
    expect(store.getState().telegramWorkspace.deliveryNotice).toMatchObject({
      requestId: "send-both",
      mode: "both",
      status: "partial_failure",
      failedParts: ["voice"],
    });

    const reloadedStore = createAppStore(storage, {
      outboundClient,
      workspaceClient,
    });
    expect(reloadedStore.getState().telegramWorkspace.deliveryNotice).toMatchObject({
      requestId: "send-both",
      status: "partial_failure",
      failedParts: ["voice"],
    });

    await expect(reloadedStore.getState().retryTelegramDelivery()).resolves.toMatchObject({
      ok: true,
    });
    expect(outboundClient.send).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        requestId: "send-both",
        mode: "both",
        voiceSource: "tts",
      }),
      undefined,
    );
  });

  it("reloads current conversation revision after a send conflict", async () => {
    const initial = await telegramServerState();
    const updated = mergeTelegramInboundText(initial, {
      channel: "telegram",
      externalEventId: "1002",
      externalConversationId: "-10042",
      externalMessageId: "89",
      sender: {
        externalId: "42",
        displayName: "Aina Zulkifli",
      },
      message: {
        kind: "text",
        text: "Ada perubahan?",
        language: "ms",
      },
      receivedAt: "2026-07-13T12:02:00.000Z",
    });
    if (!updated.ok) {
      throw new Error(updated.error);
    }
    const workspaceClient: WorkspaceClient = {
      load: vi
        .fn()
        .mockResolvedValueOnce({
          workspaceId: "demo",
          revision: 1,
          state: initial,
        })
        .mockResolvedValueOnce({
          workspaceId: "demo",
          revision: 2,
          state: updated.state,
        }),
    };
    const outboundClient: TelegramOutboundClient = {
      send: vi.fn().mockRejectedValue(
        new ApiClientError(
          "revision_conflict",
          "Conversation changed before Telegram send.",
          true,
        ),
      ),
      reconcile: vi.fn(),
    };
    const store = createAppStore(new MemoryStorage(), {
      outboundClient,
      workspaceClient,
    });
    await store.getState().refreshTelegramWorkspace();

    const result = await store.getState().sendVisitorReply({
      requestId: "send-conflict",
      conversationId: "telegram-conversation:-10042",
      kind: "reply",
      text: "Klinik akan menghubungi anda.",
    });

    expect(result.ok).toBe(false);
    expect(workspaceClient.load).toHaveBeenCalledTimes(2);
    expect(
      store.getState().telegramWorkspace.conversationRevisions[
        "telegram-conversation:-10042"
      ],
    ).toBe(2);
    expect(store.getState().lastFeedback).toMatch(/review.*retry/i);
  });

  it("keeps synthetic replies and internal notes on the local mutation path", async () => {
    const outboundClient: TelegramOutboundClient = {
      send: vi.fn(),
      reconcile: vi.fn(),
    };
    const store = createAppStore(new MemoryStorage(), { outboundClient });
    const conversationId = store.getState().state.conversations[0]!.id;

    const reply = await store.getState().sendVisitorReply({
      requestId: "local-reply",
      conversationId,
      kind: "reply",
      text: "Local synthetic reply",
    });
    const note = await store.getState().sendVisitorReply({
      requestId: "local-note",
      conversationId,
      kind: "internal_note",
      text: "Local internal note",
    });

    expect(reply.ok).toBe(true);
    expect(note.ok).toBe(true);
    expect(outboundClient.send).not.toHaveBeenCalled();
    expect(
      store
        .getState()
        .state.conversations.find(
          (conversation) => conversation.id === conversationId,
        )
        ?.messages.slice(-2)
        .map((message) => message.text),
    ).toEqual([
      "Local synthetic reply",
      "Internal note: Local internal note",
    ]);
  });

  it("reconciles accepted text missing from the refreshed workspace without resending", async () => {
    const inbound = await telegramServerState();
    const linked = linkAcceptedTelegramOutboundText(inbound, {
      conversationId: "telegram-conversation:-10042",
      messageId: "telegram-delivery:send-42:text",
      text: "Klinik akan menghubungi anda.",
      language: "Malay",
      sentAt: "2026-07-13T12:01:00.000Z",
    });
    if (!linked.ok) {
      throw new Error(linked.error);
    }
    const workspaceClient: WorkspaceClient = {
      load: vi
        .fn()
        .mockResolvedValueOnce({
          workspaceId: "demo",
          revision: 1,
          state: inbound,
        })
        .mockResolvedValueOnce({
          workspaceId: "demo",
          revision: 1,
          state: inbound,
        })
        .mockResolvedValueOnce({
          workspaceId: "demo",
          revision: 2,
          state: linked.state,
        }),
    };
    const outboundClient: TelegramOutboundClient = {
      send: vi.fn().mockResolvedValue({
        deliveryIds: ["send-42"],
        status: "sent",
        text: {
          providerMessageId: "9001",
          acceptedAt: "2026-07-13T12:01:00.000Z",
        },
      }),
      reconcile: vi.fn().mockResolvedValue({
        deliveryId: "send-42",
        workspaceSyncStatus: "synced",
        workspaceRevision: 2,
      }),
    };
    const storage = new MemoryStorage();
    const store = createAppStore(storage, {
      outboundClient,
      workspaceClient,
    });
    await store.getState().refreshTelegramWorkspace();

    const sent = await store.getState().sendVisitorReply({
      requestId: "send-42",
      conversationId: "telegram-conversation:-10042",
      kind: "reply",
      text: "Klinik akan menghubungi anda.",
    });

    expect(sent.ok).toBe(true);
    expect(store.getState().telegramWorkspace.pendingDelivery).toEqual({
      conversationId: "telegram-conversation:-10042",
      deliveryId: "send-42",
    });
    expect(outboundClient.send).toHaveBeenCalledTimes(1);

    const reloadedStore = createAppStore(storage, {
      outboundClient,
      workspaceClient,
    });
    expect(reloadedStore.getState().telegramWorkspace.pendingDelivery).toEqual({
      conversationId: "telegram-conversation:-10042",
      deliveryId: "send-42",
    });
    const reconciled = await reloadedStore
      .getState()
      .reconcileTelegramDelivery();

    expect(reconciled.ok).toBe(true);
    expect(outboundClient.reconcile).toHaveBeenCalledWith(
      "send-42",
      { expectedConversationRevision: 1 },
      undefined,
    );
    expect(outboundClient.send).toHaveBeenCalledTimes(1);
    expect(
      reloadedStore.getState().telegramWorkspace.pendingDelivery,
    ).toBeNull();
    expect(
      reloadedStore
        .getState()
        .state.conversations.find(
          (conversation) =>
            conversation.id === "telegram-conversation:-10042",
        )
        ?.messages.at(-1)?.id,
    ).toBe("telegram-delivery:send-42:text");
  });

  it("restores the prior Telegram workspace status when reconciliation is aborted", async () => {
    const inbound = await telegramServerState();
    const workspaceClient: WorkspaceClient = {
      load: vi.fn().mockResolvedValue({
        workspaceId: "demo",
        revision: 1,
        state: inbound,
      }),
    };
    const outboundClient: TelegramOutboundClient = {
      send: vi.fn().mockResolvedValue({
        deliveryIds: ["send-abort"],
        status: "sent",
        text: {
          providerMessageId: "9002",
          acceptedAt: "2026-07-13T12:01:00.000Z",
        },
      }),
      reconcile: vi.fn(
        (_deliveryId, _request, signal) =>
          new Promise<never>((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          }),
      ),
    };
    const store = createAppStore(new MemoryStorage(), {
      outboundClient,
      workspaceClient,
    });
    await store.getState().refreshTelegramWorkspace();
    await store.getState().sendVisitorReply({
      requestId: "send-abort",
      conversationId: "telegram-conversation:-10042",
      kind: "reply",
      text: "Klinik akan menghubungi anda.",
    });
    expect(store.getState().telegramWorkspace.status).toBe("ready");
    expect(store.getState().telegramWorkspace.pendingDelivery).not.toBeNull();
    const controller = new AbortController();
    const pending = store
      .getState()
      .reconcileTelegramDelivery(controller.signal);
    await vi.waitFor(() => {
      expect(store.getState().telegramWorkspace.status).toBe("loading");
    });

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(store.getState().telegramWorkspace.status).toBe("ready");
  });

  it("reloads current revision after a reconciliation conflict", async () => {
    const inbound = await telegramServerState();
    const updated = mergeTelegramInboundText(inbound, {
      channel: "telegram",
      externalEventId: "1002",
      externalConversationId: "-10042",
      externalMessageId: "89",
      sender: {
        externalId: "42",
        displayName: "Aina Zulkifli",
      },
      message: {
        kind: "text",
        text: "Mesej serentak.",
        language: "ms",
      },
      receivedAt: "2026-07-13T12:02:00.000Z",
    });
    if (!updated.ok) {
      throw new Error(updated.error);
    }
    const workspaceClient: WorkspaceClient = {
      load: vi
        .fn()
        .mockResolvedValueOnce({
          workspaceId: "demo",
          revision: 1,
          state: inbound,
        })
        .mockResolvedValueOnce({
          workspaceId: "demo",
          revision: 1,
          state: inbound,
        })
        .mockResolvedValueOnce({
          workspaceId: "demo",
          revision: 2,
          state: updated.state,
        }),
    };
    const outboundClient: TelegramOutboundClient = {
      send: vi.fn().mockResolvedValue({
        deliveryIds: ["send-42"],
        status: "sent",
        text: {
          providerMessageId: "9001",
          acceptedAt: "2026-07-13T12:01:00.000Z",
        },
      }),
      reconcile: vi.fn().mockRejectedValue(
        new ApiClientError(
          "revision_conflict",
          "Conversation changed before Telegram reconciliation.",
          true,
        ),
      ),
    };
    const store = createAppStore(new MemoryStorage(), {
      outboundClient,
      workspaceClient,
    });
    await store.getState().refreshTelegramWorkspace();
    await store.getState().sendVisitorReply({
      requestId: "send-42",
      conversationId: "telegram-conversation:-10042",
      kind: "reply",
      text: "Klinik akan menghubungi anda.",
    });

    const result = await store
      .getState()
      .reconcileTelegramDelivery();

    expect(result.ok).toBe(false);
    expect(workspaceClient.load).toHaveBeenCalledTimes(3);
    expect(
      store.getState().telegramWorkspace.conversationRevisions[
        "telegram-conversation:-10042"
      ],
    ).toBe(2);
    expect(store.getState().telegramWorkspace.pendingDelivery).toEqual({
      conversationId: "telegram-conversation:-10042",
      deliveryId: "send-42",
    });
    expect(store.getState().lastFeedback).toMatch(/sync again/i);
  });

  it("treats provider acceptance as success even if the follow-up refresh fails", async () => {
    const server = await telegramServerState();
    const workspaceClient: WorkspaceClient = {
      load: vi
        .fn()
        .mockResolvedValueOnce({
          workspaceId: "demo",
          revision: 1,
          state: server,
        })
        .mockRejectedValueOnce(new Error("network down")),
    };
    const outboundClient: TelegramOutboundClient = {
      send: vi.fn().mockResolvedValue({
        deliveryIds: ["send-42"],
        status: "sent",
        text: {
          providerMessageId: "9001",
          acceptedAt: "2026-07-13T12:01:00.000Z",
        },
      }),
      reconcile: vi.fn(),
    };
    const store = createAppStore(new MemoryStorage(), {
      outboundClient,
      workspaceClient,
    });
    await store.getState().refreshTelegramWorkspace();

    const result = await store.getState().sendVisitorReply({
      requestId: "send-42",
      conversationId: "telegram-conversation:-10042",
      kind: "reply",
      text: "Klinik akan menghubungi anda.",
    });

    expect(result.ok).toBe(true);
    expect(store.getState().lastFeedback).toMatch(
      /accepted.*refresh/i,
    );
    expect(store.getState().telegramWorkspace.pendingDelivery).toEqual({
      conversationId: "telegram-conversation:-10042",
      deliveryId: "send-42",
    });
    expect(outboundClient.send).toHaveBeenCalledTimes(1);
  });
});
