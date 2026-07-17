import { z } from "zod";

import {
  appStateSchema,
  bookingSchema,
  conversationFields,
  correctionSchema,
  criterionSchema,
  datasetFields,
  evalCaseSchema,
  evalCaseTypeSchema,
  gradeSchema,
  messageSchema,
  persistedAppStateEnvelopeSchema,
  playbookSchema,
  runHistorySchema,
  suiteSnapshotSchema,
} from "../contracts/app-state";
import { createCanonicalSeed, inferSeedCaseType } from "./seed";
import type {
  AppState,
  Criterion,
  EvalCaseType,
  HydrateResult,
  MigrationResult,
  PersistedEnvelopeV1,
  PersistedEnvelopeV2,
  PersistedEnvelopeV3,
  PersistedEnvelopeV4,
} from "./types";
import { FIXTURE_TIME_ISO, SCHEMA_VERSION } from "./types";
import { cloneState } from "./shared";
import { defaultCriteriaForType } from "./eval-support";

const legacyBookingSchema = z.object({
  provider: z.string().optional(),
  slotIso: z.string(),
  reason: z.string(),
  status: z.enum(["pending", "approved", "rejected"]),
});

const legacyConversationSchema = z.object({
  ...conversationFields,
  booking: z.union([legacyBookingSchema, bookingSchema]).optional(),
});

const legacyCriterionSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.string(),
  kind: z.enum(["required_substring", "forbidden_substring"]),
  blocking: z.boolean(),
  caseTypes: z.array(evalCaseTypeSchema).optional(),
});

const legacyGradeSchema = z.object({
  pass: z.boolean(),
  criteriaScore: z.number(),
  referenceCoverage: z.number(),
  judgeScore: z.number(),
  rationale: z.string(),
});

const legacyRunHistorySchema = z.object({
  id: z.string(),
  caseId: z.string(),
  datasetId: z.string(),
  ranAt: z.string(),
  candidateVersion: z.number(),
  pass: z.boolean(),
  judgeScore: z.number(),
});

const legacyEvalCaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  split: z.enum(["train", "holdout"]),
  type: evalCaseTypeSchema,
  language: z.string(),
  inputConversation: z.object({ messages: z.array(messageSchema) }),
  expectedHumanOutput: z.string(),
  criterionIds: z.array(z.string()),
  sourceConversationId: z.string().optional(),
  actualSyntheticOutput: z.string().optional(),
  grade: z.union([legacyGradeSchema, gradeSchema]).optional(),
});

const legacyDatasetSchema = z.object({
  ...datasetFields,
  criteria: z.array(z.union([legacyCriterionSchema, criterionSchema])),
  cases: z.array(legacyEvalCaseSchema),
  suiteSnapshots: z.array(suiteSnapshotSchema),
  runHistory: z.array(z.union([legacyRunHistorySchema, runHistorySchema])),
});

const envelopeV3Schema = z.object({
  schemaVersion: z.literal(3),
  serializedAt: z.string(),
  state: z.object({
    schemaVersion: z.literal(3),
    fixtureTime: z.string(),
    conversations: z.array(legacyConversationSchema),
    playbookFolders: z.array(z.string()).default(["playbooks", "playbooks/data"]),
    playbookFiles: z.array(playbookSchema),
    corrections: z.array(correctionSchema),
    evalDatasets: z.array(legacyDatasetSchema),
    selections: z.object({
      conversationId: z.string().nullable(),
      playbookFileId: z.string().nullable(),
      evalDatasetId: z.string().nullable(),
    }),
  }),
});

const envelopeV2Schema = z.object({
  schemaVersion: z.literal(2),
  serializedAt: z.string(),
  state: z.object({
    conversations: z.array(legacyConversationSchema),
    playbookFiles: z.array(playbookSchema),
    corrections: z.array(correctionSchema),
    evalDatasets: z.array(legacyDatasetSchema),
    selections: z.object({
      conversationId: z.string().nullable(),
      playbookFileId: z.string().nullable(),
      evalDatasetId: z.string().nullable(),
    }),
  }),
});

const envelopeV1CaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  split: z.enum(["train", "holdout"]),
  language: z.string(),
  inputConversation: z.object({ messages: z.array(messageSchema) }),
  expectedHumanOutput: z.string(),
  actualSyntheticOutput: z.string().optional(),
  grade: z.union([legacyGradeSchema, gradeSchema]).optional(),
});

const envelopeV1DatasetSchema = z.object({
  id: z.string(),
  name: z.string(),
  protected: z.boolean(),
  criteria: z.array(z.union([legacyCriterionSchema, criterionSchema])),
  cases: z.array(envelopeV1CaseSchema),
  runHistory: z
    .array(z.union([legacyRunHistorySchema, runHistorySchema]))
    .optional(),
});

const envelopeV1Schema = z.object({
  schemaVersion: z.literal(1),
  serializedAt: z.string(),
  state: z.object({
    conversations: z.array(legacyConversationSchema),
    playbookFiles: z.array(playbookSchema),
    corrections: z.array(correctionSchema),
    evalDatasets: z.array(envelopeV1DatasetSchema),
    selections: z.object({
      conversationId: z.string().nullable(),
      playbookFileId: z.string().nullable(),
      evalDatasetId: z.string().nullable(),
    }),
  }),
});

function reconcileSelections(state: AppState): AppState {
  const conversationId =
    state.selections.conversationId === null
      ? null
      : state.conversations.some(
            (conversation) => conversation.id === state.selections.conversationId,
          )
        ? state.selections.conversationId
        : state.conversations[0]?.id ?? null;
  const playbookFileId =
    state.selections.playbookFileId === null
      ? null
      : state.playbookFiles.some((file) => file.id === state.selections.playbookFileId)
        ? state.selections.playbookFileId
        : state.playbookFiles[0]?.id ?? null;
  const evalDatasetId =
    state.selections.evalDatasetId === null
      ? null
      : state.evalDatasets.some((dataset) => dataset.id === state.selections.evalDatasetId)
        ? state.selections.evalDatasetId
        : state.evalDatasets[0]?.id ?? null;

  return {
    ...state,
    selections: {
      conversationId,
      playbookFileId,
      evalDatasetId,
    },
  };
}

function finalizeHydratedState(state: AppState): AppState {
  const validated = appStateSchema.safeParse(state);
  if (!validated.success) {
    return createCanonicalSeed();
  }
  return reconcileSelections(cloneState(validated.data));
}

export function serializeAppState(state: AppState): PersistedEnvelopeV4 {
  return {
    schemaVersion: SCHEMA_VERSION,
    serializedAt: state.fixtureTime,
    state: cloneState(state),
  };
}

export function hydrateAppState(payload: unknown): HydrateResult {
  const parsedV4 = persistedAppStateEnvelopeSchema.safeParse(payload);
  if (parsedV4.success) {
    return {
      ok: true,
      state: finalizeHydratedState(parsedV4.data.state),
      fallback: "none",
    };
  }

  const parsedV3 = envelopeV3Schema.safeParse(payload);
  if (parsedV3.success) {
    const migrated = migrateV3ToV4(parsedV3.data);
    if (migrated.ok) {
      return {
        ok: true,
        state: finalizeHydratedState(migrated.state),
        fallback: "none",
        migratedFrom: 3,
      };
    }
  }

  const parsedV2 = envelopeV2Schema.safeParse(payload);
  if (parsedV2.success) {
    const migrated = migrateV2ToV3(parsedV2.data);
    if (migrated.ok) {
      return {
        ok: true,
        state: finalizeHydratedState(migrated.state),
        fallback: "none",
        migratedFrom: 2,
      };
    }
  }

  const parsedV1 = envelopeV1Schema.safeParse(payload);
  if (parsedV1.success) {
    const migrated = migrateV1ToV3(parsedV1.data);
    if (migrated.ok) {
      return {
        ok: true,
        state: finalizeHydratedState(migrated.state),
        fallback: "none",
        migratedFrom: 1,
      };
    }
  }

  return { ok: true, state: createCanonicalSeed(), fallback: "reseed" };
}

const LEGACY_V1_CRITERION_CASE_TYPES: Readonly<Record<string, EvalCaseType[]>> = {
  "crit-emergency": ["emergency_triage"],
  "crit-booking": ["booking"],
  "crit-prescription": ["prescription"],
};

type LegacyCriterion = z.infer<typeof legacyCriterionSchema>;
type ParsedCriterion = LegacyCriterion | z.infer<typeof criterionSchema>;
type ParsedConversation = z.infer<typeof legacyConversationSchema>;
type ParsedLegacyDataset = z.infer<typeof legacyDatasetSchema>;

function migrateCriterion(criterion: ParsedCriterion): Criterion {
  if ("instruction" in criterion) {
    return {
      ...criterion,
      caseTypes: criterion.caseTypes ? [...criterion.caseTypes] : undefined,
      examples: criterion.examples ? { ...criterion.examples } : undefined,
    };
  }
  const instruction =
    criterion.kind === "required_substring"
      ? `The response should communicate the meaning "${criterion.value}". Semantically equivalent wording is acceptable.`
      : `The response must not express "${criterion.value}" or a semantically equivalent meaning.`;
  return {
    id: criterion.id,
    label: criterion.label,
    instruction,
    required: criterion.blocking,
    caseTypes: criterion.caseTypes ? [...criterion.caseTypes] : undefined,
    version: 1,
  };
}

function migrateConversation(conversation: ParsedConversation): AppState["conversations"][number] {
  return {
    ...conversation,
    booking: conversation.booking
      ? {
          ...conversation.booking,
          revision: "revision" in conversation.booking ? conversation.booking.revision : 1,
        }
      : undefined,
  };
}

function migrateDataset(dataset: ParsedLegacyDataset): AppState["evalDatasets"][number] {
  const criteria = dataset.criteria.map(migrateCriterion);
  const criterionIds = new Set(criteria.map((criterion) => criterion.id));
  return {
    id: dataset.id,
    name: dataset.name,
    protected: dataset.protected,
    candidateVersion: dataset.candidateVersion,
    criteria,
    cases: dataset.cases.map((evalCase) => {
      const { grade: _grade, ...definition } = evalCase;
      return evalCaseSchema.parse({
        ...definition,
        criterionIds: definition.criterionIds.filter((id) =>
          criterionIds.has(id),
        ),
      });
    }),
    suiteSnapshots: [],
    runHistory: [],
  };
}

function validateMigration(state: AppState): MigrationResult {
  const validated = appStateSchema.safeParse(state);
  if (!validated.success) {
    return { ok: false, error: "Migrated state failed validation" };
  }
  return { ok: true, state: cloneState(validated.data) };
}

export function migrateV3ToV4(envelope: PersistedEnvelopeV3): MigrationResult {
  const parsed = envelopeV3Schema.safeParse(envelope);
  if (!parsed.success) {
    return { ok: false, error: "Invalid version 3 envelope" };
  }
  return validateMigration({
    schemaVersion: SCHEMA_VERSION,
    fixtureTime: parsed.data.state.fixtureTime,
    conversations: parsed.data.state.conversations.map(migrateConversation),
    playbookFolders: parsed.data.state.playbookFolders,
    playbookFiles: parsed.data.state.playbookFiles,
    corrections: parsed.data.state.corrections,
    evalDatasets: parsed.data.state.evalDatasets.map(migrateDataset),
    selections: parsed.data.state.selections,
  });
}

export function migrateV2ToV3(envelope: PersistedEnvelopeV2): MigrationResult {
  const parsed = envelopeV2Schema.safeParse(envelope);
  if (!parsed.success) {
    return { ok: false, error: "Invalid version 2 envelope" };
  }
  return validateMigration({
    schemaVersion: SCHEMA_VERSION,
    fixtureTime: FIXTURE_TIME_ISO,
    conversations: parsed.data.state.conversations.map(migrateConversation),
    playbookFolders: ["playbooks", "playbooks/data"],
    playbookFiles: parsed.data.state.playbookFiles,
    corrections: parsed.data.state.corrections,
    evalDatasets: parsed.data.state.evalDatasets.map(migrateDataset),
    selections: parsed.data.state.selections,
  });
}

function inferV1CaseType(caseId: string, title: string): EvalCaseType {
  return inferSeedCaseType(caseId, title);
}

function backfillLegacyCriterionCaseTypes(criteria: Criterion[]): Criterion[] {
  return criteria.map((criterion) => {
    if (criterion.caseTypes !== undefined) {
      return criterion;
    }
    const legacyTypes = LEGACY_V1_CRITERION_CASE_TYPES[criterion.id];
    if (legacyTypes) {
      return { ...criterion, caseTypes: [...legacyTypes] };
    }
    return criterion;
  });
}

export function migrateV1ToV3(envelope: PersistedEnvelopeV1): MigrationResult {
  const parsed = envelopeV1Schema.safeParse(envelope);
  if (!parsed.success) {
    return { ok: false, error: "Invalid version 1 envelope" };
  }

  const state: AppState = {
    schemaVersion: SCHEMA_VERSION,
    fixtureTime: FIXTURE_TIME_ISO,
    conversations: parsed.data.state.conversations.map(migrateConversation),
    playbookFolders: ["playbooks", "playbooks/data"],
    playbookFiles: parsed.data.state.playbookFiles,
    corrections: parsed.data.state.corrections,
    evalDatasets: parsed.data.state.evalDatasets.map((dataset) => {
      const criteria = backfillLegacyCriterionCaseTypes(dataset.criteria.map(migrateCriterion));
      return {
        id: dataset.id,
        name: dataset.name,
        protected: dataset.protected,
        candidateVersion: 1,
        criteria,
        suiteSnapshots: [],
        runHistory: [],
        cases: dataset.cases.map((evalCase) => {
          const type = inferV1CaseType(evalCase.id, evalCase.title);
          return evalCaseSchema.parse({
            id: evalCase.id,
            title: evalCase.title,
            split: evalCase.split,
            type,
            language: evalCase.language,
            inputConversation: evalCase.inputConversation,
            expectedHumanOutput: evalCase.expectedHumanOutput,
            criterionIds: defaultCriteriaForType(type, criteria),
            actualSyntheticOutput: evalCase.actualSyntheticOutput,
          });
        }),
      };
    }),
    selections: parsed.data.state.selections,
  };

  return validateMigration(state);
}
