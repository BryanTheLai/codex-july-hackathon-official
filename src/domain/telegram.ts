import { z } from "zod";

import {
  serverDomainStateSchema,
  type ServerDomainStatePayload,
} from "../contracts/app-state";
import {
  normalizedInboundEventSchema,
  type NormalizedInboundEvent,
  type NormalizedInboundTextEvent,
  type NormalizedInboundVoiceEvent,
} from "../contracts/channel";
import type { MutationResult } from "./types";

const outboundTextInputSchema = z
  .object({
    conversationId: z.string().min(1).max(128),
    messageId: z.string().min(1).max(256),
    text: z.string().trim().min(1).max(4096),
    language: z.string().trim().min(1).max(64),
    sentAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const outboundVoiceInputSchema = outboundTextInputSchema
  .extend({
    deliveryId: z.string().min(1).max(128),
    spokenTextHash: z.string().regex(/^[a-f0-9]{64}$/),
    voiceSource: z.enum(["tts", "recorded"]),
  })
  .strict();

export type AppendTelegramOutboundTextInput = z.infer<
  typeof outboundTextInputSchema
>;
export type AppendTelegramOutboundVoiceInput = z.infer<
  typeof outboundVoiceInputSchema
>;

type ServerMutationResult = MutationResult<ServerDomainStatePayload>;
type ServerConversation = ServerDomainStatePayload["conversations"][number];
type ServerMessage = ServerConversation["messages"][number];

const VOICE_PENDING_TEXT = "Voice note awaiting transcription.";

function ok(state: ServerDomainStatePayload): ServerMutationResult {
  return {
    ok: true,
    state: serverDomainStateSchema.parse(state),
  };
}

function error(
  state: ServerDomainStatePayload,
  message: string,
): ServerMutationResult {
  return {
    ok: false,
    state: serverDomainStateSchema.parse(state),
    error: message,
  };
}

function languageName(languageCode: string | null): string {
  const primary = languageCode?.trim().toLowerCase().split(/[-_]/)[0];
  if (primary === "ms") {
    return "Malay";
  }
  if (primary === "zh") {
    return "Mandarin Chinese";
  }
  if (primary === "ta") {
    return "Tamil";
  }
  return "English";
}

function conversationId(externalConversationId: string): string {
  return `telegram-conversation:${externalConversationId}`;
}

export function telegramInboundMessageId(
  event: NormalizedInboundEvent,
): string {
  return `telegram-message:${event.externalConversationId}:${event.externalMessageId}`;
}

function createTelegramConversation(
  event: NormalizedInboundEvent,
  message: ServerMessage,
): ServerConversation {
  return {
    id: conversationId(event.externalConversationId),
    revision: 1,
    patient: {
      name: event.sender.displayName ?? "Telegram customer",
      phone: null,
      medicalRecordNumber: null,
      preferredLanguage: languageName(event.message.language),
      externalContactId: event.sender.externalId,
    },
    channel: "telegram",
    source: "telegram",
    externalConversationId: event.externalConversationId,
    latestAgentArtifactId: null,
    urgency: "routine",
    agentMode: "live_agent",
    workflowStatus: "in_progress",
    resolvedAt: null,
    labels: ["telegram"],
    messages: [message],
  };
}

export function mergeTelegramInboundText(
  state: ServerDomainStatePayload,
  input: NormalizedInboundTextEvent,
): ServerMutationResult {
  const current = serverDomainStateSchema.parse(state);
  const event = normalizedInboundEventSchema.parse(input);
  if (event.message.kind !== "text") {
    return error(current, "Telegram inbound event is not text");
  }
  const messageId = telegramInboundMessageId(event);
  const existingIndex = current.conversations.findIndex(
    (conversation) =>
      conversation.source === "telegram" &&
      conversation.externalConversationId === event.externalConversationId,
  );

  if (existingIndex >= 0) {
    const existing = current.conversations[existingIndex]!;
    if (existing.messages.some((message) => message.id === messageId)) {
      return ok(current);
    }
    current.conversations[existingIndex] = {
      ...existing,
      revision: existing.revision + 1,
      messages: [
        ...existing.messages,
        {
          id: messageId,
          role: "patient",
          text: event.message.text,
          language: languageName(event.message.language),
          sentAt: event.receivedAt,
        },
      ],
    };
    return ok(current);
  }

  current.conversations.unshift(
    createTelegramConversation(event, {
      id: messageId,
      role: "patient",
      text: event.message.text,
      language: languageName(event.message.language),
      sentAt: event.receivedAt,
    }),
  );
  return ok(current);
}

export function mergeTelegramInboundVoice(
  state: ServerDomainStatePayload,
  input: NormalizedInboundVoiceEvent,
): ServerMutationResult {
  const current = serverDomainStateSchema.parse(state);
  const event = normalizedInboundEventSchema.parse(input);
  if (event.message.kind !== "voice") {
    return error(current, "Telegram inbound event is not voice");
  }
  const messageId = telegramInboundMessageId(event);
  const existingIndex = current.conversations.findIndex(
    (conversation) =>
      conversation.source === "telegram" &&
      conversation.externalConversationId === event.externalConversationId,
  );
  const existingMessage =
    existingIndex >= 0 &&
    current.conversations[existingIndex]!.messages.some(
      (message) => message.id === messageId,
    );
  const existingArtifact = current.speechArtifacts.some(
    (artifact) => artifact.messageId === messageId,
  );
  if (existingMessage && existingArtifact) {
    return ok(current);
  }

  const message: ServerMessage = {
    id: messageId,
    role: "patient",
    text: VOICE_PENDING_TEXT,
    language: languageName(event.message.language),
    sentAt: event.receivedAt,
  };
  if (existingIndex >= 0) {
    const existing = current.conversations[existingIndex]!;
    current.conversations[existingIndex] = {
      ...existing,
      revision: existing.revision + 1,
      messages: existingMessage
        ? existing.messages
        : [...existing.messages, message],
    };
  } else {
    current.conversations.unshift(createTelegramConversation(event, message));
  }
  if (!existingArtifact) {
    current.speechArtifacts.push({
      messageId,
      telegramFileId: event.message.telegramFileId,
      status: "pending",
      detectedLanguage: null,
      originalTranscript: null,
      englishGloss: null,
      model: null,
      error: null,
    });
  }
  return ok(current);
}

function appendOutboundMessage(
  state: ServerDomainStatePayload,
  input: AppendTelegramOutboundTextInput | AppendTelegramOutboundVoiceInput,
  allowResolved: boolean,
): ServerMutationResult {
  const current = serverDomainStateSchema.parse(state);
  const voiceCandidate = outboundVoiceInputSchema.safeParse(input);
  const parsed = voiceCandidate.success
    ? voiceCandidate.data
    : outboundTextInputSchema.parse(input);
  const outboundVoice = voiceCandidate.success
    ? {
      deliveryId: voiceCandidate.data.deliveryId,
      source: voiceCandidate.data.voiceSource,
      spokenTextHash: voiceCandidate.data.spokenTextHash,
      }
    : undefined;
  const index = current.conversations.findIndex(
    (conversation) => conversation.id === parsed.conversationId,
  );
  if (index < 0) {
    return error(current, "Conversation not found");
  }
  const conversation = current.conversations[index]!;
  if (
    conversation.channel !== "telegram" ||
    conversation.source !== "telegram"
  ) {
    return error(current, "Conversation is not a Telegram conversation");
  }
  if (!allowResolved && conversation.workflowStatus === "resolved") {
    return error(current, "Cannot send to a resolved conversation");
  }
  if (
    conversation.messages.some((message) => message.id === parsed.messageId)
  ) {
    return ok(current);
  }

  current.conversations[index] = {
    ...conversation,
    revision: conversation.revision + 1,
    messages: [
      ...conversation.messages,
      {
        id: parsed.messageId,
        role: "staff",
        text: parsed.text,
        language: parsed.language,
        sentAt: parsed.sentAt,
        ...(outboundVoice ? { outboundVoice } : {}),
      },
    ],
  };
  return ok(current);
}

export function appendTelegramOutboundText(
  state: ServerDomainStatePayload,
  input: AppendTelegramOutboundTextInput,
): ServerMutationResult {
  return appendOutboundMessage(state, input, false);
}

export function linkAcceptedTelegramOutboundText(
  state: ServerDomainStatePayload,
  input: AppendTelegramOutboundTextInput,
): ServerMutationResult {
  return appendOutboundMessage(state, input, true);
}

export function linkAcceptedTelegramOutboundVoice(
  state: ServerDomainStatePayload,
  input: AppendTelegramOutboundVoiceInput,
): ServerMutationResult {
  return appendOutboundMessage(state, input, true);
}
