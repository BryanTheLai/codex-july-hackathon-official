import { describe, expect, it } from "vitest";

import type { NormalizedInboundVoiceEvent } from "../../src/contracts/channel";
import {
  mergeTelegramInboundText,
  mergeTelegramInboundVoice,
} from "../../src/domain";
import { createServerStateFixture } from "../fixtures/server-state";

const inboundVoice: NormalizedInboundVoiceEvent = {
  channel: "telegram",
  externalEventId: "1001",
  externalConversationId: "-10042",
  externalMessageId: "88",
  sender: {
    externalId: "42",
    displayName: "Aina Zulkifli",
  },
  message: {
    kind: "voice",
    telegramFileId: "voice-1",
    language: "ms",
  },
  receivedAt: "2026-07-13T12:00:00.000Z",
};

describe("Telegram inbound voice aggregate mutation", () => {
  it("does not mutate caller-owned state while merging inbound voice", () => {
    const state = createServerStateFixture();
    const before = structuredClone(state);

    mergeTelegramInboundVoice(state, inboundVoice);

    expect(state).toEqual(before);
  });

  it("creates one patient message and one pending speech artifact atomically", () => {
    const result = mergeTelegramInboundVoice(
      createServerStateFixture(),
      inboundVoice,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.state.conversations[0]).toMatchObject({
      id: "telegram-conversation:-10042",
      revision: 1,
      channel: "telegram",
      source: "telegram",
      messages: [
        {
          id: "telegram-message:-10042:88",
          role: "patient",
          text: "Voice note awaiting transcription.",
          language: "Malay",
          sentAt: "2026-07-13T12:00:00.000Z",
        },
      ],
    });
    expect(result.state.speechArtifacts).toEqual([
      {
        messageId: "telegram-message:-10042:88",
        telegramFileId: "voice-1",
        status: "pending",
        detectedLanguage: null,
        originalTranscript: null,
        englishGloss: null,
        model: null,
        error: null,
      },
    ]);
  });

  it("deduplicates the same voice message and appends later voice to the thread", () => {
    const created = mergeTelegramInboundVoice(
      createServerStateFixture(),
      inboundVoice,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    expect(mergeTelegramInboundVoice(created.state, inboundVoice)).toEqual(
      created,
    );

    const later = mergeTelegramInboundVoice(created.state, {
      ...inboundVoice,
      externalEventId: "1002",
      externalMessageId: "89",
      message: {
        ...inboundVoice.message,
        telegramFileId: "voice-2",
      },
      receivedAt: "2026-07-13T12:02:00.000Z",
    });
    expect(later.ok).toBe(true);
    if (!later.ok) {
      return;
    }
    expect(later.state.conversations[0]).toMatchObject({
      revision: 2,
      messages: [
        { id: "telegram-message:-10042:88" },
        { id: "telegram-message:-10042:89" },
      ],
    });
    expect(later.state.speechArtifacts).toEqual([
      expect.objectContaining({
        messageId: "telegram-message:-10042:88",
        telegramFileId: "voice-1",
      }),
      expect.objectContaining({
        messageId: "telegram-message:-10042:89",
        telegramFileId: "voice-2",
      }),
    ]);
  });

  it("repairs a pending artifact when the message is already durable", () => {
    const messageOnly = mergeTelegramInboundText(
      createServerStateFixture(),
      {
        ...inboundVoice,
        message: {
          kind: "text",
          text: "Voice note awaiting transcription.",
          language: "ms",
        },
      },
    );
    expect(messageOnly.ok).toBe(true);
    if (!messageOnly.ok) {
      return;
    }

    const repaired = mergeTelegramInboundVoice(messageOnly.state, inboundVoice);

    expect(repaired.ok).toBe(true);
    if (!repaired.ok) {
      return;
    }
    expect(repaired.state.conversations[0]).toMatchObject({
      revision: 2,
      messages: [{ id: "telegram-message:-10042:88" }],
    });
    expect(repaired.state.speechArtifacts).toEqual([
      expect.objectContaining({
        messageId: "telegram-message:-10042:88",
        telegramFileId: "voice-1",
        status: "pending",
      }),
    ]);
  });
});
