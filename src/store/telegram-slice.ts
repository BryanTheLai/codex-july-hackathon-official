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
import { isAbortError } from "../shared/errors";
import { applyMutation } from "./apply-mutation";
import type { AppStateRepository } from "./repository";
import type {
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

  return {
    refreshTelegramWorkspace,

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
      if (revision === undefined) {
        const message =
          "Refresh the Telegram inbox before sending this message.";
        set({ lastFeedback: message });
        return failed(getState(), message);
      }
      const approvedPatientText =
        input.translation?.text.trim() ?? input.text.trim();
      const targetLanguage =
        input.translation?.language ||
        conversation.patient.preferredLanguage ||
        "English";
      const deliveryMode = input.deliveryMode ?? "text";
      const voiceSource = input.voiceSource ?? "tts";

      try {
        if (deliveryMode !== "text") {
          if (!outboundClient.prepareVoice) {
            const message = "Telegram voice preparation is unavailable.";
            set({ lastFeedback: message });
            return failed(getState(), message);
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
              set({ lastFeedback: message });
              return failed(getState(), message);
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
            requestId: input.requestId,
            conversationId: input.conversationId,
            expectedConversationRevision: revision,
            targetLanguage,
            approvedPatientText,
            mode: deliveryMode,
            voiceSource: deliveryMode === "text" ? undefined : voiceSource,
          },
          signal,
        );
        if (result.status === "failed") {
          const message =
            "Telegram did not accept the message. Retry sends the same approved request.";
          set({ lastFeedback: message });
          return failed(getState(), message);
        }

        const deliveryId = result.deliveryIds[0]!;
        const pendingDelivery = result.text ? {
          conversationId: input.conversationId,
          deliveryId,
        } : null;
        const refreshed = await refreshTelegramWorkspace(signal);
        if (!refreshed.ok) {
          set({
            lastFeedback:
              "Telegram accepted the message, but Chat refresh failed. Refresh the inbox; do not resend.",
          });
          setTelegramWorkspace({
            ...getTelegramWorkspace(),
            pendingDelivery,
          });
          return { ok: true, state: getState() };
        }
        if (!result.text) {
          if (result.status === "partial_failure") {
            const message = "Voice reply was not accepted. Retry sends only the failed voice part.";
            set({ lastFeedback: message });
            return failed(getState(), message);
          }
          setTelegramWorkspace({
            ...getTelegramWorkspace(),
            pendingDelivery: null,
          });
          set({ lastFeedback: "Telegram voice reply sent." });
          return refreshed;
        }
        const linkedMessageId = `telegram-delivery:${deliveryId}:text`;
        const linked = getState().conversations
          .find(
            (item) => item.id === input.conversationId,
          )
          ?.messages.some((message) => message.id === linkedMessageId);
        if (!linked) {
          set({
            lastFeedback:
              "Telegram sent the message, but Chat sync is pending. Use the sync action; do not resend.",
          });
          setTelegramWorkspace({
            ...getTelegramWorkspace(),
            pendingDelivery,
          });
          return { ok: true, state: getState() };
        }
        setTelegramWorkspace({
          ...getTelegramWorkspace(),
          pendingDelivery: null,
        });
        if (result.status === "partial_failure") {
          const message = "Text reply sent; voice was not accepted. Retry sends only the failed voice part.";
          set({ lastFeedback: message });
          return failed(getState(), message);
        }
        set({ lastFeedback: "Telegram reply sent." });
        return refreshed;
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
          set({ lastFeedback: message });
          return failed(getState(), message);
        }
        const message =
          error instanceof ApiClientError
            ? error.message
            : "The Telegram send request failed.";
        set({ lastFeedback: message });
        return failed(getState(), message);
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
