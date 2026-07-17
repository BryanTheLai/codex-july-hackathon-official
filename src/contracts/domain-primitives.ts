import { z } from "zod";

import {
  BOOKING_STATUSES,
  EVAL_CASE_SOURCE_KINDS,
  EVAL_CASE_TYPES,
  MESSAGE_ROLES,
} from "./constants";

export const revisionSchema = z.number().int().positive();

export const messageSchema = z.object({
  id: z.string(),
  role: z.enum(MESSAGE_ROLES),
  text: z.string(),
  gloss: z.string().optional(),
  language: z.string().optional(),
  sentAt: z.string(),
  outboundVoice: z
    .object({
      deliveryId: z.string().min(1).max(128),
      source: z.enum(["tts", "recorded"]),
      spokenTextHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    })
    .strict()
    .optional(),
});

export const bookingSchema = z.object({
  slotIso: z.string(),
  reason: z.string(),
  serviceAddress: z.string().trim().min(1).max(256).optional(),
  status: z.enum(BOOKING_STATUSES),
  revision: revisionSchema,
});

export const evalCaseTypeSchema = z.enum(EVAL_CASE_TYPES);

export const evalCaseSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal(EVAL_CASE_SOURCE_KINDS[0]),
    })
    .strict(),
  z
    .object({
      kind: z.literal(EVAL_CASE_SOURCE_KINDS[1]),
      conversationId: z.string().min(1),
      messageIds: z.array(z.string().min(1)).min(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal(EVAL_CASE_SOURCE_KINDS[2]),
    })
    .strict(),
  z
    .object({
      kind: z.literal(EVAL_CASE_SOURCE_KINDS[3]),
      conversationId: z.string().min(1),
      messageIds: z.array(z.string().min(1)).min(1),
      reason: z.string().trim().min(1).max(500),
    })
    .strict(),
]);
