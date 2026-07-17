import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createCanonicalServerState,
  mergeTelegramInboundText,
} from "../../src/domain";
import { encryptGoogleCalendarToken } from "../../server/google-calendar-config";
import {
  createGoogleCalendarConnectionRepository,
  createGoogleCalendarEventRepository,
  type GoogleCalendarConnection,
  type GoogleCalendarEventRecord,
} from "../../server/google-calendar-repository";
import { createGoogleCalendarService } from "../../server/google-calendar-service";
import { createOutboxRepository, type OutboxDataSource } from "../../server/outbox-repository";
import { createWorkspaceRepository } from "../../server/workspace-repository";
import { InMemoryWorkspaceDataSource } from "./fixtures/workspace-data-source";

async function configuredService(fetcher: typeof fetch) {
  const inbound = mergeTelegramInboundText(await createCanonicalServerState(), {
    channel: "telegram",
    externalEventId: "1001",
    externalConversationId: "-10042",
    externalMessageId: "88",
    sender: { externalId: "42", displayName: "Aina" },
    message: { kind: "text", language: "en", text: "Please book." },
    receivedAt: "2026-07-17T01:00:00.000Z",
  });
  if (!inbound.ok) throw new Error(inbound.error);
  const workspaceRepository = createWorkspaceRepository(new InMemoryWorkspaceDataSource());
  const bootstrapped = await workspaceRepository.bootstrap("demo", inbound.state);
  const state = structuredClone(bootstrapped.state);
  const telegramIndex = state.conversations.findIndex((conversation) => conversation.source === "telegram");
  if (telegramIndex < 0) throw new Error("Telegram conversation missing");
  state.conversations[telegramIndex] = {
    ...state.conversations[telegramIndex]!,
    booking: {
      reason: "Routine checkup",
      revision: 1,
      slotIso: "2026-07-17T10:30:00+08:00",
      status: "approved",
    },
  };
  const seeded = await workspaceRepository.save("demo", bootstrapped.revision, state);
  if (!seeded.ok) throw new Error("Could not seed booking");

  let connection: GoogleCalendarConnection | null = null;
  const events: GoogleCalendarEventRecord[] = [];
  const key = randomBytes(32);
  const connectionRepository = createGoogleCalendarConnectionRepository({
    async read() {
      return connection ? structuredClone(connection) : null;
    },
    async upsert(record) {
      connection = structuredClone(record);
    },
  });
  const eventRepository = createGoogleCalendarEventRepository({
    async upsert(record) {
      const index = events.findIndex((event) => event.conversationId === record.conversationId);
      if (index >= 0) events[index] = structuredClone(record);
      else events.push(structuredClone(record));
    },
    async listByWorkspace(workspaceId) {
      return events.filter((event) => event.workspaceId === workspaceId);
    },
    async deleteMapping(workspaceId, conversationId) {
      const index = events.findIndex(
        (event) =>
          event.workspaceId === workspaceId &&
          event.conversationId === conversationId,
      );
      if (index >= 0) events.splice(index, 1);
    },
  });
  const outbox: OutboxDataSource = {
    async claim() { return []; },
    async complete() {},
    async enqueue() {},
    async retry() {},
  };
  await connectionRepository.save({
    workspaceId: "demo",
    calendarId: "primary",
    refreshTokenCiphertext: encryptGoogleCalendarToken("refresh-token", key),
    grantedScope: "calendar",
    status: "connected",
    lastError: null,
  });
  return {
    events,
    service: createGoogleCalendarService({
      config: {
        enabled: true,
        adminToken: "a".repeat(24),
        calendarId: "primary",
        clientId: "client-id",
        clientSecret: "client-secret",
        defaultDurationMinutes: 30,
        location: "KaunterAI Clinic",
        redirectUri: "https://example.com/callback",
        timeZone: "Asia/Kuala_Lumpur",
        tokenEncryptionKey: key,
      },
      connectionRepository,
      eventRepository,
      fetcher,
      now: () => Date.parse("2026-07-17T01:00:00.000Z"),
      outboxRepository: createOutboxRepository(outbox),
      workspaceId: "demo",
      workspaceRepository,
    }),
    workspaceRepository,
  };
}

describe("Google Calendar service", () => {
  it("uses FreeBusy to remove occupied demo slots", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com")) {
        return Response.json({ access_token: "access", token_type: "Bearer" });
      }
      return Response.json({
        calendars: {
          primary: {
            busy: [{ start: "2026-07-17T02:30:00.000Z", end: "2026-07-17T03:00:00.000Z" }],
          },
        },
      });
    });
    const { service } = await configuredService(fetcher);
    const result = await service.filterAvailableSlots({
      slots: [
        { slotIso: "2026-07-17T10:30:00+08:00" },
        { slotIso: "2026-07-17T14:00:00+08:00" },
      ],
    });
    expect(result).toEqual({
      source: "google",
      slots: [{ slotIso: "2026-07-17T14:00:00+08:00" }],
    });
  });

  it("upserts the appointment and deletes it after a cancellation", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com")) {
        return Response.json({ access_token: "access", token_type: "Bearer" });
      }
      if (init?.method === "PUT") return new Response(null, { status: 404 });
      if (init?.method === "POST") return Response.json({ id: "kau12345", etag: "etag-1" });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      throw new Error(`Unexpected Google request: ${url}`);
    });
    const { events, service, workspaceRepository } = await configuredService(fetcher);
    await service.syncBooking({
      bookingRevision: 1,
      conversationId: "telegram-conversation:-10042",
    });
    expect(events[0]).toMatchObject({ bookingRevision: 1, status: "active", eventId: "kau12345" });
    const createCall = fetcher.mock.calls.find(
      ([input, init]) =>
        String(input).includes("/events") && init?.method === "POST",
    );
    const event = JSON.parse(String(createCall?.[1]?.body)) as {
      end: { dateTime: string; timeZone: string };
      location: string;
      start: { dateTime: string; timeZone: string };
      summary: string;
    };
    expect(event).toMatchObject({
      location: "KaunterAI Clinic",
      summary: "Appointment",
      start: { timeZone: "Asia/Kuala_Lumpur" },
      end: { timeZone: "Asia/Kuala_Lumpur" },
    });
    expect(
      new Date(event.end.dateTime).valueOf() - new Date(event.start.dateTime).valueOf(),
    ).toBe(30 * 60_000);

    const workspace = await workspaceRepository.load("demo");
    if (!workspace) throw new Error("Workspace missing");
    const state = structuredClone(workspace.state);
    state.conversations[0]!.booking = {
      ...state.conversations[0]!.booking!,
      revision: 2,
      status: "cancelled",
    };
    const saved = await workspaceRepository.save("demo", workspace.revision, state);
    if (!saved.ok) throw new Error("Could not cancel booking");
    await service.syncBooking({
      bookingRevision: 2,
      conversationId: "telegram-conversation:-10042",
    });
    expect(events[0]).toMatchObject({ bookingRevision: 2, status: "cancelled" });
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/events/"), expect.objectContaining({ method: "DELETE" }));
  });

  it("does not let a stale outbox job overwrite a newer booking revision", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("A stale job must not call Google Calendar.");
    });
    const { events, service, workspaceRepository } = await configuredService(fetcher);
    const workspace = await workspaceRepository.load("demo");
    if (!workspace) throw new Error("Workspace missing");
    const state = structuredClone(workspace.state);
    state.conversations[0]!.booking = {
      ...state.conversations[0]!.booking!,
      revision: 2,
      status: "cancelled",
    };
    const saved = await workspaceRepository.save("demo", workspace.revision, state);
    if (!saved.ok) throw new Error("Could not advance booking revision");

    await service.syncBooking({
      bookingRevision: 1,
      conversationId: "telegram-conversation:-10042",
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("never syncs a synthetic fixture booking to the admin calendar", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("Synthetic fixture bookings must stay local.");
    });
    const { events, service, workspaceRepository } = await configuredService(fetcher);
    const workspace = await workspaceRepository.load("demo");
    if (!workspace) throw new Error("Workspace missing");
    const state = structuredClone(workspace.state);
    const syntheticIndex = state.conversations.findIndex((conversation) => conversation.source === "synthetic");
    if (syntheticIndex < 0) throw new Error("Synthetic conversation missing");
    const synthetic = state.conversations[syntheticIndex]!;
    state.conversations[syntheticIndex] = {
      ...synthetic,
      source: "synthetic",
      booking: {
        reason: "Fixture appointment",
        revision: 1,
        slotIso: "2026-07-17T14:00:00+08:00",
        status: "approved",
      },
    };
    const saved = await workspaceRepository.save("demo", workspace.revision, state);
    if (!saved.ok) throw new Error("Could not convert fixture conversation");

    await service.syncBooking({
      bookingRevision: 1,
      conversationId: synthetic.id,
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});
