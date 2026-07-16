import { createHash } from "node:crypto";

import { z } from "zod";

import { type ApiErrorCode } from "../src/contracts/api";
import { type ChannelAdapter } from "../src/contracts/channel";
import { createCalendarInvitation } from "./calendar-ics";
import type {
  CalendarDeliveryRecord,
  CalendarDeliveryRepository,
} from "./calendar-repository";
import { TelegramAdapterError } from "./telegram-adapter";
import type { WorkspaceRepository } from "./workspace-repository";

const requestSchema = z
  .object({
    conversationId: z.string().min(1).max(128),
    expectedConversationRevision: z.number().int().positive(),
  })
  .strict();

const configSchema = z
  .object({
    allowedChatIds: z.instanceof(Set<string>),
    defaultDurationMinutes: z.number().int().min(5).max(480),
    enabled: z.boolean(),
    location: z.string().trim().min(1).max(256).nullable(),
    uidDomain: z.string().trim().min(1).max(253).regex(/^[A-Za-z0-9.-]+$/),
  })
  .strict();

export type CalendarDispatchConfig = z.infer<typeof configSchema>;
export type CalendarDispatchRequest = z.infer<typeof requestSchema>;
export type CalendarDispatchResult = {
  requestId: string;
  status: "sent";
  providerMessageId: string;
  providerAcceptedAt: string;
};

export class CalendarDispatchError extends Error {
  constructor(
    readonly code: Extract<
      ApiErrorCode,
      | "feature_disabled"
      | "invalid_request"
      | "not_found"
      | "revision_conflict"
      | "duplicate"
      | "provider_timeout"
      | "provider_failed"
    >,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

type CalendarDispatchServiceOptions = {
  adapter: Pick<ChannelAdapter, "sendDocument">;
  config: CalendarDispatchConfig;
  deliveryRepository: CalendarDeliveryRepository;
  now?: () => Date;
  workspaceId: string;
  workspaceRepository: WorkspaceRepository;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function calendarUid(
  workspaceId: string,
  conversationId: string,
  uidDomain: string,
): string {
  return `booking-${sha256(`${workspaceId}\u0000${conversationId}`).slice(0, 32)}@${uidDomain}`;
}

function requestId(uid: string, sequence: number, kind: "publish" | "cancel"): string {
  return `calendar-${sha256(`${uid}\u0000${sequence}\u0000${kind}`).slice(0, 48)}`;
}

function accepted(record: CalendarDeliveryRecord): CalendarDispatchResult {
  if (
    record.status !== "sent" ||
    record.providerMessageId === null ||
    record.providerAcceptedAt === null
  ) {
    throw new CalendarDispatchError(
      "provider_failed",
      "Calendar delivery receipt is incomplete.",
      true,
    );
  }
  return {
    requestId: record.requestId,
    status: "sent",
    providerMessageId: record.providerMessageId,
    providerAcceptedAt: record.providerAcceptedAt,
  };
}

export function createCalendarDispatchService({
  adapter,
  config: unparsedConfig,
  deliveryRepository,
  now = () => new Date(),
  workspaceId,
  workspaceRepository,
}: CalendarDispatchServiceOptions) {
  const config = configSchema.parse(unparsedConfig);

  return {
    async send(unparsedRequest: CalendarDispatchRequest): Promise<CalendarDispatchResult> {
      const request = requestSchema.parse(unparsedRequest);
      if (!config.enabled) {
        throw new CalendarDispatchError(
          "feature_disabled",
          "Calendar delivery is disabled.",
          false,
        );
      }
      const workspace = await workspaceRepository.load(workspaceId);
      if (!workspace) {
        throw new CalendarDispatchError("not_found", "Workspace was not found.", false);
      }
      const conversation = workspace.state.conversations.find(
        (candidate) => candidate.id === request.conversationId,
      );
      if (!conversation) {
        throw new CalendarDispatchError("not_found", "Conversation was not found.", false);
      }
      if (conversation.revision !== request.expectedConversationRevision) {
        throw new CalendarDispatchError(
          "revision_conflict",
          "Conversation changed before calendar delivery.",
          true,
        );
      }
      if (
        conversation.channel !== "telegram" ||
        conversation.source !== "telegram" ||
        !conversation.externalConversationId
      ) {
        throw new CalendarDispatchError(
          "invalid_request",
          "Calendar delivery requires a Telegram conversation.",
          false,
        );
      }
      if (conversation.workflowStatus === "resolved") {
        throw new CalendarDispatchError(
          "invalid_request",
          "Cannot send a calendar file to a resolved conversation.",
          false,
        );
      }
      if (!config.allowedChatIds.has(conversation.externalConversationId)) {
        throw new CalendarDispatchError(
          "feature_disabled",
          "Calendar delivery is not enabled for this Telegram chat.",
          false,
        );
      }
      const booking = conversation.booking;
      if (!booking || booking.status !== "approved") {
        throw new CalendarDispatchError(
          "invalid_request",
          "Calendar delivery requires an approved booking.",
          false,
        );
      }
      const start = new Date(booking.slotIso);
      if (Number.isNaN(start.valueOf()) || start <= now()) {
        throw new CalendarDispatchError(
          "invalid_request",
          "Calendar delivery requires a future booking.",
          false,
        );
      }
      const end = new Date(start.valueOf() + config.defaultDurationMinutes * 60_000);
      const uid = calendarUid(workspaceId, conversation.id, config.uidDomain);
      const sequence = booking.revision - 1;
      const kind = "publish" as const;
      const content = createCalendarInvitation({
        endIso: end.toISOString(),
        kind,
        location: config.location,
        provider: booking.provider,
        sequence,
        startIso: start.toISOString(),
        uid,
      });
      const id = requestId(uid, sequence, kind);
      const delivery = await deliveryRepository.createOrLoad({
        requestId: id,
        workspaceId,
        conversationId: conversation.id,
        calendarUid: uid,
        calendarSequence: sequence,
        kind,
        contentHash: sha256(content),
      });
      if (delivery.record.status === "sent") return accepted(delivery.record);
      if (delivery.record.status === "sending" || delivery.record.status === "unknown") {
        throw new CalendarDispatchError(
          "duplicate",
          "Calendar delivery outcome is unknown. Verify with the patient before sending a replacement.",
          false,
        );
      }
      const claimed = await deliveryRepository.claim(id);
      if (!claimed) {
        throw new CalendarDispatchError(
          "duplicate",
          "Calendar delivery is already being sent. Do not resend.",
          true,
        );
      }
      try {
        const receipt = await adapter.sendDocument(
          conversation.externalConversationId,
          {
            bytes: new TextEncoder().encode(content),
            contentType: "text/calendar",
            filename: "appointment.ics",
          },
          id,
        );
        return accepted(await deliveryRepository.markSent(id, receipt));
      } catch (error) {
        const code = error instanceof TelegramAdapterError ? error.code : "provider_failed";
        if (code === "provider_timeout") {
          await deliveryRepository.markUnknown(id, code);
          throw new CalendarDispatchError(
            code,
            "Calendar delivery timed out and may have been sent. Do not retry automatically.",
            false,
          );
        }
        await deliveryRepository.markFailed(id, code);
        throw new CalendarDispatchError(
          code,
          "Telegram rejected the calendar delivery.",
          true,
        );
      }
    },
  };
}

export type CalendarDispatchService = ReturnType<typeof createCalendarDispatchService>;
