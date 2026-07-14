import {
  appStateSchema,
  conversationSchema,
  serverDomainStateSchema,
  type ConversationPayload,
  type ServerConversationPayload,
  type ServerDomainStatePayload,
} from "../contracts/app-state";
import type { AppState } from "./types";

export type TelegramWorkspaceProjection = {
  state: AppState;
  conversationRevisions: Record<string, number>;
};

function isProjectedTelegramConversation(
  conversation: ConversationPayload,
): boolean {
  return (
    conversation.channel === "Telegram" &&
    conversation.id.startsWith("telegram-conversation:")
  );
}

function toConversationView(
  conversation: ServerConversationPayload,
): ConversationPayload {
  const {
    agentMode,
    channel: _channel,
    externalConversationId: _externalConversationId,
    latestAgentArtifactId: _latestAgentArtifactId,
    patient,
    revision: _revision,
    source: _source,
    ...shared
  } = conversation;
  return conversationSchema.parse({
    ...shared,
    agentMode: agentMode === "live_agent" ? "staff_only" : agentMode,
    channel: "Telegram",
    patient: {
      name: patient.name,
      phone: patient.phone ?? "",
      medicalRecordNumber: patient.medicalRecordNumber ?? "",
      preferredLanguage: patient.preferredLanguage,
    },
  });
}

export function mergeTelegramWorkspaceState(
  current: AppState,
  input: ServerDomainStatePayload,
): TelegramWorkspaceProjection {
  const server = serverDomainStateSchema.parse(input);
  const telegram = server.conversations.filter(
    (conversation) => conversation.source === "telegram",
  );
  const conversations = [
    ...telegram.map(toConversationView),
    ...current.conversations.filter(
      (conversation) => !isProjectedTelegramConversation(conversation),
    ),
  ];
  const selectedConversationId = conversations.some(
    (conversation) =>
      conversation.id === current.selections.conversationId,
  )
    ? current.selections.conversationId
    : (conversations[0]?.id ?? null);

  return {
    state: appStateSchema.parse({
      ...current,
      conversations,
      selections: {
        ...current.selections,
        conversationId: selectedConversationId,
      },
    }),
    conversationRevisions: Object.fromEntries(
      telegram.map((conversation) => [
        conversation.id,
        conversation.revision,
      ]),
    ),
  };
}
