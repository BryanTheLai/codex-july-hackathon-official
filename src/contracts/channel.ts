import { z } from "zod";

const externalIdSchema = z.string().min(1).max(128);
const providerTextSchema = z.string().trim().min(1).max(4096);
const telegramFileIdSchema = z.string().trim().min(1).max(512);
const timestampSchema = z.iso.datetime({ offset: true });
const providerLanguageSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .nullable();

const normalizedInboundMessageSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("text"),
      text: providerTextSchema,
      language: providerLanguageSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("voice"),
      telegramFileId: telegramFileIdSchema,
      language: providerLanguageSchema,
    })
    .strict(),
]);

export const normalizedInboundEventSchema = z
  .object({
    channel: z.literal("telegram"),
    externalEventId: externalIdSchema,
    externalConversationId: externalIdSchema,
    externalMessageId: externalIdSchema,
    sender: z
      .object({
        externalId: externalIdSchema,
        displayName: z.string().trim().min(1).max(256).nullable(),
      })
      .strict(),
    message: normalizedInboundMessageSchema,
    receivedAt: timestampSchema,
  })
  .strict();

export const deliveryReceiptSchema = z
  .object({
    providerMessageId: externalIdSchema,
    acceptedAt: timestampSchema,
  })
  .strict();

export const telegramVoiceSourceSchema = z.enum(["tts", "recorded"]);

export const telegramVoicePayloadSchema = z
  .object({
    bytes: z.instanceof(Uint8Array<ArrayBufferLike>).refine((value) => value.byteLength > 0, {
      message: "Voice payload must not be empty",
    }),
    contentType: z.literal("audio/ogg"),
    filename: z.string().trim().min(1).max(128),
  })
  .strict();

export type NormalizedInboundEvent = z.infer<
  typeof normalizedInboundEventSchema
>;
export type NormalizedInboundTextEvent = Omit<
  NormalizedInboundEvent,
  "message"
> & {
  message: Extract<
    NormalizedInboundEvent["message"],
    { kind: "text" }
  >;
};
export type NormalizedInboundVoiceEvent = Omit<
  NormalizedInboundEvent,
  "message"
> & {
  message: Extract<
    NormalizedInboundEvent["message"],
    { kind: "voice" }
  >;
};
export type DeliveryReceipt = z.infer<typeof deliveryReceiptSchema>;
export type TelegramVoiceSource = z.infer<typeof telegramVoiceSourceSchema>;
export type TelegramVoicePayload = {
  bytes: Uint8Array<ArrayBufferLike>;
  contentType: "audio/ogg";
  filename: string;
};

export interface ChannelAdapter {
  normalizeInbound(payload: unknown): NormalizedInboundEvent | null;
  sendText(
    target: string,
    text: string,
    idempotencyKey: string,
  ): Promise<DeliveryReceipt>;
  sendVoice(
    target: string,
    voice: TelegramVoicePayload,
    idempotencyKey: string,
  ): Promise<DeliveryReceipt>;
}
