import { createHash } from "node:crypto";

import { z } from "zod";

import {
  outboundReconcileRequestSchema,
  outboundReconcileResultSchema,
  outboundSendRequestSchema,
  outboundSendResultSchema,
  requestIdSchema,
  type ApiErrorCode,
  type OutboundReconcileRequest,
  type OutboundReconcileResult,
  type OutboundSendRequest,
  type OutboundSendResult,
} from "../src/contracts/api";
import {
  deliveryReceiptSchema,
  type ChannelAdapter,
  type DeliveryReceipt,
} from "../src/contracts/channel";
import { linkAcceptedTelegramOutboundText } from "../src/domain";
import { TelegramAdapterError } from "./telegram-adapter";
import type {
  TelegramDeliveryRecord,
  TelegramDeliveryRepository,
} from "./telegram-repository";
import type { WorkspaceRepository } from "./workspace-repository";

export class TelegramOutboundError extends Error {
  readonly code: Extract<
    ApiErrorCode,
    | "invalid_request"
    | "not_found"
    | "revision_conflict"
    | "duplicate"
    | "provider_failed"
    | "feature_disabled"
  >;
  readonly retryable: boolean;

  constructor(
    code: TelegramOutboundError["code"],
    message: string,
    retryable: boolean,
  ) {
    super(message);
    this.name = "TelegramOutboundError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface TelegramOutboundService {
  send(request: OutboundSendRequest): Promise<OutboundSendResult>;
  reconcile(
    deliveryId: string,
    request: OutboundReconcileRequest,
  ): Promise<OutboundReconcileResult>;
}

type TelegramOutboundServiceOptions = {
  adapter: Pick<ChannelAdapter, "sendText">;
  deliveryRepository: TelegramDeliveryRepository;
  liveEnabled: boolean;
  workspaceId: string;
  workspaceRepository: WorkspaceRepository;
  maxCasAttempts?: number;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function messageId(requestId: string): string {
  return `telegram-delivery:${requestId}:text`;
}

function receiptFromDelivery(
  delivery: TelegramDeliveryRecord,
): DeliveryReceipt {
  return deliveryReceiptSchema.parse({
    providerMessageId: delivery.providerMessageId,
    acceptedAt: delivery.providerAcceptedAt,
  });
}

function sentResult(delivery: TelegramDeliveryRecord): OutboundSendResult {
  return outboundSendResultSchema.parse({
    deliveryIds: [delivery.requestId],
    status: "sent",
    text: receiptFromDelivery(delivery),
  });
}

function assertDeliveryIdentity(
  delivery: TelegramDeliveryRecord,
  request: OutboundSendRequest,
  workspaceId: string,
): void {
  if (
    delivery.workspaceId !== workspaceId ||
    delivery.conversationId !== request.conversationId ||
    delivery.targetLanguage !== request.targetLanguage ||
    delivery.approvedText !== request.approvedPatientText ||
    delivery.approvedTextHash !== sha256(request.approvedPatientText)
  ) {
    throw new TelegramOutboundError(
      "duplicate",
      "Request ID already belongs to different approved text",
      false,
    );
  }
}

function providerFailureCode(error: unknown): Extract<
  ApiErrorCode,
  "provider_timeout" | "provider_failed"
> {
  return error instanceof TelegramAdapterError
    ? error.code
    : "provider_failed";
}

export function createTelegramOutboundService({
  adapter,
  deliveryRepository,
  liveEnabled,
  workspaceId,
  workspaceRepository,
  maxCasAttempts = 3,
}: TelegramOutboundServiceOptions): TelegramOutboundService {
  const attempts = z.number().int().positive().max(10).parse(maxCasAttempts);

  const syncAcceptedDelivery = async (
    delivery: TelegramDeliveryRecord,
  ): Promise<number | null> => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const workspace = await workspaceRepository.load(workspaceId);
      if (!workspace) {
        throw new TelegramOutboundError(
          "not_found",
          "Workspace not found",
          false,
        );
      }
      const conversation = workspace.state.conversations.find(
        (item) => item.id === delivery.conversationId,
      );
      if (!conversation) {
        throw new TelegramOutboundError(
          "not_found",
          "Conversation not found",
          false,
        );
      }
      const linkedMessageId = messageId(delivery.requestId);
      if (
        conversation.messages.some(
          (message) => message.id === linkedMessageId,
        )
      ) {
        await deliveryRepository.markSynced(
          delivery.requestId,
          delivery.part,
        );
        return workspace.revision;
      }
      const mutation = linkAcceptedTelegramOutboundText(workspace.state, {
        conversationId: delivery.conversationId,
        messageId: linkedMessageId,
        text: delivery.approvedText,
        language: delivery.targetLanguage,
        sentAt: receiptFromDelivery(delivery).acceptedAt,
      });
      if (!mutation.ok) {
        throw new TelegramOutboundError(
          "invalid_request",
          mutation.error,
          false,
        );
      }
      const saved = await workspaceRepository.save(
        workspaceId,
        workspace.revision,
        mutation.state,
      );
      if (saved.ok) {
        await deliveryRepository.markSynced(
          delivery.requestId,
          delivery.part,
        );
        return saved.workspace.revision;
      }
    }
    return null;
  };

  return {
    async send(input) {
      const request = outboundSendRequestSchema.parse(input);
      if (!liveEnabled) {
        throw new TelegramOutboundError(
          "feature_disabled",
          "Live Telegram sending is disabled.",
          false,
        );
      }
      const workspace = await workspaceRepository.load(workspaceId);
      if (!workspace) {
        throw new TelegramOutboundError(
          "not_found",
          "Workspace not found",
          false,
        );
      }
      const conversation = workspace.state.conversations.find(
        (item) => item.id === request.conversationId,
      );
      if (!conversation) {
        throw new TelegramOutboundError(
          "not_found",
          "Conversation not found",
          false,
        );
      }

      let delivery = await deliveryRepository.read(request.requestId, "text");
      if (delivery) {
        assertDeliveryIdentity(delivery, request, workspaceId);
        if (delivery.status === "sent") {
          if (delivery.workspaceSyncStatus === "pending") {
            await syncAcceptedDelivery(delivery);
          }
          return sentResult(delivery);
        }
        if (delivery.status === "sending") {
          throw new TelegramOutboundError(
            "duplicate",
            "This Telegram text send is already in progress.",
            true,
          );
        }
      }

      if (
        conversation.channel !== "telegram" ||
        conversation.source !== "telegram" ||
        !conversation.externalConversationId
      ) {
        throw new TelegramOutboundError(
          "invalid_request",
          "Conversation does not have a Telegram delivery target.",
          false,
        );
      }
      if (conversation.workflowStatus === "resolved") {
        throw new TelegramOutboundError(
          "invalid_request",
          "Cannot send to a resolved conversation.",
          false,
        );
      }
      if (conversation.revision !== request.expectedConversationRevision) {
        throw new TelegramOutboundError(
          "revision_conflict",
          "Conversation changed before Telegram send.",
          true,
        );
      }

      if (!delivery) {
        const created = await deliveryRepository.createOrLoad({
          requestId: request.requestId,
          part: "text",
          workspaceId,
          conversationId: request.conversationId,
          targetLanguage: request.targetLanguage,
          approvedText: request.approvedPatientText,
          approvedTextHash: sha256(request.approvedPatientText),
        });
        delivery = created.record;
        assertDeliveryIdentity(delivery, request, workspaceId);
        if (!created.inserted && delivery.status === "sent") {
          return sentResult(delivery);
        }
      }

      const claimed = await deliveryRepository.claim(
        request.requestId,
        "text",
      );
      if (!claimed) {
        const current = await deliveryRepository.read(
          request.requestId,
          "text",
        );
        if (current?.status === "sent") {
          return sentResult(current);
        }
        throw new TelegramOutboundError(
          "duplicate",
          "This Telegram text send is already in progress.",
          true,
        );
      }

      let receipt: DeliveryReceipt;
      try {
        receipt = await adapter.sendText(
          conversation.externalConversationId,
          request.approvedPatientText,
          request.requestId,
        );
      } catch (error) {
        await deliveryRepository.markFailed(
          request.requestId,
          "text",
          providerFailureCode(error),
        );
        return outboundSendResultSchema.parse({
          deliveryIds: [request.requestId],
          status: "failed",
        });
      }

      const sent = await deliveryRepository.markSent(
        request.requestId,
        "text",
        receipt,
      );
      await syncAcceptedDelivery(sent);
      return sentResult(sent);
    },

    async reconcile(deliveryId, input) {
      const parsedRequestId = requestIdSchema.safeParse(deliveryId);
      if (!parsedRequestId.success) {
        throw new TelegramOutboundError(
          "invalid_request",
          "Telegram delivery ID is invalid.",
          false,
        );
      }
      const requestId = parsedRequestId.data;
      const request = outboundReconcileRequestSchema.parse(input);
      const delivery = await deliveryRepository.read(requestId, "text");
      if (!delivery) {
        throw new TelegramOutboundError(
          "not_found",
          "Telegram delivery not found.",
          false,
        );
      }
      if (delivery.status !== "sent") {
        throw new TelegramOutboundError(
          "invalid_request",
          "Telegram delivery was not accepted.",
          false,
        );
      }
      const workspace = await workspaceRepository.load(workspaceId);
      const conversation = workspace?.state.conversations.find(
        (item) => item.id === delivery.conversationId,
      );
      if (!workspace || !conversation) {
        throw new TelegramOutboundError(
          "not_found",
          "Conversation not found.",
          false,
        );
      }
      const alreadyLinked = conversation.messages.some(
        (message) => message.id === messageId(requestId),
      );
      if (
        !alreadyLinked &&
        conversation.revision !== request.expectedConversationRevision
      ) {
        throw new TelegramOutboundError(
          "revision_conflict",
          "Conversation changed before Telegram reconciliation.",
          true,
        );
      }
      const workspaceRevision = await syncAcceptedDelivery(delivery);
      if (workspaceRevision === null) {
        throw new TelegramOutboundError(
          "revision_conflict",
          "Workspace changed before Telegram reconciliation completed.",
          true,
        );
      }
      return outboundReconcileResultSchema.parse({
        deliveryId: delivery.requestId,
        workspaceSyncStatus: "synced",
        workspaceRevision,
      });
    },
  };
}
