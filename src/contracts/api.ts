import { z } from "zod";

import { revisionSchema, serverDomainStateSchema } from "./app-state";
import { deliveryReceiptSchema, telegramVoiceSourceSchema } from "./channel";

export const API_ERROR_CODES = [
  "invalid_request",
  "not_found",
  "revision_conflict",
  "duplicate",
  "provider_timeout",
  "provider_failed",
  "feature_disabled",
  "release_blocked",
] as const;

export const requestIdSchema = z.string().min(1).max(128);
export const workspaceIdSchema = z.string().min(1).max(128);
export const apiErrorCodeSchema = z.enum(API_ERROR_CODES);

export const apiErrorSchema = z
  .object({
    code: apiErrorCodeSchema,
    error: z.string().min(1),
    retryable: z.boolean(),
  })
  .strict();

export const workspaceEnvelopeSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    revision: revisionSchema,
    state: serverDomainStateSchema,
  })
  .strict();

export const saveWorkspaceRequestSchema = z
  .object({
    expectedRevision: revisionSchema,
    state: serverDomainStateSchema,
  })
  .strict();

export const resetDemoRequestSchema = z
  .object({
    expectedRevision: revisionSchema,
  })
  .strict();

export const outboundSendRequestSchema = z
  .object({
    requestId: requestIdSchema,
    conversationId: z.string().min(1).max(128),
    expectedConversationRevision: revisionSchema,
    targetLanguage: z.string().trim().min(1).max(64),
    approvedPatientText: z.string().trim().min(1).max(4096),
    mode: z.enum(["text", "voice", "both"]),
    voiceSource: telegramVoiceSourceSchema.optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.mode === "text" && request.voiceSource !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["voiceSource"],
        message: "Text-only sends cannot select a voice source",
      });
    }
    if (request.mode !== "text" && request.voiceSource === undefined) {
      context.addIssue({
        code: "custom",
        path: ["voiceSource"],
        message: "Voice sends must select a voice source",
      });
    }
  });

const outboundVoicePreparationBaseSchema = z
  .object({
    requestId: requestIdSchema,
    conversationId: z.string().min(1).max(128),
    expectedConversationRevision: revisionSchema,
    targetLanguage: z.string().trim().min(1).max(64),
    approvedPatientText: z.string().trim().min(1).max(4096),
    source: telegramVoiceSourceSchema,
  })
  .strict();

export const outboundVoicePrepareRequestSchema =
  outboundVoicePreparationBaseSchema;

export const outboundVoicePrepareResultSchema = z
  .object({
    requestId: requestIdSchema,
    source: telegramVoiceSourceSchema,
    status: z.enum(["ready", "recording_required"]),
  })
  .strict();

export const outboundVoiceRecordingResultSchema = z
  .object({
    requestId: requestIdSchema,
    status: z.literal("ready"),
  })
  .strict();

export const translationRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(4096),
    sourceLanguage: z.string().trim().min(1).max(64).optional(),
    targetLanguage: z.string().trim().min(1).max(64),
  })
  .strict();

export const translationResultSchema = z
  .object({
    translatedText: z.string().trim().min(1).max(4096),
    targetLanguage: z.string().trim().min(1).max(64),
    model: z.string().trim().min(1).max(256),
  })
  .strict();

export const manualSpeechTranscriptRequestSchema = z
  .object({
    originalTranscript: z.string().trim().min(1).max(4096),
    detectedLanguage: z.string().trim().min(1).max(64),
    englishGloss: z.string().trim().min(1).max(4096).nullable().optional(),
  })
  .strict();

const outboundDeliveryIdsSchema = z.array(requestIdSchema).min(1).max(2);

export const outboundSendResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      deliveryIds: outboundDeliveryIdsSchema,
      status: z.literal("sent"),
      text: deliveryReceiptSchema.optional(),
      voice: deliveryReceiptSchema.optional(),
    })
    .strict()
    .superRefine((value, context) => {
      if (!value.text && !value.voice) {
        context.addIssue({
          code: "custom",
          message: "A sent delivery requires a provider receipt",
        });
      }
    }),
  z
    .object({
      deliveryIds: outboundDeliveryIdsSchema,
      status: z.literal("partial_failure"),
      text: deliveryReceiptSchema.optional(),
      voice: deliveryReceiptSchema.optional(),
      failedParts: z.array(z.enum(["text", "voice"])).min(1).max(2),
    })
    .strict()
    .superRefine((value, context) => {
      if (!value.text && !value.voice) {
        context.addIssue({
          code: "custom",
          message: "A partial delivery requires one provider receipt",
        });
      }
    }),
  z
    .object({
      deliveryIds: outboundDeliveryIdsSchema,
      status: z.literal("failed"),
      failedParts: z.array(z.enum(["text", "voice"])).min(1).max(2),
    })
    .strict(),
]);

export const outboundReconcileRequestSchema = z
  .object({
    expectedConversationRevision: revisionSchema,
  })
  .strict();

export const outboundReconcileResultSchema = z
  .object({
    deliveryId: requestIdSchema,
    workspaceSyncStatus: z.literal("synced"),
    workspaceRevision: revisionSchema,
  })
  .strict();

export const calendarDispatchRequestSchema = z
  .object({
    conversationId: z.string().min(1).max(128),
    expectedConversationRevision: revisionSchema,
  })
  .strict();

export const calendarDispatchResultSchema = z
  .object({
    requestId: requestIdSchema,
    status: z.literal("sent"),
    providerMessageId: z.string().min(1).max(128),
    providerAcceptedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const saveWorkspaceResultSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      workspace: workspaceEnvelopeSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      code: z.literal("revision_conflict"),
      workspace: workspaceEnvelopeSchema,
    })
    .strict(),
]);

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type WorkspaceEnvelope = z.infer<typeof workspaceEnvelopeSchema>;
export type SaveWorkspaceRequest = z.infer<typeof saveWorkspaceRequestSchema>;
export type ResetDemoRequest = z.infer<typeof resetDemoRequestSchema>;
export type OutboundSendRequest = z.infer<typeof outboundSendRequestSchema>;
export type OutboundSendResult = z.infer<typeof outboundSendResultSchema>;
export type OutboundVoicePrepareRequest = z.infer<
  typeof outboundVoicePrepareRequestSchema
>;
export type OutboundVoicePrepareResult = z.infer<
  typeof outboundVoicePrepareResultSchema
>;
export type OutboundVoiceRecordingResult = z.infer<
  typeof outboundVoiceRecordingResultSchema
>;
export type TranslationRequest = z.infer<typeof translationRequestSchema>;
export type TranslationResult = z.infer<typeof translationResultSchema>;
export type ManualSpeechTranscriptRequest = z.infer<
  typeof manualSpeechTranscriptRequestSchema
>;
export type OutboundReconcileRequest = z.infer<
  typeof outboundReconcileRequestSchema
>;
export type OutboundReconcileResult = z.infer<
  typeof outboundReconcileResultSchema
>;
export type CalendarDispatchRequest = z.infer<typeof calendarDispatchRequestSchema>;
export type CalendarDispatchResult = z.infer<typeof calendarDispatchResultSchema>;
export type SaveWorkspaceResult = z.infer<typeof saveWorkspaceResultSchema>;
