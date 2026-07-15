import { describe, expect, it } from "vitest";

import {
  beginTelegramSpeechTranscription,
  completeTelegramSpeechTranscription,
  failTelegramSpeechTranscription,
  mergeTelegramInboundVoice,
} from "../../src/domain";
import { createServerStateFixture } from "../fixtures/server-state";

function pendingSpeechState() {
  const merged = mergeTelegramInboundVoice(createServerStateFixture(), {
    channel: "telegram",
    externalEventId: "1002",
    externalConversationId: "-10042",
    externalMessageId: "89",
    sender: { externalId: "42", displayName: "Aina Zulkifli" },
    message: { kind: "voice", telegramFileId: "voice-1", language: "ms" },
    receivedAt: "2026-07-13T12:00:00.000Z",
  });
  if (!merged.ok) {
    throw new Error(merged.error);
  }
  return merged.state;
}

describe("Telegram speech state", () => {
  it("replaces the voice placeholder with an original transcript and English gloss", () => {
    const messageId = "telegram-message:-10042:89";
    const transcribing = beginTelegramSpeechTranscription({
      state: pendingSpeechState(),
      messageId,
      model: "whisper-1",
    });
    const completed = completeTelegramSpeechTranscription({
      state: transcribing,
      messageId,
      model: "whisper-1",
      detectedLanguage: "Malay",
      originalTranscript: "Saya mahu buat temujanji.",
      englishGloss: "I would like to make an appointment.",
    });

    expect(completed.speechArtifacts).toEqual([
      expect.objectContaining({
        status: "ready",
        originalTranscript: "Saya mahu buat temujanji.",
        englishGloss: "I would like to make an appointment.",
      }),
    ]);
    expect(completed.conversations[0]?.messages.at(-1)).toEqual(
      expect.objectContaining({
        id: messageId,
        text: "Saya mahu buat temujanji.",
        gloss: "I would like to make an appointment.",
      }),
    );
  });

  it("keeps a partial original transcript visible when translation fails", () => {
    const messageId = "telegram-message:-10042:89";
    const failed = failTelegramSpeechTranscription({
      state: beginTelegramSpeechTranscription({
        state: pendingSpeechState(),
        messageId,
        model: "whisper-1",
      }),
      messageId,
      model: "whisper-1",
      error: "Speech transcription failed. Refresh the Telegram inbox and retry the voice note.",
      detectedLanguage: "Malay",
      originalTranscript: "Saya mahu buat temujanji.",
    });

    expect(failed.speechArtifacts[0]).toEqual(
      expect.objectContaining({ status: "failed", englishGloss: null }),
    );
    expect(failed.conversations[0]?.messages.at(-1)).toEqual(
      expect.objectContaining({ text: "Saya mahu buat temujanji." }),
    );
  });
});
