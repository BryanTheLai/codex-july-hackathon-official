import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { z } from "zod";

import {
  outboundReconcileRequestSchema,
  outboundReconcileResultSchema,
  outboundSendRequestSchema,
  outboundSendResultSchema,
  outboundVoicePrepareRequestSchema,
  outboundVoicePrepareResultSchema,
  outboundVoiceRecordingResultSchema,
  requestIdSchema,
  type ApiErrorCode,
  type OutboundReconcileRequest,
  type OutboundReconcileResult,
  type OutboundSendRequest,
  type OutboundSendResult,
  type OutboundVoicePrepareRequest,
  type OutboundVoicePrepareResult,
  type OutboundVoiceRecordingResult,
} from "../src/contracts/api";
import {
  deliveryReceiptSchema,
  type ChannelAdapter,
  type DeliveryReceipt,
  type TelegramVoiceSource,
} from "../src/contracts/channel";
import {
  linkAcceptedTelegramOutboundText,
  linkAcceptedTelegramOutboundVoice,
} from "../src/domain";
import { TelegramAdapterError } from "./telegram-adapter";
import type { TtsProvider } from "./openai-tts-provider";
import type {
  TelegramDeliveryRecord,
  TelegramDeliveryRepository,
} from "./telegram-repository";
import type { VoiceArtifactStore } from "./voice-artifact-store";
import { voiceArtifactObjectPath } from "./voice-artifact-store";
import type { VoiceConverter } from "./voice-converter";
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

type VoiceDependencies = {
  artifactStore: VoiceArtifactStore;
  converter: VoiceConverter;
  tts: TtsProvider;
};

function isOgg(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x4f &&
    bytes[1] === 0x67 &&
    bytes[2] === 0x67 &&
    bytes[3] === 0x53
  );
}

export interface TelegramOutboundService {
  attachRecordedVoice(
    requestId: string,
    recording: Uint8Array,
    signal?: AbortSignal,
  ): Promise<OutboundVoiceRecordingResult>;
  prepareVoice(
    request: OutboundVoicePrepareRequest,
    signal?: AbortSignal,
  ): Promise<OutboundVoicePrepareResult>;
  readVoiceAudio(requestId: string): Promise<Uint8Array>;
  send(request: OutboundSendRequest): Promise<OutboundSendResult>;
  reconcile(
    deliveryId: string,
    request: OutboundReconcileRequest,
  ): Promise<OutboundReconcileResult>;
}

type TelegramOutboundServiceOptions = {
  adapter: Pick<ChannelAdapter, "sendText" | "sendVoice">;
  deliveryRepository: TelegramDeliveryRepository;
  liveEnabled: boolean;
  workspaceId: string;
  workspaceRepository: WorkspaceRepository;
  voice?: VoiceDependencies;
  maxCasAttempts?: number;
};

type Target = {
  externalConversationId: string;
};

type PartAttempt =
  | { status: "sent"; part: "text" | "voice"; receipt: DeliveryReceipt }
  | { status: "failed"; part: "text" | "voice" };

function resultFromAttempts(
  requestId: string,
  attempted: PartAttempt[],
): OutboundSendResult {
  const sent = attempted.filter(
    (item): item is Extract<PartAttempt, { status: "sent" }> =>
      item.status === "sent",
  );
  const failed = attempted.filter(
    (item): item is Extract<PartAttempt, { status: "failed" }> =>
      item.status === "failed",
  );
  const text = sent.find((item) => item.part === "text");
  const voice = sent.find((item) => item.part === "voice");
  const result = {
    deliveryIds: [requestId],
    ...(text ? { text: text.receipt } : {}),
    ...(voice ? { voice: voice.receipt } : {}),
  };
  if (failed.length === 0) {
    return outboundSendResultSchema.parse({ ...result, status: "sent" });
  }
  if (sent.length > 0) {
    return outboundSendResultSchema.parse({
      ...result,
      status: "partial_failure",
      failedParts: failed.map((item) => item.part),
    });
  }
  return outboundSendResultSchema.parse({
    ...result,
    status: "failed",
    failedParts: failed.map((item) => item.part),
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function messageId(requestId: string): string {
  return `telegram-delivery:${requestId}:text`;
}

function voiceMessageId(requestId: string): string {
  return `telegram-delivery:${requestId}:voice`;
}

function receiptFromDelivery(
  delivery: TelegramDeliveryRecord,
): DeliveryReceipt {
  return deliveryReceiptSchema.parse({
    providerMessageId: delivery.providerMessageId,
    acceptedAt: delivery.providerAcceptedAt,
  });
}

function partsFor(mode: OutboundSendRequest["mode"]): Array<"text" | "voice"> {
  if (mode === "text") {
    return ["text"];
  }
  if (mode === "voice") {
    return ["voice"];
  }
  return ["text", "voice"];
}

function assertDeliveryIdentity(
  delivery: TelegramDeliveryRecord,
  request: {
    conversationId: string;
    targetLanguage: string;
    approvedPatientText: string;
  },
  workspaceId: string,
  voiceSource?: TelegramVoiceSource,
): void {
  if (
    delivery.workspaceId !== workspaceId ||
    delivery.conversationId !== request.conversationId ||
    delivery.targetLanguage !== request.targetLanguage ||
    delivery.approvedText !== request.approvedPatientText ||
    delivery.approvedTextHash !== sha256(request.approvedPatientText) ||
    (delivery.part === "voice" &&
      voiceSource !== undefined &&
      delivery.voiceSource !== voiceSource)
  ) {
    throw new TelegramOutboundError(
      "duplicate",
      "Request ID already belongs to different approved delivery content.",
      false,
    );
  }
}

function providerFailureCode(error: unknown): Extract<
  ApiErrorCode,
  "provider_timeout" | "provider_failed"
> {
  return error instanceof TelegramAdapterError ? error.code : "provider_failed";
}

function requireVoice(
  voice: VoiceDependencies | undefined,
): VoiceDependencies {
  if (!voice) {
    throw new TelegramOutboundError(
      "feature_disabled",
      "Telegram voice delivery is not configured.",
      false,
    );
  }
  return voice;
}

export function createTelegramOutboundService({
  adapter,
  deliveryRepository,
  liveEnabled,
  workspaceId,
  workspaceRepository,
  voice,
  maxCasAttempts = 3,
}: TelegramOutboundServiceOptions): TelegramOutboundService {
  const attempts = z.number().int().positive().max(10).parse(maxCasAttempts);

  const loadTarget = async (
    request: {
      conversationId: string;
      expectedConversationRevision: number;
    },
    allowStaleContinuation = false,
  ): Promise<Target> => {
    const workspace = await workspaceRepository.load(workspaceId);
    if (!workspace) {
      throw new TelegramOutboundError("not_found", "Workspace not found", false);
    }
    const conversation = workspace.state.conversations.find(
      (item) => item.id === request.conversationId,
    );
    if (!conversation) {
      throw new TelegramOutboundError("not_found", "Conversation not found", false);
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
    if (
      !allowStaleContinuation &&
      conversation.revision !== request.expectedConversationRevision
    ) {
      throw new TelegramOutboundError(
        "revision_conflict",
        "Conversation changed before Telegram delivery.",
        true,
      );
    }
    return { externalConversationId: conversation.externalConversationId };
  };

  const ensureDelivery = async (
    request: {
      requestId: string;
      conversationId: string;
      targetLanguage: string;
      approvedPatientText: string;
    },
    part: "text" | "voice",
    voiceSource?: TelegramVoiceSource,
  ): Promise<TelegramDeliveryRecord> => {
    const current = await deliveryRepository.read(request.requestId, part);
    if (current) {
      assertDeliveryIdentity(current, request, workspaceId, voiceSource);
      return current;
    }
    const created = await deliveryRepository.createOrLoad({
      requestId: request.requestId,
      part,
      workspaceId,
      conversationId: request.conversationId,
      targetLanguage: request.targetLanguage,
      approvedText: request.approvedPatientText,
      approvedTextHash: sha256(request.approvedPatientText),
      voiceSource: part === "voice" ? voiceSource : undefined,
    });
    assertDeliveryIdentity(created.record, request, workspaceId, voiceSource);
    return created.record;
  };

  const syncAcceptedText = async (
    delivery: TelegramDeliveryRecord,
  ): Promise<number | null> => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const workspace = await workspaceRepository.load(workspaceId);
      if (!workspace) {
        throw new TelegramOutboundError("not_found", "Workspace not found", false);
      }
      const conversation = workspace.state.conversations.find(
        (item) => item.id === delivery.conversationId,
      );
      if (!conversation) {
        throw new TelegramOutboundError("not_found", "Conversation not found", false);
      }
      const linkedMessageId = messageId(delivery.requestId);
      if (conversation.messages.some((message) => message.id === linkedMessageId)) {
        await deliveryRepository.markSynced(delivery.requestId, "text");
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
        throw new TelegramOutboundError("invalid_request", mutation.error, false);
      }
      const saved = await workspaceRepository.save(
        workspaceId,
        workspace.revision,
        mutation.state,
      );
      if (saved.ok) {
        await deliveryRepository.markSynced(delivery.requestId, "text");
        return saved.workspace.revision;
      }
    }
    return null;
  };

  const syncAcceptedVoice = async (
    delivery: TelegramDeliveryRecord,
  ): Promise<number | null> => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const workspace = await workspaceRepository.load(workspaceId);
      if (!workspace) {
        throw new TelegramOutboundError("not_found", "Workspace not found", false);
      }
      const conversation = workspace.state.conversations.find(
        (item) => item.id === delivery.conversationId,
      );
      if (!conversation) {
        throw new TelegramOutboundError("not_found", "Conversation not found", false);
      }
      const linkedMessageId = voiceMessageId(delivery.requestId);
      if (conversation.messages.some((message) => message.id === linkedMessageId)) {
        await deliveryRepository.markSynced(delivery.requestId, "voice");
        return workspace.revision;
      }
      const mutation = linkAcceptedTelegramOutboundVoice(workspace.state, {
        conversationId: delivery.conversationId,
        messageId: linkedMessageId,
        deliveryId: delivery.requestId,
        text:
          delivery.voiceSource === "recorded"
            ? "Staff-recorded voice reply."
            : "AI-generated voice reply.",
        language: delivery.targetLanguage,
        sentAt: receiptFromDelivery(delivery).acceptedAt,
        spokenTextHash: delivery.approvedTextHash,
        voiceSource: delivery.voiceSource ?? "tts",
      });
      if (!mutation.ok) {
        throw new TelegramOutboundError("invalid_request", mutation.error, false);
      }
      const saved = await workspaceRepository.save(
        workspaceId,
        workspace.revision,
        mutation.state,
      );
      if (saved.ok) {
        await deliveryRepository.markSynced(delivery.requestId, "voice");
        return saved.workspace.revision;
      }
    }
    return null;
  };

  const sendPart = async (
    request: OutboundSendRequest,
    target: Target,
    part: "text" | "voice",
  ): Promise<PartAttempt> => {
    const delivery = await ensureDelivery(
      request,
      part,
      part === "voice" ? request.voiceSource : undefined,
    );
    if (delivery.status === "sent") {
      if (part === "text" && delivery.workspaceSyncStatus === "pending") {
        await syncAcceptedText(delivery);
      }
      if (part === "voice" && delivery.workspaceSyncStatus === "pending") {
        await syncAcceptedVoice(delivery);
      }
      return { status: "sent", part, receipt: receiptFromDelivery(delivery) };
    }
    if (delivery.status === "sending") {
      throw new TelegramOutboundError(
        "duplicate",
        `This Telegram ${part} delivery is already in progress.`,
        true,
      );
    }
    if (part === "voice" && !delivery.audioObjectPath) {
      throw new TelegramOutboundError(
        "invalid_request",
        "Prepare the voice reply before sending it.",
        false,
      );
    }
    const claimed = await deliveryRepository.claim(request.requestId, part);
    if (!claimed) {
      const current = await deliveryRepository.read(request.requestId, part);
      if (current?.status === "sent") {
        return { status: "sent", part, receipt: receiptFromDelivery(current) };
      }
      throw new TelegramOutboundError(
        "duplicate",
        `This Telegram ${part} delivery is already in progress.`,
        true,
      );
    }
    let receipt: DeliveryReceipt;
    let sent: TelegramDeliveryRecord;
    try {
      receipt =
        part === "text"
          ? await adapter.sendText(
              target.externalConversationId,
              request.approvedPatientText,
              request.requestId,
            )
          : await adapter.sendVoice(
              target.externalConversationId,
              {
                bytes: await requireVoice(voice).artifactStore.download(
                  claimed.audioObjectPath!,
                ),
                contentType: "audio/ogg",
                filename: "kaunter-reply.ogg",
              },
              request.requestId,
            );
      sent = await deliveryRepository.markSent(request.requestId, part, receipt);
    } catch (error) {
      await deliveryRepository.markFailed(
        request.requestId,
        part,
        providerFailureCode(error),
      );
      return { status: "failed", part };
    }
    if (part === "text") {
      await syncAcceptedText(sent);
    } else {
      await syncAcceptedVoice(sent);
    }
    return { status: "sent", part, receipt };
  };

  return {
    async prepareVoice(input, signal) {
      const request = outboundVoicePrepareRequestSchema.parse(input);
      if (!liveEnabled) {
        throw new TelegramOutboundError(
          "feature_disabled",
          "Live Telegram sending is disabled.",
          false,
        );
      }
      requireVoice(voice);
      await loadTarget(request);
      const delivery = await ensureDelivery(
        request,
        "voice",
        request.source,
      );
      if (delivery.audioObjectPath) {
        return outboundVoicePrepareResultSchema.parse({
          requestId: request.requestId,
          source: request.source,
          status: "ready",
        });
      }
      if (request.source === "recorded") {
        return outboundVoicePrepareResultSchema.parse({
          requestId: request.requestId,
          source: "recorded",
          status: "recording_required",
        });
      }
      const dependencies = requireVoice(voice);
      const synthesized = await dependencies.tts.synthesize(
        request.approvedPatientText,
        { targetLanguage: request.targetLanguage, signal },
      );
      const converted = await dependencies.converter.convertToOgg(
        synthesized.bytes,
        signal,
      );
      try {
        const bytes = new Uint8Array(await readFile(converted.filePath));
        const artifact = await dependencies.artifactStore.upload(
          voiceArtifactObjectPath(request.requestId),
          bytes,
        );
        await deliveryRepository.attachVoiceArtifact({
          requestId: request.requestId,
          ...artifact,
          ttsModel: synthesized.model,
          ttsVoice: synthesized.voice,
        });
      } finally {
        await converted.cleanup();
      }
      return outboundVoicePrepareResultSchema.parse({
        requestId: request.requestId,
        source: "tts",
        status: "ready",
      });
    },

    async attachRecordedVoice(requestId, recording, signal) {
      const parsedRequestId = requestIdSchema.parse(requestId);
      const dependencies = requireVoice(voice);
      const delivery = await deliveryRepository.read(parsedRequestId, "voice");
      if (!delivery) {
        throw new TelegramOutboundError(
          "not_found",
          "Voice preparation was not found.",
          false,
        );
      }
      if (delivery.voiceSource !== "recorded") {
        throw new TelegramOutboundError(
          "invalid_request",
          "This voice delivery does not accept a staff recording.",
          false,
        );
      }
      if (delivery.status === "sending" || delivery.status === "sent") {
        throw new TelegramOutboundError(
          "duplicate",
          "Voice audio cannot change after delivery begins.",
          false,
        );
      }
      const converted = await dependencies.converter.convertToOgg(recording, signal);
      try {
        const bytes = new Uint8Array(await readFile(converted.filePath));
        const artifact = await dependencies.artifactStore.upload(
          voiceArtifactObjectPath(parsedRequestId),
          bytes,
        );
        await deliveryRepository.attachVoiceArtifact({
          requestId: parsedRequestId,
          ...artifact,
        });
      } finally {
        await converted.cleanup();
      }
      return outboundVoiceRecordingResultSchema.parse({
        requestId: parsedRequestId,
        status: "ready",
      });
    },

    async readVoiceAudio(requestId) {
      const parsedRequestId = requestIdSchema.parse(requestId);
      const delivery = await deliveryRepository.read(parsedRequestId, "voice");
      if (!delivery?.audioObjectPath) {
        throw new TelegramOutboundError(
          "not_found",
          "Prepared voice audio was not found.",
          false,
        );
      }
      const dependencies = requireVoice(voice);
      const bytes = await dependencies.artifactStore.download(
        delivery.audioObjectPath,
      );
      if (isOgg(bytes)) return bytes;
      const converted = await dependencies.converter.convertToOgg(bytes);
      try {
        return new Uint8Array(await readFile(converted.filePath));
      } finally {
        await converted.cleanup();
      }
    },

    async send(input) {
      const request = outboundSendRequestSchema.parse(input);
      if (!liveEnabled) {
        throw new TelegramOutboundError(
          "feature_disabled",
          "Live Telegram sending is disabled.",
          false,
        );
      }
      if (request.mode !== "text" && !request.voiceSource) {
        throw new TelegramOutboundError(
          "invalid_request",
          "Voice sends must select TTS or a staff recording.",
          false,
        );
      }
      if (request.mode !== "text") {
        requireVoice(voice);
      }
      const requiredParts = partsFor(request.mode);
      const existing = await Promise.all(
        requiredParts.map((part) => deliveryRepository.read(request.requestId, part)),
      );
      existing.forEach((delivery, index) => {
        if (delivery) {
          assertDeliveryIdentity(
            delivery,
            request,
            workspaceId,
            requiredParts[index] === "voice" ? request.voiceSource : undefined,
          );
        }
      });
      if (existing.every((delivery) => delivery?.status === "sent")) {
        const sentDeliveries = existing as TelegramDeliveryRecord[];
        const textDelivery = sentDeliveries.find((item) => item.part === "text");
        const voiceDelivery = sentDeliveries.find((item) => item.part === "voice");
        if (textDelivery?.workspaceSyncStatus === "pending") {
          await syncAcceptedText(textDelivery);
        }
        if (voiceDelivery?.workspaceSyncStatus === "pending") {
          await syncAcceptedVoice(voiceDelivery);
        }
        return resultFromAttempts(
          request.requestId,
          sentDeliveries.map((delivery) => ({
            status: "sent" as const,
            part: delivery.part,
            receipt: receiptFromDelivery(delivery),
          })),
        );
      }
      const target = await loadTarget(
        request,
        existing.some((delivery) => delivery?.status === "sent"),
      );
      const attempted: PartAttempt[] = [];
      for (const part of requiredParts) {
        attempted.push(await sendPart(request, target, part));
      }
      return resultFromAttempts(request.requestId, attempted);
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
          "Telegram text delivery not found.",
          false,
        );
      }
      if (delivery.status !== "sent") {
        throw new TelegramOutboundError(
          "invalid_request",
          "Telegram text delivery was not accepted.",
          false,
        );
      }
      const workspace = await workspaceRepository.load(workspaceId);
      const conversation = workspace?.state.conversations.find(
        (item) => item.id === delivery.conversationId,
      );
      if (!workspace || !conversation) {
        throw new TelegramOutboundError("not_found", "Conversation not found.", false);
      }
      const alreadyLinked = conversation.messages.some(
        (message) => message.id === messageId(requestId),
      );
      if (!alreadyLinked && conversation.revision !== request.expectedConversationRevision) {
        throw new TelegramOutboundError(
          "revision_conflict",
          "Conversation changed before Telegram reconciliation.",
          true,
        );
      }
      const workspaceRevision = await syncAcceptedText(delivery);
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
