import { createHash, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { BookingPayload } from "../src/contracts/app-state";
import type { OutboxRepository } from "./outbox-repository";
import type {
  GoogleCalendarConnectionRepository,
  GoogleCalendarEventRepository,
} from "./google-calendar-repository";
import {
  createGoogleOAuthState,
  decryptGoogleCalendarToken,
  encryptGoogleCalendarToken,
  type GoogleCalendarConfig,
  verifyGoogleOAuthState,
} from "./google-calendar-config";
import type { WorkspaceRepository } from "./workspace-repository";

const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_BASE_URL = "https://www.googleapis.com/calendar/v3";
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events.owned",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
];

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type CalendarAvailabilityResult = {
  source: "demo" | "google";
  slots: Array<{ slotIso: string }>;
};

export type CalendarAvailability = {
  filterAvailableSlots(input: {
    slots: Array<{ slotIso: string }>;
  }): Promise<CalendarAvailabilityResult>;
};

export type GoogleCalendarStatus = {
  calendarId: string | null;
  configured: boolean;
  mode: "demo" | "google";
  status: "disabled" | "disconnected" | "connected" | "error" | "revoked";
};

export interface GoogleCalendarService extends CalendarAvailability {
  authorizationUrl(adminToken: string): string;
  completeAuthorization(input: { code: string; state: string }): Promise<void>;
  status(): Promise<GoogleCalendarStatus>;
  syncBooking(input: {
    bookingRevision: number;
    conversationId: string;
  }): Promise<void>;
}

export class GoogleCalendarError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "GoogleCalendarError";
    this.retryable = retryable;
  }
}

type GoogleCalendarServiceOptions = {
  config: GoogleCalendarConfig;
  connectionRepository: GoogleCalendarConnectionRepository;
  eventRepository: GoogleCalendarEventRepository;
  fetcher?: Fetcher;
  now?: () => number;
  outboxRepository: OutboxRepository;
  workspaceId: string;
  workspaceRepository: WorkspaceRepository;
};

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().min(1).optional(),
  token_type: z.string().min(1),
}).passthrough();

const freeBusyResponseSchema = z.object({
  calendars: z.record(
    z.string(),
    z.object({
      busy: z.array(z.object({ start: z.string(), end: z.string() })).default([]),
      errors: z.array(z.unknown()).optional(),
    }).passthrough(),
  ),
}).passthrough();

const eventResponseSchema = z.object({
  etag: z.string().optional(),
  id: z.string().min(5),
}).passthrough();

function secretsMatch(received: string, expected: string): boolean {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function eventId(conversationId: string): string {
  // Google accepts only base32hex characters; the hash's hex alphabet is a subset.
  return `kau${createHash("sha256").update(conversationId).digest("hex").slice(0, 48)}`;
}

function addMinutes(slotIso: string, durationMinutes: number): string {
  const value = new Date(slotIso);
  if (Number.isNaN(value.valueOf())) throw new GoogleCalendarError("Booking time is invalid.", false);
  return new Date(value.valueOf() + durationMinutes * 60_000).toISOString();
}

function busyOverlaps(
  slotIso: string,
  durationMinutes: number,
  busy: Array<{ start: string; end: string }>,
): boolean {
  const start = new Date(slotIso).valueOf();
  const end = start + durationMinutes * 60_000;
  return busy.some((interval) => {
    const busyStart = new Date(interval.start).valueOf();
    const busyEnd = new Date(interval.end).valueOf();
    return Number.isFinite(busyStart) && Number.isFinite(busyEnd) && start < busyEnd && end > busyStart;
  });
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function googleFailure(body: unknown, fallback: string, retryable: boolean): GoogleCalendarError {
  const parsed = z.object({
    error: z.object({
      message: z.string().optional(),
      status: z.string().optional(),
    }).optional(),
  }).passthrough().safeParse(body);
  const message = parsed.success
    ? (parsed.data.error?.message || parsed.data.error?.status || fallback)
    : fallback;
  return new GoogleCalendarError(message.slice(0, 500), retryable);
}

export function createGoogleCalendarService({
  config,
  connectionRepository,
  eventRepository,
  fetcher = fetch,
  now = Date.now,
  outboxRepository,
  workspaceId,
  workspaceRepository,
}: GoogleCalendarServiceOptions): GoogleCalendarService {
  const accessToken = async (): Promise<{ token: string; connected: true } | { connected: false }> => {
    if (!config.enabled) return { connected: false };
    const connection = await connectionRepository.get(workspaceId);
    if (!connection || connection.status !== "connected") return { connected: false };
    const refreshToken = decryptGoogleCalendarToken(
      connection.refreshTokenCiphertext,
      config.tokenEncryptionKey,
    );
    const response = await fetcher(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    const body = await readJson(response);
    if (!response.ok) {
      const invalidGrant = z.object({ error: z.string().optional() }).passthrough()
        .safeParse(body).data?.error === "invalid_grant";
      if (invalidGrant) {
        await connectionRepository.save({
          ...connection,
          status: "revoked",
          lastError: "Google refresh token was revoked. Reconnect Google Calendar.",
        });
        throw new GoogleCalendarError("Google Calendar needs to be reconnected.", false);
      }
      throw googleFailure(body, "Google Calendar token refresh failed.", response.status >= 500 || response.status === 429);
    }
    const parsed = tokenResponseSchema.safeParse(body);
    if (!parsed.success) throw new GoogleCalendarError("Google Calendar returned an invalid token response.", true);
    return { connected: true, token: parsed.data.access_token };
  };

  const calendarRequest = async (
    token: string,
    path: string,
    init: RequestInit,
  ): Promise<{ body: unknown; response: Response }> => {
    const response = await fetcher(`${GOOGLE_CALENDAR_BASE_URL}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
    });
    return { response, body: await readJson(response) };
  };

  const upsertGoogleEvent = async (
    token: string,
    conversation: { id: string; patient: { name: string }; booking: BookingPayload },
  ): Promise<{ id: string; etag: string | null }> => {
    if (!config.enabled) throw new GoogleCalendarError("Google Calendar is disabled.", false);
    const id = eventId(conversation.id);
    const event = {
      id,
      summary: "KaunterAI appointment",
      description: `Patient: ${conversation.patient.name}\nReason: ${conversation.booking.reason}\nKaunter conversation: ${conversation.id}`,
      start: { dateTime: conversation.booking.slotIso, timeZone: config.timeZone },
      end: {
        dateTime: addMinutes(conversation.booking.slotIso, config.defaultDurationMinutes),
        timeZone: config.timeZone,
      },
      extendedProperties: {
        private: {
          kaunterBookingRevision: String(conversation.booking.revision),
          kaunterConversationId: conversation.id,
        },
      },
    };
    const path = `/calendars/${encodeURIComponent(config.calendarId)}/events/${encodeURIComponent(id)}?sendUpdates=none`;
    let result = await calendarRequest(token, path, {
      method: "PUT",
      body: JSON.stringify(event),
    });
    if (result.response.status === 404) {
      result = await calendarRequest(
        token,
        `/calendars/${encodeURIComponent(config.calendarId)}/events?sendUpdates=none`,
        { method: "POST", body: JSON.stringify(event) },
      );
    }
    if (result.response.status === 409) {
      result = await calendarRequest(token, path, {
        method: "PUT",
        body: JSON.stringify(event),
      });
    }
    if (!result.response.ok) {
      throw googleFailure(
        result.body,
        "Google Calendar event sync failed.",
        result.response.status >= 500 || result.response.status === 429,
      );
    }
    const parsed = eventResponseSchema.safeParse(result.body);
    if (!parsed.success) throw new GoogleCalendarError("Google Calendar returned an invalid event.", true);
    return { id: parsed.data.id, etag: parsed.data.etag ?? null };
  };

  return {
    async filterAvailableSlots({ slots }) {
      if (slots.length === 0) return { source: "demo", slots };
      const credential = await accessToken();
      if (!credential.connected || !config.enabled) return { source: "demo", slots };
      const start = slots.reduce((earliest, slot) =>
        new Date(slot.slotIso) < new Date(earliest) ? slot.slotIso : earliest,
      slots[0]!.slotIso);
      const end = slots.reduce((latest, slot) =>
        new Date(slot.slotIso) > new Date(latest) ? slot.slotIso : latest,
      slots[0]!.slotIso);
      const result = await calendarRequest(credential.token, "/freeBusy", {
        method: "POST",
        body: JSON.stringify({
          timeMin: start,
          timeMax: addMinutes(end, config.defaultDurationMinutes),
          timeZone: config.timeZone,
          items: [{ id: config.calendarId }],
        }),
      });
      if (!result.response.ok) {
        throw googleFailure(
          result.body,
          "Google Calendar availability lookup failed.",
          result.response.status >= 500 || result.response.status === 429,
        );
      }
      const parsed = freeBusyResponseSchema.safeParse(result.body);
      if (!parsed.success) throw new GoogleCalendarError("Google Calendar returned invalid availability.", true);
      const calendar = parsed.data.calendars[config.calendarId];
      if (!calendar || calendar.errors?.length) {
        throw new GoogleCalendarError("Google Calendar availability is unavailable.", true);
      }
      return {
        source: "google",
        slots: slots.filter(
          (slot) => !busyOverlaps(slot.slotIso, config.defaultDurationMinutes, calendar.busy),
        ),
      };
    },

    authorizationUrl(adminToken) {
      if (!config.enabled) throw new GoogleCalendarError("Google Calendar is not configured.", false);
      if (!secretsMatch(adminToken, config.adminToken)) {
        throw new GoogleCalendarError("Calendar admin token is invalid.", false);
      }
      const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
      url.search = new URLSearchParams({
        access_type: "offline",
        client_id: config.clientId,
        include_granted_scopes: "true",
        prompt: "consent",
        redirect_uri: config.redirectUri,
        response_type: "code",
        scope: GOOGLE_SCOPES.join(" "),
        state: createGoogleOAuthState(workspaceId, config.tokenEncryptionKey, now),
      }).toString();
      return url.toString();
    },

    async completeAuthorization({ code, state }) {
      if (!config.enabled) throw new GoogleCalendarError("Google Calendar is not configured.", false);
      const verified = verifyGoogleOAuthState(state, config.tokenEncryptionKey, now);
      if (verified.workspaceId !== workspaceId) throw new GoogleCalendarError("Google authorization workspace is invalid.", false);
      const response = await fetcher(GOOGLE_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: config.redirectUri,
        }),
      });
      const body = await readJson(response);
      if (!response.ok) throw googleFailure(body, "Google Calendar authorization failed.", false);
      const token = tokenResponseSchema.safeParse(body);
      if (!token.success || !token.data.refresh_token) {
        throw new GoogleCalendarError("Google did not return an offline refresh token. Reconnect and approve consent.", false);
      }
      await connectionRepository.save({
        workspaceId,
        calendarId: config.calendarId,
        refreshTokenCiphertext: encryptGoogleCalendarToken(token.data.refresh_token, config.tokenEncryptionKey),
        grantedScope: token.data.scope ?? GOOGLE_SCOPES.join(" "),
        status: "connected",
        lastError: null,
      });
      const workspace = await workspaceRepository.load(workspaceId);
      for (const conversation of workspace?.state.conversations ?? []) {
        if (conversation.source !== "telegram" || !conversation.booking) continue;
        await outboxRepository.enqueue({
          workspaceId,
          kind: "google_calendar_sync",
          dedupeKey: `google:${conversation.id}:${conversation.booking.revision}`,
          payload: {
            bookingRevision: conversation.booking.revision,
            conversationId: conversation.id,
          },
        });
      }
    },

    async status() {
      if (!config.enabled) {
        return { configured: false, calendarId: null, mode: "demo", status: "disabled" };
      }
      const connection = await connectionRepository.get(workspaceId);
      if (!connection) {
        return { configured: true, calendarId: config.calendarId, mode: "demo", status: "disconnected" };
      }
      return {
        configured: true,
        calendarId: connection.calendarId,
        mode: connection.status === "connected" ? "google" : "demo",
        status: connection.status,
      };
    },

    async syncBooking({ bookingRevision, conversationId }) {
      const workspace = await workspaceRepository.load(workspaceId);
      const conversation = workspace?.state.conversations.find((candidate) => candidate.id === conversationId);
      if (
        conversation?.source !== "telegram"
        || !conversation.booking
        || conversation.booking.revision !== bookingRevision
      ) return;
      const credential = await accessToken();
      if (!credential.connected || !config.enabled) return;
      const id = eventId(conversation.id);
      if (conversation.booking.status === "approved") {
        const remote = await upsertGoogleEvent(credential.token, {
          id: conversation.id,
          patient: { name: conversation.patient.name },
          booking: conversation.booking,
        });
        await eventRepository.save({
          workspaceId,
          conversationId,
          eventId: remote.id,
          bookingRevision,
          status: "active",
          eventEtag: remote.etag,
        });
        return;
      }
      const result = await calendarRequest(
        credential.token,
        `/calendars/${encodeURIComponent(config.calendarId)}/events/${encodeURIComponent(id)}?sendUpdates=none`,
        { method: "DELETE" },
      );
      if (!result.response.ok && result.response.status !== 404) {
        throw googleFailure(
          result.body,
          "Google Calendar event cancellation failed.",
          result.response.status >= 500 || result.response.status === 429,
        );
      }
      await eventRepository.save({
        workspaceId,
        conversationId,
        eventId: id,
        bookingRevision,
        status: "cancelled",
        eventEtag: null,
      });
    },
  };
}
