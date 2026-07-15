import { describe, expect, it } from "vitest";

import {
  deliveryReceiptSchema,
  normalizedInboundEventSchema,
} from "../../src/contracts/channel";

const inboundText = {
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
} as const;

const inboundVoice = {
  ...inboundText,
  externalEventId: "1002",
  externalMessageId: "89",
  message: {
    kind: "voice",
    telegramFileId: "telegram-voice-file-1",
    language: "ms",
  },
} as const;

describe("channel contracts", () => {
  it("validates one normalized Telegram text event", () => {
    expect(normalizedInboundEventSchema.parse(inboundText)).toEqual(inboundText);
  });

  it("validates one bounded Telegram voice event without raw provider data", () => {
    expect(
      normalizedInboundEventSchema.parse(inboundVoice),
    ).toEqual(inboundVoice);
    expect(
      normalizedInboundEventSchema.safeParse({
        ...inboundVoice,
        message: {
          ...inboundVoice.message,
          telegramFileId: "",
        },
      }).success,
    ).toBe(false);
    expect(
      normalizedInboundEventSchema.safeParse({
        ...inboundVoice,
        message: {
          ...inboundVoice.message,
          voice: { file_id: "private-provider-payload" },
        },
      }).success,
    ).toBe(false);
  });

  it("rejects blank, oversized, malformed, and extended inbound messages", () => {
    expect(
      normalizedInboundEventSchema.safeParse({
        ...inboundText,
        message: { ...inboundText.message, text: "" },
      }).success,
    ).toBe(false);
    expect(
      normalizedInboundEventSchema.safeParse({
        ...inboundText,
        message: { ...inboundText.message, text: "x".repeat(4097) },
      }).success,
    ).toBe(false);
    expect(
      normalizedInboundEventSchema.safeParse({
        ...inboundText,
        receivedAt: "not-a-time",
      }).success,
    ).toBe(false);
    expect(
      normalizedInboundEventSchema.safeParse({
        ...inboundText,
        providerPayload: { secret: true },
      }).success,
    ).toBe(false);
  });

  it("validates a bounded provider delivery receipt", () => {
    const receipt = {
      providerMessageId: "9001",
      acceptedAt: "2026-07-13T12:01:00.000Z",
    };

    expect(deliveryReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(
      deliveryReceiptSchema.safeParse({
        ...receipt,
        providerMessageId: "",
      }).success,
    ).toBe(false);
    expect(
      deliveryReceiptSchema.safeParse({
        ...receipt,
        acceptedAt: "not-a-time",
      }).success,
    ).toBe(false);
  });
});
