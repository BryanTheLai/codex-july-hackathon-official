import {
  sendStaffReply,
  type AppState,
  type MutationResult,
  type SendStaffReplyInput,
} from "../domain";
import { mergeTelegramWorkspaceState } from "../domain/telegram-workspace";
import {
  ApiClientError,
  type TelegramOutboundClient,
  type WorkspaceClient,
} from "../services/api-client";
import type { TelegramVoiceSource } from "../contracts/channel";
import type { OutboundSendResult } from "../contracts/api";
import { isAbortError } from "../shared/errors";
import { applyMutation } from "./apply-mutation";
import type { AppStateRepository } from "./repository";
import type {
  TelegramDeliveryNotice,
  TelegramWorkspaceRepository,
  TelegramWorkspaceState,
} from "./telegram-workspace-repository";

export type { TelegramWorkspaceState } from "./telegram-workspace-repository";

export type SendVisitorReplyInput = SendStaffReplyInput & {
  requestId: string;
  deliveryMode?: "text" | "voice" | "both";
  voiceRecording?: Blob;
  voiceSource?: TelegramVoiceSource;
};

type TelegramSliceDeps = {
  getState: () => AppState;
  getTelegramWorkspace: () => TelegramWorkspaceState;
  outboundClient: TelegramOutboundClient;
  repository: AppStateRepository;
  set: (partial: {
    state?: AppState;
    lastFeedback?: string;
    telegramWorkspace?: TelegramWorkspaceState;
  }) => void;
  telegramWorkspaceRepository: TelegramWorkspaceRepository;
  workspaceClient: WorkspaceClient;
};

function failed(
  state: AppState,
  error: string,
): MutationResult {
  return { ok: false, state, error };
}

type DeliveryContext = Pick<
  TelegramDeliveryNotice,
  | "conversationId"
  | "requestId"
  | "targetLanguage"
  | "approvedPatientText"
  | "mode"
  | "voiceSource"
>;

function deliveryPartLabel(parts: Array<"text" | "voice">): string {
  if (parts.length === 2) {
    return "text and voice";
  }
  return parts[0] ?? "delivery";
}

type AcceptedOutboundResult = Exclude<
  OutboundSendResult,
  { status: "failed" }
>;

function sentParts(result: AcceptedOutboundResult): Array<"text" | "voice"> {
  return [
    ...(result.text ? ["text" as const] : []),
    ...(result.voice ? ["voice" as const] : []),
  ];
}

function sentMessage(result: AcceptedOutboundResult): string {
  const parts = sentParts(result);
  if (parts.length === 2) {
    return "Text and voice sent.";
  }
  if (parts[0] === "voice") {
    return "Voice sent.";
  }
  return "Sent.";
}

export function createTelegramActions({
  getState,
  getTelegramWorkspace,
  outboundClient,
  repository,
  set,
  telegramWorkspaceRepository,
  workspaceClient,
}: TelegramSliceDeps) {
  let latestRefresh = 0;
  const setTelegramWorkspace = (
    telegramWorkspace: TelegramWorkspaceState,
  ) => {
    set({ telegramWorkspace });
    telegramWorkspaceRepository.save(telegramWorkspace);
  };

  const setDeliveryNotice = (notice: TelegramDeliveryNotice) => {
    set({ lastFeedback: notice.message });
    setTelegramWorkspace({
      ...getTelegramWorkspace(),
      deliveryNotice: notice,
    });
  };

  const noticeFor = (
    context: DeliveryContext,
    status: TelegramDeliveryNotice["status"],
    message: string,
    failedParts: Array<"text" | "voice"> = [],
    retryStage: TelegramDeliveryNotice["retryStage"] = "send",
  ): TelegramDeliveryNotice => ({
    ...context,
    status,
    retryStage,
    failedParts,
    message,
  });

  const failedDelivery = (
    context: DeliveryContext,
    message: string,
    failedParts: Array<"text" | "voice"> = [],
    retryStage: TelegramDeliveryNotice["retryStage"] = "send",
  ): MutationResult => {
    setDeliveryNotice(
      noticeFor(context, "failed", message, failedParts, retryStage),
    );
    return failed(getState(), message);
  };

  const refreshTelegramWorkspace = async (
    signal?: AbortSignal,
  ): Promise<MutationResult> => {
    const generation = ++latestRefresh;
    const previous = getTelegramWorkspace();
    setTelegramWorkspace({
      ...previous,
      status: "loading",
    });
    try {
      const envelope = await workspaceClient.load(signal);
      if (generation !== latestRefresh) {
        return { ok: true, state: getState() };
      }
      const projected = mergeTelegramWorkspaceState(
        getState(),
        envelope.state,
      );
      const telegramWorkspace: TelegramWorkspaceState = {
        ...getTelegramWorkspace(),
        status: "ready",
        workspaceRevision: envelope.revision,
        conversationRevisions: projected.conversationRevisions,
        speechArtifacts: projected.speechArtifacts,
      };
      set({
        state: projected.state,
        lastFeedback: "Telegram inbox refreshed.",
      });
      setTelegramWorkspace(telegramWorkspace);
      repository.save(projected.state);
      return { ok: true, state: projected.state };
    } catch (error) {
      if (generation !== latestRefresh) {
        return { ok: true, state: getState() };
      }
      if (isAbortError(error)) {
        setTelegramWorkspace(previous);
        throw error;
      }
      if (
        error instanceof ApiClientError &&
        error.code === "feature_disabled"
      ) {
        setTelegramWorkspace({
          ...getTelegramWorkspace(),
          status: "local",
        });
        return { ok: true, state: getState() };
      }
      const message =
        error instanceof ApiClientError
          ? error.message
          : "The Telegram inbox could not be refreshed.";
      set({ lastFeedback: message });
      setTelegramWorkspace({
        ...getTelegramWorkspace(),
        status: "error",
      });
      return failed(getState(), message);
    }
  };

  const settleOutboundDelivery = async (
    context: DeliveryContext,
    result: OutboundSendResult,
    signal?: AbortSignal,
  ): Promise<MutationResult> => {
    const failedParts = result.status === "sent" ? [] : result.failedParts ?? [];
    if (result.status === "failed") {
      const message = `${deliveryPartLabel(failedParts)} delivery failed before confirmation. Retry checks the original request and sends only unsent parts.`;
      return failedDelivery(context, message, failedParts);
    }

    const deliveryId = result.deliveryIds[0]!;
    const pendingDelivery = result.text
      ? { conversationId: context.conversationId, deliveryId }
      : null;
    const refreshed = await refreshTelegramWorkspace(signal);
    const partialMessage = result.status === "partial_failure"
      ? `${deliveryPartLabel(sentParts(result))} sent; ${deliveryPartLabel(failedParts)} failed. Retry only the failed ${deliveryPartLabel(failedParts)} part.`
      : "";

    if (!refreshed.ok) {
      const message = result.status === "partial_failure"
        ? `${partialMessage} Inbox refresh is pending; do not resend the successful part.`
        : `Telegram accepted the ${deliveryPartLabel(sentParts(result))} delivery, but inbox refresh is pending. Do not resend.`;
      setDeliveryNotice(
        noticeFor(
          context,
          result.status === "partial_failure" ? "partial_failure" : result.voice && !result.text ? "voice_sent" : "sent",
          message,
          result.status === "partial_failure" ? failedParts : [],
        ),
      );
      setTelegramWorkspace({
        ...getTelegramWorkspace(),
        pendingDelivery,
      });
      return result.status === "partial_failure"
        ? failed(getState(), message)
        : { ok: true, state: getState() };
    }

    if (result.text) {
      const linkedMessageId = `telegram-delivery:${deliveryId}:text`;
      const linked = getState().conversations
        .find((item) => item.id === context.conversationId)
        ?.messages.some((message) => message.id === linkedMessageId);
      if (!linked) {
        const message = result.status === "partial_failure"
          ? `${partialMessage} Text synchronization is pending; do not resend the successful part.`
          : `Telegram accepted the ${deliveryPartLabel(sentParts(result))} delivery, but text synchronization is pending. Do not resend.`;
        setDeliveryNotice(
          noticeFor(
            context,
            result.status === "partial_failure" ? "partial_failure" : "sent",
            message,
            result.status === "partial_failure" ? failedParts : [],
          ),
        );
        setTelegramWorkspace({
          ...getTelegramWorkspace(),
          pendingDelivery,
        });
        return result.status === "partial_failure"
          ? failed(getState(), message)
          : { ok: true, state: getState() };
      }
    }

    setTelegramWorkspace({
      ...getTelegramWorkspace(),
      pendingDelivery: null,
    });
    if (result.status === "partial_failure") {
      setDeliveryNotice(
        noticeFor(
          context,
          "partial_failure",
          partialMessage,
          failedParts,
        ),
      );
      return failed(getState(), partialMessage);
    }
    const message = sentMessage(result);
    setDeliveryNotice(
      noticeFor(
        context,
        result.voice && !result.text ? "voice_sent" : "sent",
        message,
      ),
    );
    return refreshed;
  };

  return {
    refreshTelegramWorkspace,

    async sendCalendarInvitation(
      conversationId: string,
      signal?: AbortSignal,
    ): Promise<MutationResult> {
      const conversation = getState().conversations.find(
        (candidate) => candidate.id === conversationId,
      );
      if (!conversation) {
        const message = "Conversation not found.";
        set({ lastFeedback: message });
        return failed(getState(), message);
      }
      if (
        conversation.channel !== "Telegram" ||
        !conversation.booking ||
        conversation.booking.status !== "approved"
      ) {
        const message = "Calendar delivery requires an approved Telegram booking.";
        set({ lastFeedback: message });
        return failed(getState(), message);
      }
      const revision = getTelegramWorkspace().conversationRevisions[conversationId];
      if (revision === undefined) {
        const message = "Refresh the Telegram inbox before sending the calendar file.";
        set({ lastFeedback: message });
        return failed(getState(), message);
      }
      if (!outboundClient.sendCalendar) {
        const message = "Calendar delivery is unavailable.";
        set({ lastFeedback: message });
        return failed(getState(), message);
      }
      set({ lastFeedback: "Sending calendar invitation." });
      try {
        await outboundClient.sendCalendar(
          { conversationId, expectedConversationRevision: revision },
          signal,
        );
        const refreshed = await refreshTelegramWorkspace(signal);
        if (!refreshed.ok) return refreshed;
        set({ lastFeedback: "Calendar invitation sent to Telegram." });
        return { ok: true, state: getState() };
      } catch (error) {
        if (isAbortError(error)) throw error;
        const message = error instanceof ApiClientError
          ? error.message
          : "The calendar invitation could not be sent.";
        set({ lastFeedback: message });
        return failed(getState(), message);
      }
    },

    async sendVisitorReply(
      input: SendVisitorReplyInput,
      signal?: AbortSignal,
    ): Promise<MutationResult> {
      const conversation = getState().conversations.find(
        (item) => item.id === input.conversationId,
      );
      if (!conversation) {
        const message = "Conversation not found";
        set({ lastFeedback: message });
        return failed(getState(), message);
      }
      const isTelegram =
        conversation.channel === "Telegram" &&
        conversation.id.startsWith("telegram-conversation:");
      const revision =
        getTelegramWorkspace().conversationRevisions[
          input.conversationId
        ];
      if (input.kind === "internal_note" || !isTelegram) {
        return applyMutation(
          set,
          repository,
          sendStaffReply(getState(), input),
          "Staff reply sent.",
        );
      }
      const approvedPatientText =
        input.translation?.text.trim() ?? input.text.trim();
      const targetLanguage =
        input.translation?.language ||
        conversation.patient.preferredLanguage ||
        "English";
      const deliveryMode = input.deliveryMode ?? "text";
      const voiceSource = input.voiceSource ?? "tts";
      const context: DeliveryContext = {
        conversationId: input.conversationId,
        requestId: input.requestId,
        targetLanguage,
        approvedPatientText,
        mode: deliveryMode,
        voiceSource: deliveryMode === "text" ? null : voiceSource,
      };
      const requestedParts = deliveryMode === "both"
        ? ["text", "voice"] as Array<"text" | "voice">
        : [deliveryMode];
      if (revision === undefined) {
        const message =
          "Refresh the Telegram inbox before sending this message.";
        return failedDelivery(context, message, requestedParts);
      }

      setDeliveryNotice(
        noticeFor(
          context,
          "sending",
          deliveryMode === "text" ? "Sending text reply." : "Preparing voice reply.",
          [],
          deliveryMode === "text" ? "send" : "voice_prepare",
        ),
      );

      try {
        if (deliveryMode !== "text") {
          if (!outboundClient.prepareVoice) {
            const message = "Telegram voice preparation is unavailable.";
            return failedDelivery(context, message, ["voice"], "voice_prepare");
          }
          const prepared = await outboundClient.prepareVoice(
            {
              requestId: input.requestId,
              conversationId: input.conversationId,
              expectedConversationRevision: revision,
              targetLanguage,
              approvedPatientText,
              source: voiceSource,
            },
            signal,
          );
          if (prepared.status === "recording_required") {
            if (!input.voiceRecording || !outboundClient.uploadRecordedVoice) {
              const message = "Record a staff voice reply before sending.";
              return failedDelivery(context, message, ["voice"], "voice_prepare");
            }
            await outboundClient.uploadRecordedVoice(
              input.requestId,
              input.voiceRecording,
              signal,
            );
          }
        }
        const result = await outboundClient.send(
          {
            requestId: context.requestId,
            conversationId: context.conversationId,
            expectedConversationRevision: revision,
            targetLanguage: context.targetLanguage,
            approvedPatientText: context.approvedPatientText,
            mode: context.mode,
            voiceSource: context.voiceSource ?? undefined,
          },
          signal,
        );
        return settleOutboundDelivery(context, result, signal);
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        if (
          error instanceof ApiClientError &&
          error.code === "revision_conflict"
        ) {
          await refreshTelegramWorkspace(signal);
          const message =
            "Conversation changed. Review the refreshed thread and retry.";
          return failedDelivery(context, message, requestedParts);
        }
        if (error instanceof ApiClientError && error.code === "feature_disabled") {
          return failedDelivery(context, error.message, requestedParts);
        }
        const message =
          error instanceof ApiClientError
            ? error.message
            : "The Telegram send request failed.";
        return failedDelivery(
          context,
          `${message} Delivery status is unknown. Retry checks the original request and sends only unsent parts.`,
          [],
          deliveryMode === "text" ? "send" : "voice_prepare",
        );
      }
    },

    async retryTelegramDelivery(
      signal?: AbortSignal,
    ): Promise<MutationResult> {
      const notice = getTelegramWorkspace().deliveryNotice;
      if (
        !notice ||
        (notice.status !== "partial_failure" && notice.status !== "failed")
      ) {
        const message = "No failed Telegram delivery is available to retry.";
        set({ lastFeedback: message });
        return failed(getState(), message);
      }
      const revision = getTelegramWorkspace().conversationRevisions[
        notice.conversationId
      ];
      if (revision === undefined) {
        const message = "Refresh the Telegram inbox before retrying this delivery.";
        return failedDelivery(notice, message, notice.failedParts);
      }
      const requestedParts = notice.mode === "both"
        ? ["text", "voice"] as Array<"text" | "voice">
        : [notice.mode];
      setDeliveryNotice(
        noticeFor(
          notice,
          "sending",
          "Retrying the original approved delivery.",
          [],
          notice.retryStage,
        ),
      );
      try {
        if (notice.mode !== "text" && notice.retryStage === "voice_prepare") {
          if (!outboundClient.prepareVoice || !notice.voiceSource) {
            return failedDelivery(
              notice,
              "Telegram voice preparation is unavailable.",
              ["voice"],
              "voice_prepare",
            );
          }
          const prepared = await outboundClient.prepareVoice(
            {
              requestId: notice.requestId,
              conversationId: notice.conversationId,
              expectedConversationRevision: revision,
              targetLanguage: notice.targetLanguage,
              approvedPatientText: notice.approvedPatientText,
              source: notice.voiceSource,
            },
            signal,
          );
          if (prepared.status === "recording_required") {
            return failedDelivery(
              notice,
              "The original staff recording is unavailable. Open the conversation and record it again before retrying.",
              ["voice"],
              "voice_prepare",
            );
          }
        }
        const result = await outboundClient.send(
          {
            requestId: notice.requestId,
            conversationId: notice.conversationId,
            expectedConversationRevision: revision,
            targetLanguage: notice.targetLanguage,
            approvedPatientText: notice.approvedPatientText,
            mode: notice.mode,
            voiceSource: notice.voiceSource ?? undefined,
          },
          signal,
        );
        return settleOutboundDelivery(notice, result, signal);
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        if (
          error instanceof ApiClientError &&
          error.code === "revision_conflict"
        ) {
          await refreshTelegramWorkspace(signal);
          const message =
            "Conversation changed. Review the refreshed thread and retry.";
          return failedDelivery(notice, message, requestedParts);
        }
        if (error instanceof ApiClientError && error.code === "feature_disabled") {
          return failedDelivery(notice, error.message, requestedParts);
        }
        const message =
          error instanceof ApiClientError
            ? error.message
            : "The Telegram retry request failed.";
        return failedDelivery(
          notice,
          `${message} Delivery status is unknown. Retry checks the original request and sends only unsent parts.`,
          [],
          notice.mode === "text" ? "send" : notice.retryStage,
        );
      }
    },

    async reconcileTelegramDelivery(
      signal?: AbortSignal,
    ): Promise<MutationResult> {
      const pending = getTelegramWorkspace().pendingDelivery;
      if (!pending) {
        const message = "No accepted Telegram message needs synchronization.";
        set({ lastFeedback: message });
        return failed(getState(), message);
      }
      const revision =
        getTelegramWorkspace().conversationRevisions[
          pending.conversationId
        ];
      if (revision === undefined) {
        const message =
          "Refresh the Telegram inbox before synchronizing this message.";
        set({ lastFeedback: message });
        return failed(getState(), message);
      }

      const previous = getTelegramWorkspace();
      setTelegramWorkspace({
        ...previous,
        status: "loading",
      });
      try {
        await outboundClient.reconcile(
          pending.deliveryId,
          { expectedConversationRevision: revision },
          signal,
        );
        const refreshed = await refreshTelegramWorkspace(signal);
        const linkedMessageId =
          `telegram-delivery:${pending.deliveryId}:text`;
        const linked =
          refreshed.ok &&
          getState().conversations
            .find(
              (conversation) =>
                conversation.id === pending.conversationId,
            )
            ?.messages.some(
              (message) => message.id === linkedMessageId,
            );
        if (!linked) {
          const message =
            "Telegram message synchronization is still pending.";
          set({ lastFeedback: message });
          return failed(getState(), message);
        }
        set({
          lastFeedback: "Accepted Telegram message synchronized.",
        });
        setTelegramWorkspace({
          ...getTelegramWorkspace(),
          pendingDelivery: null,
        });
        return { ok: true, state: getState() };
      } catch (error) {
        if (isAbortError(error)) {
          setTelegramWorkspace(previous);
          throw error;
        }
        if (
          error instanceof ApiClientError &&
          error.code === "revision_conflict"
        ) {
          await refreshTelegramWorkspace(signal);
          const message =
            "Conversation changed. Review the refreshed thread and sync again.";
          set({ lastFeedback: message });
          return failed(getState(), message);
        }
        const message =
          error instanceof ApiClientError
            ? error.message
            : "The Telegram message could not be synchronized.";
        set({ lastFeedback: message });
        setTelegramWorkspace({
          ...getTelegramWorkspace(),
          status: "error",
        });
        return failed(getState(), message);
      }
    },

    async retryTelegramSpeech(
      messageId: string,
      signal?: AbortSignal,
    ): Promise<MutationResult> {
      if (!outboundClient.retrySpeech) {
        const message = "Speech retry is unavailable.";
        set({ lastFeedback: message });
        return failed(getState(), message);
      }
      try {
        await outboundClient.retrySpeech(messageId, signal);
        return refreshTelegramWorkspace(signal);
      } catch (error) {
        const message = error instanceof ApiClientError
          ? error.message
          : "Speech retry failed.";
        set({ lastFeedback: message });
        return failed(getState(), message);
      }
    },

    async saveTelegramManualTranscript(
      messageId: string,
      input: {
        detectedLanguage: string;
        englishGloss?: string | null;
        originalTranscript: string;
      },
      signal?: AbortSignal,
    ): Promise<MutationResult> {
      if (!outboundClient.saveManualTranscript) {
        const message = "Manual speech recovery is unavailable.";
        set({ lastFeedback: message });
        return failed(getState(), message);
      }
      try {
        await outboundClient.saveManualTranscript(messageId, input, signal);
        return refreshTelegramWorkspace(signal);
      } catch (error) {
        const message = error instanceof ApiClientError
          ? error.message
          : "Manual transcript could not be saved.";
        set({ lastFeedback: message });
        return failed(getState(), message);
      }
    },

    async translateTelegramReply(
      text: string,
      targetLanguage: string,
      signal?: AbortSignal,
    ): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
      if (!outboundClient.translate) {
        return { ok: false, error: "Live translation is unavailable." };
      }
      try {
        const result = await outboundClient.translate(
          { text, targetLanguage },
          signal,
        );
        return { ok: true, text: result.translatedText };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof ApiClientError
            ? error.message
            : "Live translation failed.",
        };
      }
    },
  };
}
