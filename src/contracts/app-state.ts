import { z } from "zod";

import {
  AGENT_MODES,
  CORRECTION_STATUSES,
  EVAL_SPLITS,
  EVAL_VERDICTS,
  LEGACY_SEED_EVAL_CASE_IDS,
  SCHEMA_VERSION,
  SEED_EVAL_CASE_IDS,
  URGENCY_LEVELS,
  WORKFLOW_STATUSES,
} from "./constants";
import {
  bookingSchema,
  evalCaseSourceSchema,
  evalCaseTypeSchema,
  messageSchema,
  revisionSchema,
} from "./domain-primitives";
import { evalArtifactStateSchema } from "./eval";
import {
  judgeCriterionResultSchema,
  judgeMetadataSchema,
  judgeRationaleSchema,
  judgeScoreSchema,
} from "./judge";
import { inboundSpeechArtifactSchema } from "./speech";

export {
  bookingSchema,
  evalCaseSourceSchema,
  evalCaseTypeSchema,
  messageSchema,
  revisionSchema,
} from "./domain-primitives";
export { inboundSpeechArtifactSchema } from "./speech";

export const patientSchema = z.object({
  name: z.string(),
  phone: z.string(),
  medicalRecordNumber: z.string(),
  preferredLanguage: z.string(),
});

export const conversationFields = {
  id: z.string(),
  patient: patientSchema,
  channel: z.string(),
  urgency: z.enum(URGENCY_LEVELS),
  agentMode: z.enum(AGENT_MODES),
  workflowStatus: z.enum(WORKFLOW_STATUSES),
  resolvedAt: z.string().nullable(),
  labels: z.array(z.string()),
  triageGuidance: z.string().optional(),
  messages: z.array(messageSchema),
};

const conversationObjectSchema = z.object({
  ...conversationFields,
  booking: bookingSchema.optional(),
});

export const conversationSchema = conversationObjectSchema.superRefine(
  (conversation, context) => {
    if (
      (conversation.workflowStatus === "resolved") !==
      (conversation.resolvedAt !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["resolvedAt"],
        message: "Resolved conversations require resolvedAt and active conversations forbid it",
      });
    }
  },
);

export const playbookSchema = z.object({
  id: z.string(),
  path: z.string(),
  title: z.string(),
  savedContent: z.string(),
  draft: z.string().optional(),
  updatedAt: z.string(),
  protected: z.boolean(),
});

export const correctionSchema = z.object({
  id: z.string(),
  fileId: z.string(),
  oldText: z.string(),
  newText: z.string(),
  evidence: z.string(),
  status: z.enum(CORRECTION_STATUSES),
  sourceCaseId: z.string().optional(),
  lineHint: z.number().optional(),
});

export const criterionSchema = z.object({
  id: z.string(),
  label: z.string(),
  instruction: z.string(),
  required: z.boolean(),
  caseTypes: z.array(evalCaseTypeSchema).optional(),
  knowledgeFileIds: z.array(z.string()).min(1).optional(),
  examples: z
    .object({
      good: z.string().optional(),
      bad: z.string().optional(),
    })
    .optional(),
  version: z.number().int().positive(),
});

export const criterionResultSchema = judgeCriterionResultSchema;
export { judgeMetadataSchema };

export const gradeSchema = z
  .object({
    pass: z.boolean(),
    verdict: z.enum(EVAL_VERDICTS),
    judgeScore: judgeScoreSchema,
    rationale: judgeRationaleSchema,
    criterionResults: z.array(criterionResultSchema).min(1).max(20),
    metadata: judgeMetadataSchema,
  })
  .strict()
  .superRefine((grade, context) => {
    if (grade.pass !== (grade.verdict === "pass")) {
      context.addIssue({
        code: "custom",
        path: ["pass"],
        message: "Grade pass must match the verdict",
      });
    }
  });

const syntheticEvalCaseIds = new Set<string>([
  ...SEED_EVAL_CASE_IDS,
  ...LEGACY_SEED_EVAL_CASE_IDS,
]);

const evalCaseObjectSchema = z.object({
  id: z.string(),
  title: z.string(),
  split: z.enum(EVAL_SPLITS),
  type: evalCaseTypeSchema,
  language: z.string(),
  inputConversation: z.object({ messages: z.array(messageSchema) }),
  expectedHumanOutput: z.string(),
  criterionIds: z.array(z.string()),
  source: evalCaseSourceSchema.optional(),
  sourceConversationId: z.string().optional(),
  actualSyntheticOutput: z.string().optional(),
  grade: gradeSchema.optional(),
});

export const evalCaseSchema = evalCaseObjectSchema
  .superRefine((evalCase, context) => {
    if (
      evalCase.sourceConversationId &&
      evalCase.source &&
      (evalCase.source.kind !== "hitl" ||
        evalCase.source.conversationId !== evalCase.sourceConversationId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceConversationId"],
        message: "Legacy HITL conversation ID must match case provenance",
      });
    }
  })
  .transform((evalCase) => ({
    ...evalCase,
    source:
      evalCase.source ??
      (evalCase.sourceConversationId
        ? {
            kind: "hitl" as const,
            conversationId: evalCase.sourceConversationId,
          }
        : syntheticEvalCaseIds.has(evalCase.id)
          ? { kind: "seed" as const }
          : { kind: "manual" as const }),
  }));

export const suiteSnapshotSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  overallPassPercent: z.number(),
  trainPassPercent: z.number(),
  holdoutPassPercent: z.number(),
  meanJudgeScore: z.number(),
});

export const runHistorySchema = z.object({
  id: z.string(),
  caseId: z.string(),
  datasetId: z.string(),
  ranAt: z.string(),
  candidateVersion: z.number(),
  pass: z.boolean(),
  verdict: z.enum(EVAL_VERDICTS),
  judgeScore: z.number(),
});

export const datasetFields = {
  id: z.string(),
  name: z.string(),
  protected: z.boolean(),
  candidateVersion: z.number(),
};

export const datasetSchema = z.object({
  ...datasetFields,
  criteria: z.array(criterionSchema),
  cases: z.array(evalCaseSchema),
  suiteSnapshots: z.array(suiteSnapshotSchema),
  runHistory: z.array(runHistorySchema),
}).superRefine((dataset, context) => {
  const criterionIds = new Set<string>();
  dataset.criteria.forEach((criterion, index) => {
    if (criterionIds.has(criterion.id)) {
      context.addIssue({
        code: "custom",
        path: ["criteria", index, "id"],
        message: "Criterion IDs must be unique within a dataset",
      });
    }
    criterionIds.add(criterion.id);
  });
  const caseIds = new Set<string>();
  dataset.cases.forEach((evalCase, index) => {
    if (caseIds.has(evalCase.id)) {
      context.addIssue({
        code: "custom",
        path: ["cases", index, "id"],
        message: "Eval case IDs must be unique within a dataset",
      });
    }
    caseIds.add(evalCase.id);
    evalCase.criterionIds.forEach((criterionId, criterionIndex) => {
      if (!criterionIds.has(criterionId)) {
        context.addIssue({
          code: "custom",
          path: ["cases", index, "criterionIds", criterionIndex],
          message: "Eval case criterion must reference this dataset",
        });
      }
    });
    evalCase.grade?.criterionResults.forEach((result, resultIndex) => {
      if (!evalCase.criterionIds.includes(result.criterionId)) {
        context.addIssue({
          code: "custom",
          path: ["cases", index, "grade", "criterionResults", resultIndex, "criterionId"],
          message: "Grade criterion must reference the evaluated case",
        });
      }
    });
  });
  const runIds = new Set<string>();
  dataset.runHistory.forEach((run, index) => {
    if (runIds.has(run.id)) {
      context.addIssue({
        code: "custom",
        path: ["runHistory", index, "id"],
        message: "Eval run IDs must be unique within a dataset",
      });
    }
    runIds.add(run.id);
    if (run.datasetId !== dataset.id) {
      context.addIssue({
        code: "custom",
        path: ["runHistory", index, "datasetId"],
        message: "Eval run must reference its containing dataset",
      });
    }
    if (!caseIds.has(run.caseId)) {
      context.addIssue({
        code: "custom",
        path: ["runHistory", index, "caseId"],
        message: "Eval run must reference a case in this dataset",
      });
    }
  });
});

const domainStateFields = {
  schemaVersion: z.literal(SCHEMA_VERSION),
  fixtureTime: z.string(),
  conversations: z.array(conversationSchema),
  playbookFolders: z.array(z.string()).default(["playbooks", "playbooks/data"]),
  playbookFiles: z.array(playbookSchema),
  corrections: z.array(correctionSchema),
  evalDatasets: z.array(datasetSchema),
};

function validateKnowledgeFileReferences(
  state: {
    playbookFiles: Array<{ id: string }>;
    evalDatasets: Array<{ criteria: Array<{ knowledgeFileIds?: string[] }> }>;
  },
  context: z.RefinementCtx,
) {
  const playbookFileIds = new Set(state.playbookFiles.map((file) => file.id));
  state.evalDatasets.forEach((dataset, datasetIndex) => {
    dataset.criteria.forEach((criterion, criterionIndex) => {
      criterion.knowledgeFileIds?.forEach((fileId, fileIndex) => {
        if (!playbookFileIds.has(fileId)) {
          context.addIssue({
            code: "custom",
            message: "Criterion Knowledge link must reference a playbook file",
            path: [
              "evalDatasets",
              datasetIndex,
              "criteria",
              criterionIndex,
              "knowledgeFileIds",
              fileIndex,
            ],
          });
        }
      });
    });
  });
}

const domainStateObjectSchema = z.object(domainStateFields);
export const domainStateSchema = domainStateObjectSchema.superRefine(
  validateKnowledgeFileReferences,
);

export const serverPatientSchema = patientSchema
  .extend({
    phone: z.string().nullable(),
    medicalRecordNumber: z.string().nullable(),
    externalContactId: z.string().nullable(),
  })
  .strict();

export const serverConversationSchema = conversationObjectSchema
  .omit({
    patient: true,
    channel: true,
    agentMode: true,
  })
  .extend({
    revision: revisionSchema,
    patient: serverPatientSchema,
    channel: z.enum(["telegram", "demo"]),
    agentMode: z.enum([...AGENT_MODES, "live_agent"]),
    source: z.enum(["telegram", "synthetic"]),
    externalConversationId: z.string().nullable(),
    latestAgentArtifactId: z.string().nullable(),
  })
  .strict()
  .superRefine((conversation, context) => {
    if (
      (conversation.workflowStatus === "resolved") !==
      (conversation.resolvedAt !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["resolvedAt"],
        message: "Resolved conversations require resolvedAt and active conversations forbid it",
      });
    }
    if (
      (conversation.channel === "telegram") !==
      (conversation.source === "telegram")
    ) {
      context.addIssue({
        code: "custom",
        path: ["source"],
        message: "Telegram channel and source must match",
      });
    }
    if (
      conversation.source === "telegram" &&
      !conversation.externalConversationId
    ) {
      context.addIssue({
        code: "custom",
        path: ["externalConversationId"],
        message: "Telegram conversations require an external conversation ID",
      });
    }
  });

export const playbookFileSnapshotSchema = z
  .object({
    id: z.string(),
    path: z.string(),
    title: z.string(),
    content: z.string(),
    contentHash: z.string(),
    protected: z.boolean(),
  })
  .strict();

export const playbookBundleVersionSchema = z
  .object({
    id: z.string(),
    sequence: revisionSchema,
    parentVersionId: z.string().nullable(),
    restoredFromVersionId: z.string().nullable(),
    kind: z.enum(["initial", "edit", "correction", "restore", "reset"]),
    files: z.array(playbookFileSnapshotSchema).min(1),
    bundleHash: z.string(),
    passingSuiteId: z.string().nullable(),
    createdAt: z.string(),
    activatedAt: z.string().nullable(),
  })
  .strict();

export const playbookVersionStateSchema = z
  .object({
    activeVersionId: z.string(),
    candidateVersionId: z.string().nullable(),
    rollbackTargetVersionId: z.string().nullable(),
    versions: z.array(playbookBundleVersionSchema).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    const versionIds = new Set(value.versions.map((version) => version.id));
    for (const [field, versionId] of [
      ["activeVersionId", value.activeVersionId],
      ["candidateVersionId", value.candidateVersionId],
      ["rollbackTargetVersionId", value.rollbackTargetVersionId],
    ] as const) {
      if (versionId !== null && !versionIds.has(versionId)) {
        context.addIssue({
          code: "custom",
          message: "Playbook pointer does not reference a stored version",
          path: [field],
        });
      }
    }
  });

const emptyEvalArtifactState = {
  suites: [],
  runs: [],
  resolutions: [],
};

export const serverDomainStateSchema = domainStateObjectSchema
  .omit({ conversations: true })
  .extend({
    conversations: z.array(serverConversationSchema),
    speechArtifacts: z.preprocess(
      (value) => value ?? [],
      z.array(inboundSpeechArtifactSchema),
    ),
    playbookHistory: playbookVersionStateSchema,
    evalArtifacts: z.preprocess(
      (value) => value ?? emptyEvalArtifactState,
      evalArtifactStateSchema,
    ),
  })
  .strict()
  .superRefine((state, context) => {
    validateKnowledgeFileReferences(state, context);
    const telegramMessageIds = new Set(
      state.conversations
        .filter(
          (conversation) => conversation.channel === "telegram",
        )
        .flatMap((conversation) =>
          conversation.messages.map((message) => message.id),
        ),
    );
    const artifactMessageIds = new Set<string>();
    state.speechArtifacts.forEach((artifact, index) => {
      if (artifactMessageIds.has(artifact.messageId)) {
        context.addIssue({
          code: "custom",
          message:
            "A Telegram message can have only one speech artifact",
          path: ["speechArtifacts", index, "messageId"],
        });
      }
      if (!telegramMessageIds.has(artifact.messageId)) {
        context.addIssue({
          code: "custom",
          message:
            "Speech artifact must reference a Telegram conversation message",
          path: ["speechArtifacts", index, "messageId"],
        });
      }
      artifactMessageIds.add(artifact.messageId);
    });
  });

export const appSelectionsSchema = z.object({
  conversationId: z.string().nullable(),
  playbookFileId: z.string().nullable(),
  evalDatasetId: z.string().nullable(),
});

export const appStateSchema = z
  .object({
    ...domainStateFields,
    selections: appSelectionsSchema,
  })
  .superRefine(validateKnowledgeFileReferences);

export function toDomainStatePayload(state: z.infer<typeof appStateSchema>) {
  return domainStateSchema.parse(state);
}

export const persistedAppStateEnvelopeSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  serializedAt: z.string(),
  state: appStateSchema,
});

export type MessagePayload = z.infer<typeof messageSchema>;
export type PatientPayload = z.infer<typeof patientSchema>;
export type BookingPayload = z.infer<typeof bookingSchema>;
export type ConversationPayload = z.infer<typeof conversationSchema>;
export type PlaybookFilePayload = z.infer<typeof playbookSchema>;
export type CorrectionPayload = z.infer<typeof correctionSchema>;
export type CriterionPayload = z.infer<typeof criterionSchema>;
export type JudgeCriterionResultPayload = z.infer<typeof criterionResultSchema>;
export type JudgeMetadataPayload = z.infer<typeof judgeMetadataSchema>;
export type EvalGradePayload = z.infer<typeof gradeSchema>;
export type EvalCasePayload = z.infer<typeof evalCaseSchema>;
export type SuiteSnapshotPayload = z.infer<typeof suiteSnapshotSchema>;
export type EvalRunHistoryRowPayload = z.infer<typeof runHistorySchema>;
export type EvalDatasetPayload = z.infer<typeof datasetSchema>;
export type AppSelectionsPayload = z.infer<typeof appSelectionsSchema>;
export type DomainStatePayload = z.infer<typeof domainStateSchema>;
export type ServerPatientPayload = z.infer<typeof serverPatientSchema>;
export type ServerConversationPayload = z.infer<typeof serverConversationSchema>;
export type InboundSpeechArtifactPayload = z.infer<typeof inboundSpeechArtifactSchema>;
export type PlaybookFileSnapshotPayload = z.infer<typeof playbookFileSnapshotSchema>;
export type PlaybookBundleVersionPayload = z.infer<typeof playbookBundleVersionSchema>;
export type PlaybookVersionStatePayload = z.infer<typeof playbookVersionStateSchema>;
export type ServerDomainStatePayload = z.infer<typeof serverDomainStateSchema>;
export type AppStatePayload = z.infer<typeof appStateSchema>;
export type PersistedAppStateEnvelope = z.infer<typeof persistedAppStateEnvelopeSchema>;
