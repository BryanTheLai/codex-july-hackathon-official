import { describe, expect, it, vi } from "vitest";

import type { ChannelAdapter } from "../../src/contracts/channel";
import { CALENDAR_INVITATION_SENT_AUDIT_PREFIX } from "../../src/contracts/calendar";
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

async function workspaceWithTelegramBooking(
  status: "approved" | "cancelled" = "approved",
) {
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
    reason: "Routine review",
    revision: status === "cancelled" ? 2 : 1,
    slotIso: "2099-07-21T02:00:00.000Z",
    status,
  };
  return merged.state;
}

describe("calendar dispatch service", () => {
  it("sends one private ICS attachment and returns its durable receipt", async () => {
    const workspaceRepository = createWorkspaceRepository(new InMemoryWorkspaceDataSource());
    await workspaceRepository.bootstrap("demo", await workspaceWithTelegramBooking());
    const calendarRepository = createCalendarDeliveryRepository(new InMemoryCalendarDataSource());
    const sendDocument = vi.fn<ChannelAdapter["sendDocument"]>(async () => ({
      acceptedAt: "2026-07-13T12:01:00.000Z",
      providerMessageId: "9003",
    }));
    const service = createCalendarDispatchService({
      adapter: { sendDocument },
      config: {
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

    expect(first).toMatchObject({
      status: "sent",
      providerMessageId: "9003",
      conversationRevision: 2,
    });
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
    const saved = await workspaceRepository.load("demo");
    const conversation = saved?.state.conversations.find(
      (candidate) => candidate.id === "telegram-conversation:-10042",
    );
    expect(conversation?.messages.at(-1)).toMatchObject({
      role: "system",
      text: `${CALENDAR_INVITATION_SENT_AUDIT_PREFIX} as appointment.ics for booking revision 1.`,
    });
  });

  it("sends a cancellation ICS for a cancelled booking", async () => {
    const workspaceRepository = createWorkspaceRepository(new InMemoryWorkspaceDataSource());
    await workspaceRepository.bootstrap(
      "demo",
      await workspaceWithTelegramBooking("cancelled"),
    );
    const dataSource = new InMemoryCalendarDataSource();
    const sendDocument = vi.fn<ChannelAdapter["sendDocument"]>(async () => ({
      acceptedAt: "2026-07-13T12:01:00.000Z",
      providerMessageId: "9005",
    }));
    const service = createCalendarDispatchService({
      adapter: { sendDocument },
      config: {
        defaultDurationMinutes: 30,
        enabled: true,
        location: "KaunterAI Clinic",
        uidDomain: "calendar.kaunterai.test",
      },
      deliveryRepository: createCalendarDeliveryRepository(dataSource),
      now: () => new Date("2026-07-13T12:00:00.000Z"),
      workspaceId: "demo",
      workspaceRepository,
    });

    await service.send({
      conversationId: "telegram-conversation:-10042",
      expectedConversationRevision: 1,
    });

    const content = new TextDecoder().decode(sendDocument.mock.calls[0]?.[1].bytes);
    expect(content).toContain("METHOD:CANCEL");
    expect(content).toContain("STATUS:CANCELLED");
    expect(dataSource.records[0]).toMatchObject({ kind: "cancel", calendarSequence: 1 });
  });

  it("does not attach a calendar trace to a conversation changed after provider acceptance", async () => {
    const workspaceRepository = createWorkspaceRepository(new InMemoryWorkspaceDataSource());
    await workspaceRepository.bootstrap("demo", await workspaceWithTelegramBooking());
    const sendDocument = vi.fn<ChannelAdapter["sendDocument"]>(async () => {
      const workspace = await workspaceRepository.load("demo");
      if (!workspace) throw new Error("Workspace missing");
      const changed = structuredClone(workspace.state);
      const index = changed.conversations.findIndex(
        (candidate) => candidate.id === "telegram-conversation:-10042",
      );
      const conversation = changed.conversations[index];
      if (!conversation) throw new Error("Conversation missing");
      changed.conversations[index] = {
        ...conversation,
        revision: conversation.revision + 1,
        messages: [
          ...conversation.messages,
          {
            id: "new-patient-message",
            role: "patient",
            text: "Actually, please use a later time.",
            sentAt: "2026-07-13T12:01:00.000Z",
          },
        ],
      };
      await workspaceRepository.save("demo", workspace.revision, changed);
      return { acceptedAt: "2026-07-13T12:01:00.000Z", providerMessageId: "9004" };
    });
    const service = createCalendarDispatchService({
      adapter: { sendDocument },
      config: {
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

    await expect(
      service.send({
        conversationId: "telegram-conversation:-10042",
        expectedConversationRevision: 1,
      }),
    ).rejects.toMatchObject({ code: "revision_conflict" });

    const saved = await workspaceRepository.load("demo");
    const conversation = saved?.state.conversations.find(
      (candidate) => candidate.id === "telegram-conversation:-10042",
    );
    expect(sendDocument).toHaveBeenCalledTimes(1);
    expect(conversation?.messages.some((message) =>
      message.text.startsWith(CALENDAR_INVITATION_SENT_AUDIT_PREFIX),
    )).toBe(false);
  });

  it("fails closed after a provider timeout instead of attempting a resend", async () => {
    const workspaceRepository = createWorkspaceRepository(new InMemoryWorkspaceDataSource());
    await workspaceRepository.bootstrap("demo", await workspaceWithTelegramBooking());
    const sendDocument = vi.fn<ChannelAdapter["sendDocument"]>(async () => {
      throw new TelegramAdapterError("provider_timeout", "Telegram timed out");
    });
    const service = createCalendarDispatchService({
      adapter: { sendDocument },
      config: {
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
