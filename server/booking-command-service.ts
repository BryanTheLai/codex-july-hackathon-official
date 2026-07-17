import { createHash } from "node:crypto";

import {
  bookingCommandRequestSchema,
  bookingCommandResultSchema,
  type BookingCommandRequest,
  type BookingCommandResult,
} from "../src/contracts/api";
import type { CalendarAvailability } from "./google-calendar-service";
import type { OutboxRepository } from "./outbox-repository";
import type { WorkspaceRepository } from "./workspace-repository";

export class BookingCommandServiceError extends Error {
  readonly code: "invalid_request" | "not_found" | "revision_conflict";

  constructor(code: BookingCommandServiceError["code"], message: string) {
    super(message);
    this.name = "BookingCommandServiceError";
    this.code = code;
  }
}

export interface BookingCommandService {
  execute(input: BookingCommandRequest): Promise<BookingCommandResult>;
}

function auditMessageId(input: BookingCommandRequest): string {
  return `admin-booking-${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32)}`;
}

export function createBookingCommandService(input: {
  calendarAvailability?: CalendarAvailability;
  now?: () => string;
  outboxRepository?: Pick<OutboxRepository, "enqueue">;
  workspaceId: string;
  workspaceRepository: WorkspaceRepository;
}): BookingCommandService {
  const now = input.now ?? (() => new Date().toISOString());
  const enqueueCalendarSync = async (
    conversationId: string,
    bookingRevision: number,
  ) => {
    await input.outboxRepository?.enqueue({
      workspaceId: input.workspaceId,
      kind: "google_calendar_sync",
      dedupeKey: `google:${conversationId}:${bookingRevision}`,
      payload: { conversationId, bookingRevision },
    });
  };
  return {
    async execute(raw) {
      const request = bookingCommandRequestSchema.parse(raw);
      const workspace = await input.workspaceRepository.load(input.workspaceId);
      if (!workspace) throw new BookingCommandServiceError("not_found", "Workspace not found.");
      const index = workspace.state.conversations.findIndex(
        (conversation) => conversation.id === request.conversationId,
      );
      if (index < 0) throw new BookingCommandServiceError("not_found", "Booking conversation not found.");
      const conversation = workspace.state.conversations[index]!;
      if (conversation.source !== "telegram") {
        throw new BookingCommandServiceError("invalid_request", "Only persisted Telegram bookings can be synchronized.");
      }
      const messageId = auditMessageId(request);
      if (
        conversation.messages.some((message) => message.id === messageId) &&
        conversation.booking
      ) {
        await enqueueCalendarSync(conversation.id, conversation.booking.revision);
        return bookingCommandResultSchema.parse({ workspace, booking: conversation.booking });
      }
      if (conversation.revision !== request.expectedConversationRevision) {
        throw new BookingCommandServiceError(
          "revision_conflict",
          "Booking changed before this update. Refresh and retry.",
        );
      }
      if (
        request.action !== "create" &&
        (!conversation.booking ||
          conversation.booking.revision !== request.expectedBookingRevision)
      ) {
        throw new BookingCommandServiceError(
          "revision_conflict",
          "Booking changed before this update. Refresh and retry.",
        );
      }
      if (
        request.action === "create" &&
        conversation.booking &&
        conversation.booking.status !== "cancelled" &&
        conversation.booking.status !== "rejected"
      ) {
        throw new BookingCommandServiceError(
          "invalid_request",
          "This conversation already has an active booking. Edit that booking instead.",
        );
      }
      if (
        request.action !== "create" &&
        conversation.booking?.status !== "approved"
      ) {
        throw new BookingCommandServiceError(
          "invalid_request",
          "Only a confirmed booking can be updated or cancelled.",
        );
      }
      if (request.action !== "cancel" && input.calendarAvailability) {
        const availability = await input.calendarAvailability.filterAvailableSlots({
          slots: [{ slotIso: request.slotIso }],
        });
        if (availability.slots.length === 0) {
          throw new BookingCommandServiceError(
            "invalid_request",
            "That service slot is no longer available. Choose another time.",
          );
        }
      }
      const booking = request.action === "create"
        ? {
            reason: request.reason,
            slotIso: request.slotIso,
            status: "approved" as const,
            revision: (conversation.booking?.revision ?? 0) + 1,
          }
        : request.action === "cancel"
          ? {
              ...conversation.booking!,
              status: "cancelled" as const,
              revision: conversation.booking!.revision + 1,
            }
          : {
              ...conversation.booking!,
              reason: request.reason,
              slotIso: request.slotIso,
              revision: conversation.booking!.revision + 1,
            };
      const actionText = request.action === "create"
        ? "Admin created the service visit. Google Calendar synchronization runs when connected."
        : request.action === "cancel"
          ? "Admin cancelled the service visit. Google Calendar synchronization runs when connected."
          : "Admin updated the service visit. Google Calendar synchronization runs when connected.";
      const state = structuredClone(workspace.state);
      state.conversations[index] = {
        ...conversation,
        booking,
        revision: conversation.revision + 1,
        messages: [
          ...conversation.messages,
          { id: messageId, role: "system", text: actionText, sentAt: now() },
        ],
      };
      const saved = await input.workspaceRepository.save(
        input.workspaceId,
        workspace.revision,
        state,
      );
      if (!saved.ok) {
        throw new BookingCommandServiceError(
          "revision_conflict",
          "Booking changed before this update. Refresh and retry.",
        );
      }
      await enqueueCalendarSync(conversation.id, booking.revision);
      return bookingCommandResultSchema.parse({ workspace: saved.workspace, booking });
    },
  };
}
