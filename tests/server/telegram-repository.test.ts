import { describe, expect, it } from "vitest";

import {
  createTelegramDeliveryRepository,
  createTelegramEventRepository,
} from "../../server/telegram-repository";
import {
  InMemoryTelegramDeliveryDataSource,
  InMemoryTelegramEventDataSource,
} from "./fixtures/telegram-data-source";

const now = () => "2026-07-13T12:00:00.000Z";

describe("Telegram event repository", () => {
  it("registers one update and returns existing truth on duplicate insert", async () => {
    const source = new InMemoryTelegramEventDataSource();
    const repository = createTelegramEventRepository(source, now);
    const input = {
      updateId: 1001,
      workspaceId: "demo",
      payloadHash: "a".repeat(64),
      normalizedMessageId: "telegram-message:-10042:88",
    };

    const first = await repository.register(input);
    const duplicate = await repository.register(input);

    expect(first).toMatchObject({
      inserted: true,
      record: {
        ...input,
        status: "received",
        error: null,
      },
    });
    expect(duplicate).toEqual({
      inserted: false,
      record: first.record,
    });
    expect(source.records).toHaveLength(1);
  });

  it("records a bounded failure and then marks a recovered event processed", async () => {
    const source = new InMemoryTelegramEventDataSource();
    const repository = createTelegramEventRepository(source, now);
    await repository.register({
      updateId: 1001,
      workspaceId: "demo",
      payloadHash: "a".repeat(64),
      normalizedMessageId: "telegram-message:-10042:88",
    });

    await expect(
      repository.markFailed(1001, "provider_failed"),
    ).resolves.toMatchObject({
      status: "failed",
      error: { code: "provider_failed" },
    });
    await expect(repository.markProcessed(1001)).resolves.toMatchObject({
      status: "processed",
      error: null,
    });
  });

  it("never downgrades an event another request already processed", async () => {
    const source = new InMemoryTelegramEventDataSource();
    const repository = createTelegramEventRepository(source, now);
    await repository.register({
      updateId: 1001,
      workspaceId: "demo",
      payloadHash: "a".repeat(64),
      normalizedMessageId: "telegram-message:-10042:88",
    });
    await repository.markProcessed(1001);

    await expect(
      repository.markFailed(1001, "provider_failed"),
    ).resolves.toMatchObject({
      status: "processed",
      error: null,
    });
  });
});

describe("Telegram delivery repository", () => {
  const input = {
    requestId: "send-42",
    part: "text" as const,
    workspaceId: "demo",
    conversationId: "telegram-conversation:-10042",
    targetLanguage: "Malay",
    approvedText: "Klinik akan menghubungi anda.",
    approvedTextHash: "b".repeat(64),
  };

  it("allows one sender to claim a pending delivery", async () => {
    const source = new InMemoryTelegramDeliveryDataSource();
    const repository = createTelegramDeliveryRepository(source, now);
    const first = await repository.createOrLoad(input);
    const duplicate = await repository.createOrLoad(input);

    expect(first).toMatchObject({
      inserted: true,
      record: {
        ...input,
        status: "pending",
        workspaceSyncStatus: "pending",
        providerMessageId: null,
        providerAcceptedAt: null,
        error: null,
      },
    });
    expect(duplicate).toEqual({
      inserted: false,
      record: first.record,
    });

    await expect(
      repository.claim(input.requestId, input.part),
    ).resolves.toMatchObject({
      status: "sending",
    });
    await expect(
      repository.claim(input.requestId, input.part),
    ).resolves.toBeNull();
  });

  it("stores provider acceptance before aggregate synchronization", async () => {
    const source = new InMemoryTelegramDeliveryDataSource();
    const repository = createTelegramDeliveryRepository(source, now);
    await repository.createOrLoad(input);
    await repository.claim(input.requestId, input.part);

    const sent = await repository.markSent(input.requestId, input.part, {
      providerMessageId: "9001",
      acceptedAt: "2026-07-13T12:01:00.000Z",
    });
    expect(sent).toMatchObject({
      status: "sent",
      workspaceSyncStatus: "pending",
      providerMessageId: "9001",
      providerAcceptedAt: "2026-07-13T12:01:00.000Z",
    });

    await expect(
      repository.markSynced(input.requestId, input.part),
    ).resolves.toMatchObject({
      status: "sent",
      workspaceSyncStatus: "synced",
      providerMessageId: "9001",
    });
  });

  it("allows retry only after a terminal failure", async () => {
    const source = new InMemoryTelegramDeliveryDataSource();
    const repository = createTelegramDeliveryRepository(source, now);
    await repository.createOrLoad(input);
    await repository.claim(input.requestId, input.part);
    await expect(
      repository.markFailed(input.requestId, input.part, "provider_failed"),
    ).resolves.toMatchObject({
      status: "failed",
      error: { code: "provider_failed" },
    });

    await expect(
      repository.claim(input.requestId, input.part),
    ).resolves.toMatchObject({
      status: "sending",
      error: null,
    });
  });
});
