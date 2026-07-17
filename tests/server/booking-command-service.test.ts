import { describe, expect, it, vi } from "vitest";

import {
  createCanonicalServerState,
  mergeTelegramInboundText,
} from "../../src/domain";
import { createBookingCommandService } from "../../server/booking-command-service";
import type { CalendarAvailability } from "../../server/google-calendar-service";
import type { OutboxRepository } from "../../server/outbox-repository";
import { createWorkspaceRepository } from "../../server/workspace-repository";
import { InMemoryWorkspaceDataSource } from "./fixtures/workspace-data-source";

async function configuredService(
  calendarAvailability?: CalendarAvailability,
  outboxRepository?: Pick<OutboxRepository, "enqueue">,
  withBooking = true,
) {
  const inbound = mergeTelegramInboundText(await createCanonicalServerState(), {
    channel: "telegram",
    externalEventId: "101",
    externalConversationId: "-101",
    externalMessageId: "11",
    sender: { externalId: "patient-1", displayName: "Aina" },
    message: { kind: "text", language: "en", text: "Please book." },
    receivedAt: "2026-07-17T01:00:00.000Z",
  });
  if (!inbound.ok) throw new Error(inbound.error);
  const repository = createWorkspaceRepository(new InMemoryWorkspaceDataSource());
  const bootstrapped = await repository.bootstrap("demo", inbound.state);
  const conversation = bootstrapped.state.conversations[0]!;
  const state = structuredClone(bootstrapped.state);
  state.conversations[0] = {
    ...conversation,
    booking: withBooking
      ? {
          reason: "Routine checkup",
          revision: 1,
          slotIso: "2026-07-17T10:30:00+08:00",
          status: "approved",
        }
      : undefined,
  };
  const saved = await repository.save("demo", bootstrapped.revision, state);
  if (!saved.ok) throw new Error("Booking seed failed");
  return {
    conversation: saved.workspace.state.conversations[0]!,
    repository,
    service: createBookingCommandService({
      calendarAvailability,
      now: () => "2026-07-17T02:00:00.000Z",
      outboxRepository,
      workspaceId: "demo",
      workspaceRepository: repository,
    }),
  };
}

describe("booking command service", () => {
  it("updates and cancels a persisted Telegram booking with revisions and an action trace", async () => {
    const { conversation, service } = await configuredService();
    const updated = await service.execute({
      action: "update",
      conversationId: conversation.id,
      expectedBookingRevision: 1,
      expectedConversationRevision: conversation.revision,
      reason: "Follow-up",
      slotIso: "2026-07-17T14:00:00+08:00",
    });
    expect(updated.booking).toMatchObject({
      reason: "Follow-up",
      revision: 2,
      slotIso: "2026-07-17T14:00:00+08:00",
      status: "approved",
    });
    const updatedConversation = updated.workspace.state.conversations[0]!;
    expect(updatedConversation.messages.at(-1)?.text).toContain("Google Calendar synchronization runs when connected");

    const cancelled = await service.execute({
      action: "cancel",
      conversationId: conversation.id,
      expectedBookingRevision: 2,
      expectedConversationRevision: updatedConversation.revision,
    });
    expect(cancelled.booking).toMatchObject({ status: "cancelled", revision: 3 });
  });

  it("queues a Google Calendar sync for each persisted booking revision", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const outboxRepository: Pick<OutboxRepository, "enqueue"> = {
      enqueue: async (input) => {
        await enqueue(input);
      },
    };
    const { conversation, service } = await configuredService(undefined, outboxRepository);

    await service.execute({
      action: "update",
      conversationId: conversation.id,
      expectedBookingRevision: 1,
      expectedConversationRevision: conversation.revision,
      reason: "Follow-up",
      slotIso: "2026-07-17T14:00:00+08:00",
    });

    expect(enqueue).toHaveBeenCalledWith({
      workspaceId: "demo",
      kind: "google_calendar_sync",
      dedupeKey: `google:${conversation.id}:2`,
      payload: { conversationId: conversation.id, bookingRevision: 2 },
    });
  });

  it("creates a persisted Telegram booking and queues its first Calendar revision", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const outboxRepository: Pick<OutboxRepository, "enqueue"> = {
      enqueue: async (input) => {
        await enqueue(input);
      },
    };
    const { conversation, service } = await configuredService(
      undefined,
      outboxRepository,
      false,
    );

    const created = await service.execute({
      action: "create",
      conversationId: conversation.id,
      expectedConversationRevision: conversation.revision,
      reason: "Follow-up",
      slotIso: "2026-07-17T14:00:00+08:00",
    });

    expect(created.booking).toMatchObject({
      revision: 1,
      status: "approved",
    });
    expect(enqueue).toHaveBeenCalledWith({
      workspaceId: "demo",
      kind: "google_calendar_sync",
      dedupeKey: `google:${conversation.id}:1`,
      payload: { conversationId: conversation.id, bookingRevision: 1 },
    });
  });

  it("rejects stale updates instead of overwriting a newer booking", async () => {
    const { conversation, service } = await configuredService();
    await expect(
      service.execute({
        action: "update",
        conversationId: conversation.id,
        expectedBookingRevision: 2,
        expectedConversationRevision: conversation.revision,
        reason: "Follow-up",
        slotIso: "2026-07-17T14:00:00+08:00",
      }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
  });

  it("refuses an admin edit when the connected calendar reports the slot busy", async () => {
    const filterAvailableSlots = vi.fn(async () => ({ source: "google" as const, slots: [] }));
    const { conversation, repository, service } = await configuredService({ filterAvailableSlots });

    await expect(
      service.execute({
        action: "update",
        conversationId: conversation.id,
        expectedBookingRevision: 1,
        expectedConversationRevision: conversation.revision,
        reason: "Follow-up",
        slotIso: "2026-07-17T14:00:00+08:00",
      }),
    ).rejects.toMatchObject({
      code: "invalid_request",
      message: "That appointment slot is no longer available. Choose another time.",
    });
    expect(filterAvailableSlots).toHaveBeenCalledWith({
      slots: [{ slotIso: "2026-07-17T14:00:00+08:00" }],
    });
    expect((await repository.load("demo"))?.revision).toBe(2);
  });
});
