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
  speechArtifacts: Record<
    string,
    { status: "pending" | "transcribing" | "ready" | "failed"; error: string | null }
  >;
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
  speechArtifacts: ServerDomainStatePayload["speechArtifacts"],
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
  const readySpeech = new Map(
    speechArtifacts
      .filter((artifact) => artifact.status === "ready")
      .map((artifact) => [artifact.messageId, artifact]),
  );
  return conversationSchema.parse({
    ...shared,
    messages: shared.messages.map((message) => {
      const artifact = readySpeech.get(message.id);
      if (!artifact) {
        return message;
      }
      const { gloss: _gloss, ...withoutGloss } = message;
      return artifact.englishGloss
        ? {
            ...withoutGloss,
            text: artifact.originalTranscript,
            language: artifact.detectedLanguage,
            gloss: artifact.englishGloss,
          }
        : {
            ...withoutGloss,
            text: artifact.originalTranscript,
            language: artifact.detectedLanguage,
          };
    }),
    agentMode: agentMode === "live_agent" ? "synthetic_agent" : agentMode,
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
    ...telegram.map((conversation) =>
      toConversationView(conversation, server.speechArtifacts),
    ),
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
    speechArtifacts: Object.fromEntries(
      server.speechArtifacts.map((artifact) => [
        artifact.messageId,
        { status: artifact.status, error: artifact.error },
      ]),
    ),
  };
}
