import { describe, expect, it } from "vitest";

import type { NormalizedInboundTextEvent } from "../../src/contracts/channel";
import {
  appendTelegramOutboundText,
  linkAcceptedTelegramOutboundVoice,
  linkAcceptedTelegramOutboundText,
  mergeTelegramInboundText,
} from "../../src/domain";
import { createServerStateFixture } from "../fixtures/server-state";

const firstInbound: NormalizedInboundTextEvent = {
  channel: "telegram",
  externalEventId: "1001",
  externalConversationId: "-10042",
  externalMessageId: "88",
  sender: {
    externalId: "42",
    displayName: "Aina Zulkifli",
  },
  message: {
    kind: "text",
    text: "Boleh saya buat temujanji?",
    language: "ms",
  },
  receivedAt: "2026-07-13T12:00:00.000Z",
};

describe("Telegram aggregate mutations", () => {
  it("does not mutate caller-owned state while merging inbound text", () => {
    const state = createServerStateFixture();
    const before = structuredClone(state);

    mergeTelegramInboundText(state, firstInbound);

    expect(state).toEqual(before);
  });

  it("creates one Telegram conversation with safe defaults and a deterministic message", () => {
    const result = mergeTelegramInboundText(
      createServerStateFixture(),
      firstInbound,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const conversation = result.state.conversations.find(
      (item) => item.externalConversationId === "-10042",
    );
    expect(conversation).toMatchObject({
      id: "telegram-conversation:-10042",
      revision: 1,
      channel: "telegram",
      source: "telegram",
      externalConversationId: "-10042",
      patient: {
        name: "Aina Zulkifli",
        phone: null,
        medicalRecordNumber: null,
        preferredLanguage: "Malay",
        externalContactId: "42",
      },
      urgency: "routine",
      agentMode: "live_agent",
      workflowStatus: "in_progress",
      resolvedAt: null,
      labels: ["telegram"],
      latestAgentArtifactId: null,
      messages: [
        {
          id: "telegram-message:-10042:88",
          role: "patient",
          text: "Boleh saya buat temujanji?",
          language: "Malay",
          sentAt: "2026-07-13T12:00:00.000Z",
        },
      ],
    });
  });

  it("deduplicates the same message and appends later text to the same conversation", () => {
    const created = mergeTelegramInboundText(
      createServerStateFixture(),
      firstInbound,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const duplicate = mergeTelegramInboundText(created.state, firstInbound);
    expect(duplicate).toEqual(created);

    const later = mergeTelegramInboundText(created.state, {
      ...firstInbound,
      externalEventId: "1002",
      externalMessageId: "89",
      message: {
        ...firstInbound.message,
        text: "Hari Selasa boleh?",
      },
      receivedAt: "2026-07-13T12:02:00.000Z",
    });
    expect(later.ok).toBe(true);
    if (!later.ok) {
      return;
    }
    const conversations = later.state.conversations.filter(
      (item) => item.externalConversationId === "-10042",
    );
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({
      revision: 2,
      messages: [
        { id: "telegram-message:-10042:88" },
        { id: "telegram-message:-10042:89", text: "Hari Selasa boleh?" },
      ],
    });
  });

  it("defaults missing and unknown Telegram language codes to English", () => {
    for (const language of [null, "xx"]) {
      const result = mergeTelegramInboundText(
        createServerStateFixture(),
        {
          ...firstInbound,
          message: {
            ...firstInbound.message,
            language,
          },
        },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) {
        continue;
      }
      expect(
        result.state.conversations[0]?.patient.preferredLanguage,
      ).toBe("English");
      expect(
        result.state.conversations[0]?.messages[0]?.language,
      ).toBe("English");
    }
  });

  it("appends one provider-accepted staff message and deduplicates reconciliation", () => {
    const created = mergeTelegramInboundText(
      createServerStateFixture(),
      firstInbound,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const input = {
      conversationId: "telegram-conversation:-10042",
      messageId: "telegram-delivery:send-42:text",
      text: "Klinik akan menghubungi anda.",
      language: "Malay",
      sentAt: "2026-07-13T12:03:00.000Z",
    };

    const sent = appendTelegramOutboundText(created.state, input);
    expect(sent.ok).toBe(true);
    if (!sent.ok) {
      return;
    }
    expect(
      sent.state.conversations.find(
        (conversation) => conversation.id === input.conversationId,
      ),
    ).toMatchObject({
      revision: 2,
      messages: [
        { id: "telegram-message:-10042:88", role: "patient" },
        {
          id: input.messageId,
          role: "staff",
          text: input.text,
          language: "Malay",
          sentAt: input.sentAt,
        },
      ],
    });

    expect(appendTelegramOutboundText(sent.state, input)).toEqual(sent);
  });

  it("links an accepted outbound voice with its durable playback identity", () => {
    const created = mergeTelegramInboundText(
      createServerStateFixture(),
      firstInbound,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const sent = linkAcceptedTelegramOutboundVoice(created.state, {
      conversationId: "telegram-conversation:-10042",
      messageId: "telegram-delivery:voice-42:voice",
      deliveryId: "voice-42",
      text: "AI-generated voice reply.",
      language: "Malay",
      sentAt: "2026-07-13T12:03:00.000Z",
      voiceSource: "tts",
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) {
      return;
    }
    expect(sent.state.conversations[0]?.messages.at(-1)).toMatchObject({
      id: "telegram-delivery:voice-42:voice",
      role: "staff",
      outboundVoice: { deliveryId: "voice-42", source: "tts" },
    });
    expect(
      linkAcceptedTelegramOutboundVoice(sent.state, {
        conversationId: "telegram-conversation:-10042",
        messageId: "telegram-delivery:voice-42:voice",
        deliveryId: "voice-42",
        text: "AI-generated voice reply.",
        language: "Malay",
        sentAt: "2026-07-13T12:03:00.000Z",
        voiceSource: "tts",
      }),
    ).toEqual(sent);
  });

  it("rejects outbound text for missing, synthetic, and resolved conversations", () => {
    const state = createServerStateFixture();
    const baseInput = {
      conversationId: "missing",
      messageId: "telegram-delivery:send-42:text",
      text: "Approved text",
      language: "English",
      sentAt: "2026-07-13T12:03:00.000Z",
    };

    expect(appendTelegramOutboundText(state, baseInput)).toMatchObject({
      ok: false,
      error: "Conversation not found",
    });
    expect(
      appendTelegramOutboundText(state, {
        ...baseInput,
        conversationId: state.conversations[0]!.id,
      }),
    ).toMatchObject({
      ok: false,
      error: "Conversation is not a Telegram conversation",
    });

    const created = mergeTelegramInboundText(state, firstInbound);
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const resolved = structuredClone(created.state);
    const conversation = resolved.conversations.find(
      (item) => item.id === "telegram-conversation:-10042",
    )!;
    conversation.workflowStatus = "resolved";
    conversation.resolvedAt = "2026-07-13T12:02:00.000Z";

    expect(
      appendTelegramOutboundText(resolved, {
        ...baseInput,
        conversationId: conversation.id,
      }),
    ).toMatchObject({
      ok: false,
      error: "Cannot send to a resolved conversation",
    });

    const linked = linkAcceptedTelegramOutboundText(resolved, {
      ...baseInput,
      conversationId: conversation.id,
    });
    expect(linked.ok).toBe(true);
    if (linked.ok) {
      expect(
        linked.state.conversations
          .find((item) => item.id === conversation.id)
          ?.messages.at(-1),
      ).toMatchObject({
        id: baseInput.messageId,
        role: "staff",
        text: baseInput.text,
      });
    }
  });
});
