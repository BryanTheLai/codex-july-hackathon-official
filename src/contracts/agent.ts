import { z } from "zod";

import {
  bookingSchema,
  messageSchema,
  revisionSchema,
} from "./domain-primitives";

export const AGENT_RUN_MODES = ["live", "sandbox"] as const;
export const DEMO_TOOL_POLICY_VERSION = "demo-no-tools-v1" as const;
export const AUTONOMOUS_BOOKING_TOOL_POLICY_VERSION =
  "autonomous-booking-v1" as const;
export const AGENT_TOOL_POLICY_VERSIONS = [
  DEMO_TOOL_POLICY_VERSION,
  AUTONOMOUS_BOOKING_TOOL_POLICY_VERSION,
] as const;
export const AGENT_PROPOSED_ACTIONS = [
  "reply",
  "staff_handoff",
] as const;
export const AGENT_STOP_REASONS = [
  "completed",
  "handoff",
  "blocked",
] as const;

const idSchema = z.string().trim().min(1).max(200);
const textSchema = z.string().trim().min(1).max(8_000);
const concisePatientReplySchema = z.string().trim().min(1).max(280);
const languageSchema = z.string().trim().min(1).max(100);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const agentPlaybookVersionSchema = z
  .object({
    fileId: idSchema,
    versionId: idSchema,
    contentHash: sha256Schema,
    content: z.string().min(1),
  })
  .strict();

export const agentPlaybookBundleSchema = z
  .object({
    versions: z.array(agentPlaybookVersionSchema).min(1).max(50),
    bundleHash: sha256Schema,
  })
  .strict()
  .superRefine((bundle, context) => {
    const fileIds = bundle.versions.map((version) => version.fileId);
    if (new Set(fileIds).size !== fileIds.length) {
      context.addIssue({
        code: "custom",
        message: "Playbook file identifiers must be unique",
        path: ["versions"],
      });
    }
  });

export const agentRunRequestSchema = z
  .object({
    mode: z.enum(AGENT_RUN_MODES),
    conversation: z
      .object({
        id: idSchema,
        revision: revisionSchema,
        messages: z
          .array(
            messageSchema
              .extend({
                id: idSchema,
                text: textSchema,
                language: languageSchema.optional(),
              })
              .strict(),
          )
          .min(1)
          .max(50),
      })
      .strict(),
    patientContext: z
      .object({
        preferredLanguage: languageSchema,
      })
      .strict(),
    bookingContext: bookingSchema.strict().nullable(),
    playbookBundle: agentPlaybookBundleSchema,
    agentConfigVersion: idSchema,
    promptVersion: idSchema,
    toolPolicyVersion: z.enum(AGENT_TOOL_POLICY_VERSIONS),
  })
  .strict();

export const agentDraftSchema = z
  .object({
    englishText: textSchema,
    patientLanguage: languageSchema,
    patientText: concisePatientReplySchema,
  })
  .strict();

export const agentEvidenceSchema = z
  .object({
    fileId: idSchema,
    versionId: idSchema,
    contentHash: sha256Schema,
    excerpt: textSchema,
  })
  .strict();

const providerAgentResultFields = {
  draft: agentDraftSchema,
  proposedAction: z.enum(AGENT_PROPOSED_ACTIONS),
  handoffReason: z.string().trim().min(1).max(2_000).nullable(),
  evidence: z.array(agentEvidenceSchema).max(50),
};

function validateHandoff(
  result: {
    proposedAction: (typeof AGENT_PROPOSED_ACTIONS)[number];
    handoffReason: string | null;
  },
  context: z.RefinementCtx,
): void {
  if (
    (result.proposedAction === "staff_handoff") !==
    (result.handoffReason !== null)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Staff handoff requires a reason and reply requires a null handoff reason",
      path: ["handoffReason"],
    });
  }
}

export const providerAgentResultSchema = z
  .object(providerAgentResultFields)
  .strict()
  .superRefine(validateHandoff);

const agentUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((usage, context) => {
    if (usage.totalTokens !== usage.inputTokens + usage.outputTokens) {
      context.addIssue({
        code: "custom",
        message: "Total tokens must equal input plus output tokens",
        path: ["totalTokens"],
      });
    }
  });

export const agentToolCallSchema = z
  .object({
    callId: idSchema,
    name: idSchema,
    status: z.enum(["completed", "failed"]),
    summary: z.string().trim().min(1).max(500),
    conversationRevision: revisionSchema.nullable(),
    evalCaseId: idSchema.optional(),
  })
  .strict();

export const agentRunResultSchema = z
  .object({
    runId: idSchema,
    ...providerAgentResultFields,
    toolCalls: z.array(agentToolCallSchema).max(12),
    stopReason: z.enum(AGENT_STOP_REASONS),
    usage: agentUsageSchema,
    latencyMs: z.number().nonnegative(),
  })
  .strict()
  .superRefine(validateHandoff);

export const agentRunCreateRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("manual"),
      conversationId: idSchema,
      expectedConversationRevision: revisionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("retry"),
      conversationId: idSchema,
      expectedConversationRevision: revisionSchema,
      previousRunId: idSchema,
    })
    .strict(),
]);

export type AgentRunMode = z.infer<typeof agentRunRequestSchema>["mode"];
export type AgentPlaybookVersion = z.infer<
  typeof agentPlaybookVersionSchema
>;
export type AgentPlaybookBundle = z.infer<
  typeof agentPlaybookBundleSchema
>;
export type AgentRunRequest = z.infer<typeof agentRunRequestSchema>;
export type AgentDraft = z.infer<typeof agentDraftSchema>;
export type AgentEvidence = z.infer<typeof agentEvidenceSchema>;
export type ProviderAgentResult = z.infer<
  typeof providerAgentResultSchema
>;
export type AgentToolCall = z.infer<typeof agentToolCallSchema>;
export type AgentRunResult = z.infer<typeof agentRunResultSchema>;
export type AgentRunCreateRequest = z.infer<
  typeof agentRunCreateRequestSchema
>;
