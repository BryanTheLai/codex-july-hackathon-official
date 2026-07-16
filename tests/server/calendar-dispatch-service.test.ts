import { describe, expect, it, vi } from "vitest";

import type { ChannelAdapter } from "../../src/contracts/channel";
import { createCanonicalServerState, mergeTelegramInboundText } from "../../src/domain";
import {
  createCalendarDeliveryRepository,
  type CalendarDeliveryDataSource,
} from "../../server/calendar-repository";
import {
  CalendarDispatchError,
  createCalendarDispatchService,
} from "../../server/calendar-dispatch-service";
import { TelegramAdapterError } from "../../server/telegram-adapter";
import { createWorkspaceRepository } from "../../server/workspace-repository";
import { InMemoryWorkspaceDataSource } from "./fixtures/workspace-data-source";

class InMemoryCalendarDataSource implements CalendarDeliveryDataSource {
  records: import("../../server/calendar-repository").CalendarDeliveryRecord[] = [];

  async read(requestId: string) {
    return structuredClone(this.records.find((record) => record.requestId === requestId) ?? null);
  }

  async insertIfAbsent(record: import("../../server/calendar-repository").CalendarDeliveryRecord) {
    if (this.records.some((item) => item.requestId === record.requestId)) return null;
    this.records.push(structuredClone(record));
    return structuredClone(record);
  }

  async updateIfStatus(
    record: import("../../server/calendar-repository").CalendarDeliveryRecord,
    expectedStatus: import("../../server/calendar-repository").CalendarDeliveryStatus,
  ) {
    const index = this.records.findIndex(
      (item) => item.requestId === record.requestId && item.status === expectedStatus,
    );
    if (index < 0) return null;
    this.records[index] = structuredClone(record);
    return structuredClone(record);
  }
}

async function workspaceWithApprovedTelegramBooking() {
  const base = await createCanonicalServerState();
  const merged = mergeTelegramInboundText(base, {
    channel: "telegram",
    externalEventId: "1001",
    externalConversationId: "-10042",
    externalMessageId: "88",
    sender: { externalId: "42", displayName: "Aina Zulkifli" },
    message: { kind: "text", text: "Can I book?", language: "en" },
    receivedAt: "2026-07-13T12:00:00.000Z",
  });
  if (!merged.ok) throw new Error(merged.error);
  const conversation = merged.state.conversations.find(
    (item) => item.id === "telegram-conversation:-10042",
  );
  if (!conversation) throw new Error("Telegram conversation was not created");
  conversation.booking = {
    provider: "Dr. Siti Rahman",
    reason: "Routine review",
    revision: 1,
    slotIso: "2099-07-21T02:00:00.000Z",
    status: "approved",
  };
  return merged.state;
}

describe("calendar dispatch service", () => {
  it("sends one private ICS attachment and returns its durable receipt", async () => {
    const workspaceRepository = createWorkspaceRepository(new InMemoryWorkspaceDataSource());
    await workspaceRepository.bootstrap("demo", await workspaceWithApprovedTelegramBooking());
    const calendarRepository = createCalendarDeliveryRepository(new InMemoryCalendarDataSource());
    const sendDocument = vi.fn<ChannelAdapter["sendDocument"]>(async () => ({
      acceptedAt: "2026-07-13T12:01:00.000Z",
      providerMessageId: "9003",
    }));
    const service = createCalendarDispatchService({
      adapter: { sendDocument },
      config: {
        allowedChatIds: new Set(["-10042"]),
        defaultDurationMinutes: 30,
        enabled: true,
        location: "KaunterAI Clinic",
        uidDomain: "calendar.kaunterai.test",
      },
      deliveryRepository: calendarRepository,
      now: () => new Date("2026-07-13T12:00:00.000Z"),
      workspaceId: "demo",
      workspaceRepository,
    });

    const first = await service.send({
      conversationId: "telegram-conversation:-10042",
      expectedConversationRevision: 1,
    });
    const duplicate = await service.send({
      conversationId: "telegram-conversation:-10042",
      expectedConversationRevision: 1,
    });

    expect(first).toMatchObject({ status: "sent", providerMessageId: "9003" });
    expect(duplicate).toEqual(first);
    expect(sendDocument).toHaveBeenCalledTimes(1);
    expect(sendDocument).toHaveBeenCalledWith(
      "-10042",
      expect.objectContaining({ contentType: "text/calendar", filename: "appointment.ics" }),
      first.requestId,
    );
    expect(new TextDecoder().decode(sendDocument.mock.calls[0]?.[1].bytes)).not.toContain(
      "Routine review",
    );
  });

  it("fails closed after a provider timeout instead of attempting a resend", async () => {
    const workspaceRepository = createWorkspaceRepository(new InMemoryWorkspaceDataSource());
    await workspaceRepository.bootstrap("demo", await workspaceWithApprovedTelegramBooking());
    const sendDocument = vi.fn<ChannelAdapter["sendDocument"]>(async () => {
      throw new TelegramAdapterError("provider_timeout", "Telegram timed out");
    });
    const service = createCalendarDispatchService({
      adapter: { sendDocument },
      config: {
        allowedChatIds: new Set(["-10042"]),
        defaultDurationMinutes: 30,
        enabled: true,
        location: null,
        uidDomain: "calendar.kaunterai.test",
      },
      deliveryRepository: createCalendarDeliveryRepository(new InMemoryCalendarDataSource()),
      now: () => new Date("2026-07-13T12:00:00.000Z"),
      workspaceId: "demo",
      workspaceRepository,
    });
    const request = {
      conversationId: "telegram-conversation:-10042",
      expectedConversationRevision: 1,
    } as const;

    await expect(service.send(request)).rejects.toMatchObject({ code: "provider_timeout" });
    await expect(service.send(request)).rejects.toEqual(
      new CalendarDispatchError(
        "duplicate",
        "Calendar delivery outcome is unknown. Verify with the patient before sending a replacement.",
        false,
      ),
    );
    expect(sendDocument).toHaveBeenCalledTimes(1);
  });
});
