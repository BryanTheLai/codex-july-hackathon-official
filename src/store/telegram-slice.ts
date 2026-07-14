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

      try {
        const result = await outboundClient.send(
          {
            requestId: input.requestId,
            conversationId: input.conversationId,
            expectedConversationRevision: revision,
            targetLanguage,
            approvedPatientText,
            mode: "text",
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
        const pendingDelivery = {
          conversationId: input.conversationId,
          deliveryId,
        };
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
  };
}
