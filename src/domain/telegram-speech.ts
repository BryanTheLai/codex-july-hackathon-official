import { serverDomainStateSchema, type ServerDomainStatePayload } from "../contracts/app-state";

export class TelegramSpeechDomainError extends Error {}

type SpeechArtifact = ServerDomainStatePayload["speechArtifacts"][number];

function cloneState(state: ServerDomainStatePayload): ServerDomainStatePayload {
  return serverDomainStateSchema.parse(structuredClone(state));
}

function artifactIndex(state: ServerDomainStatePayload, messageId: string): number {
  const index = state.speechArtifacts.findIndex(
    (artifact) => artifact.messageId === messageId,
  );
  if (index < 0) {
    throw new TelegramSpeechDomainError("Speech artifact not found");
  }
  return index;
}

function updateMessage(
  state: ServerDomainStatePayload,
  messageId: string,
  input: {
    detectedLanguage: string | null;
    englishGloss: string | null;
    originalTranscript: string | null;
  },
): void {
  const originalTranscript = input.originalTranscript;
  if (!originalTranscript) {
    return;
  }
  const conversationIndex = state.conversations.findIndex((conversation) =>
    conversation.messages.some((message) => message.id === messageId),
  );
  if (conversationIndex < 0) {
    throw new TelegramSpeechDomainError("Speech message not found");
  }
  const conversation = state.conversations[conversationIndex]!;
  state.conversations[conversationIndex] = {
    ...conversation,
    revision: conversation.revision + 1,
    messages: conversation.messages.map((message) => {
      if (message.id !== messageId) {
        return message;
      }
      const { gloss: _gloss, ...withoutGloss } = message;
      return input.englishGloss
        ? {
            ...withoutGloss,
            text: originalTranscript,
            language: input.detectedLanguage ?? message.language,
            gloss: input.englishGloss,
          }
        : {
            ...withoutGloss,
            text: originalTranscript,
            language: input.detectedLanguage ?? message.language,
          };
    }),
  };
}

export function beginTelegramSpeechTranscription(input: {
  state: ServerDomainStatePayload;
  messageId: string;
  model: string;
}): ServerDomainStatePayload {
  const state = cloneState(input.state);
  const index = artifactIndex(state, input.messageId);
  const artifact = state.speechArtifacts[index]!;
  if (artifact.status === "ready") {
    throw new TelegramSpeechDomainError("Speech artifact is already ready");
  }
  if (artifact.status === "transcribing") {
    throw new TelegramSpeechDomainError("Speech artifact is already transcribing");
  }
  state.speechArtifacts[index] = {
    messageId: artifact.messageId,
    telegramFileId: artifact.telegramFileId,
    status: "transcribing",
    detectedLanguage: null,
    originalTranscript: null,
    englishGloss: null,
    model: input.model,
    error: null,
  };
  return serverDomainStateSchema.parse(state);
}

export function completeTelegramSpeechTranscription(input: {
  state: ServerDomainStatePayload;
  messageId: string;
  model: string;
  detectedLanguage: string;
  originalTranscript: string;
  englishGloss: string | null;
}): ServerDomainStatePayload {
  const state = cloneState(input.state);
  const index = artifactIndex(state, input.messageId);
  const artifact = state.speechArtifacts[index]!;
  if (artifact.status !== "transcribing") {
    throw new TelegramSpeechDomainError("Speech artifact is not transcribing");
  }
  state.speechArtifacts[index] = {
    messageId: artifact.messageId,
    telegramFileId: artifact.telegramFileId,
    status: "ready",
    detectedLanguage: input.detectedLanguage,
    originalTranscript: input.originalTranscript,
    englishGloss: input.englishGloss,
    model: input.model,
    error: null,
  };
  updateMessage(state, input.messageId, input);
  return serverDomainStateSchema.parse(state);
}

export function completeTelegramSpeechManualTranscription(input: {
  state: ServerDomainStatePayload;
  messageId: string;
  detectedLanguage: string;
  originalTranscript: string;
  englishGloss: string | null;
}): ServerDomainStatePayload {
  const state = cloneState(input.state);
  const index = artifactIndex(state, input.messageId);
  const artifact = state.speechArtifacts[index]!;
  if (artifact.status === "transcribing") {
    throw new TelegramSpeechDomainError(
      "Speech artifact is currently being transcribed",
    );
  }
  state.speechArtifacts[index] = {
    messageId: artifact.messageId,
    telegramFileId: artifact.telegramFileId,
    status: "ready",
    detectedLanguage: input.detectedLanguage,
    originalTranscript: input.originalTranscript,
    englishGloss: input.englishGloss,
    model: "manual",
    error: null,
  };
  updateMessage(state, input.messageId, input);
  return serverDomainStateSchema.parse(state);
}

export function failTelegramSpeechTranscription(input: {
  state: ServerDomainStatePayload;
  messageId: string;
  model: string | null;
  error: string;
  detectedLanguage?: string | null;
  originalTranscript?: string | null;
  englishGloss?: string | null;
}): ServerDomainStatePayload {
  const state = cloneState(input.state);
  const index = artifactIndex(state, input.messageId);
  const artifact: SpeechArtifact = state.speechArtifacts[index]!;
  if (artifact.status === "ready") {
    throw new TelegramSpeechDomainError("Ready speech artifact cannot be failed");
  }
  const detectedLanguage = input.detectedLanguage ?? null;
  const originalTranscript = input.originalTranscript ?? null;
  const englishGloss = input.englishGloss ?? null;
  state.speechArtifacts[index] = {
    messageId: artifact.messageId,
    telegramFileId: artifact.telegramFileId,
    status: "failed",
    detectedLanguage,
    originalTranscript,
    englishGloss,
    model: input.model,
    error: input.error,
  };
  updateMessage(state, input.messageId, {
    detectedLanguage,
    originalTranscript,
    englishGloss,
  });
  return serverDomainStateSchema.parse(state);
}
