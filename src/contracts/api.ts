import { z } from "zod";

import { revisionSchema, serverDomainStateSchema } from "./app-state";
import { deliveryReceiptSchema } from "./channel";

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
    mode: z.literal("text"),
  })
  .strict();

const outboundDeliveryIdsSchema = z.array(requestIdSchema).min(1).max(2);

export const outboundSendResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      deliveryIds: outboundDeliveryIdsSchema,
      status: z.literal("sent"),
      text: deliveryReceiptSchema,
    })
    .strict(),
  z
    .object({
      deliveryIds: outboundDeliveryIdsSchema,
      status: z.literal("partial_failure"),
      text: deliveryReceiptSchema,
    })
    .strict(),
  z
    .object({
      deliveryIds: outboundDeliveryIdsSchema,
      status: z.literal("failed"),
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
export type OutboundReconcileRequest = z.infer<
  typeof outboundReconcileRequestSchema
>;
export type OutboundReconcileResult = z.infer<
  typeof outboundReconcileResultSchema
>;
export type SaveWorkspaceResult = z.infer<typeof saveWorkspaceResultSchema>;
