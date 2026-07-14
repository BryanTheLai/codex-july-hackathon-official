import {
  AGENT_MODES,
  BOOKING_NOTIFICATION_EVENTS,
  BOOKING_STATUSES,
  CORRECTION_STATUSES,
  CRITERION_VERDICTS,
  EVAL_CASE_TYPES,
  EVAL_SPLITS,
  EVAL_VERDICTS,
  MESSAGE_ROLES,
  SCHEMA_VERSION,
  SIMULATE_SCENARIOS,
  URGENCY_LEVELS,
  WORKFLOW_STATUSES,
} from "../contracts/constants";
import type {
  AppSelectionsPayload,
  AppStatePayload,
  BookingPayload,
  ConversationPayload,
  CorrectionPayload,
  CriterionPayload,
  EvalCasePayload,
  EvalDatasetPayload,
  EvalGradePayload,
  EvalRunHistoryRowPayload,
  JudgeCriterionResultPayload,
  JudgeMetadataPayload,
  MessagePayload,
  PatientPayload,
  PersistedAppStateEnvelope,
  PlaybookFilePayload,
  SuiteSnapshotPayload,
} from "../contracts/app-state";

export {
  AGENT_MODES,
  BOOKING_NOTIFICATION_EVENTS,
  BOOKING_STATUSES,
  CORRECTION_STATUSES,
  CRITERION_VERDICTS,
  EVAL_CASE_TYPES,
  EVAL_SPLITS,
  EVAL_VERDICTS,
  MESSAGE_ROLES,
  SCHEMA_VERSION,
  SIMULATE_SCENARIOS,
  URGENCY_LEVELS,
  WORKFLOW_STATUSES,
};

export const FIXTURE_TIME_ISO = "2026-07-08T10:00:00+08:00";

export type ConversationId = string;
export type PlaybookFileId = string;
export type CorrectionId = string;
export type EvalDatasetId = string;
export type EvalCaseId = string;
export type CriterionId = string;
export type MessageId = string;

export type AgentMode = (typeof AGENT_MODES)[number];
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];
export type Urgency = (typeof URGENCY_LEVELS)[number];
export type MessageRole = (typeof MESSAGE_ROLES)[number];
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export type BookingNotificationEvent = (typeof BOOKING_NOTIFICATION_EVENTS)[number];
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];
export type EvalSplit = (typeof EVAL_SPLITS)[number];
export type EvalCaseType = (typeof EVAL_CASE_TYPES)[number];
export type CriterionVerdict = (typeof CRITERION_VERDICTS)[number];
export type EvalVerdict = (typeof EVAL_VERDICTS)[number];
export type SimulateScenario = (typeof SIMULATE_SCENARIOS)[number];

export type MutationResult<T = AppState> =
  | { ok: true; state: T }
  | { ok: false; state: T; error: string };

export type Message = MessagePayload;

export type Patient = PatientPayload;

export type Booking = BookingPayload;

export type UpdateBookingInput = Pick<Booking, "provider" | "slotIso" | "reason"> & {
  expectedRevision: number;
};

export type BookingNotificationPreview = {
  event: BookingNotificationEvent;
  text: string;
  gloss?: string;
  language: string;
};

export type BookingNotificationPreviewResult =
  | { ok: true; preview: BookingNotificationPreview }
  | { ok: false; error: string };

export type Conversation = ConversationPayload;

export type PlaybookFile = PlaybookFilePayload;

export type Correction = CorrectionPayload;

export type Criterion = CriterionPayload;

export type JudgeCriterionResult = JudgeCriterionResultPayload;

export type JudgeMetadata = JudgeMetadataPayload;

export type EvalGrade = EvalGradePayload;

export type EvalCase = EvalCasePayload;

export type SuiteSnapshot = SuiteSnapshotPayload;

export type EvalRunHistoryRow = EvalRunHistoryRowPayload;

export type EvalDataset = EvalDatasetPayload;

export type AppSelections = AppSelectionsPayload;

export type AppState = AppStatePayload;

export type PersistedEnvelopeV4 = PersistedAppStateEnvelope;

export type PersistedEnvelopeV3 = {
  schemaVersion: 3;
  serializedAt: string;
  state: unknown;
};

export type PersistedEnvelopeV2 = {
  schemaVersion: 2;
  serializedAt: string;
  state: unknown;
};

export type PersistedEnvelopeV1 = {
  schemaVersion: 1;
  serializedAt: string;
  state: unknown;
};

export type HydrateResult = {
  ok: true;
  state: AppState;
  fallback?: "none" | "reseed";
  migratedFrom?: 1 | 2 | 3;
};

export type GenerationInput = {
  caseId: EvalCaseId;
  title: string;
  type: EvalCaseType;
  language: string;
  inputConversation: Pick<Conversation, "messages">;
  criterionIds: CriterionId[];
  candidateVersion: number;
};

export type GenerationInputResult =
  | { ok: true; input: GenerationInput }
  | { ok: false; error: string };

export type SyntheticOutputResult =
  | { ok: true; output: string }
  | { ok: false; error: string };

export type TestChangesResult = {
  passed: number;
  evaluated: number;
  pending: number;
  rejected: number;
  boundaryNote: string;
  details: Array<{ correctionId: CorrectionId; result: "pass" | "fail" | "skipped" | "pending" }>;
};

export type RunEvalCaseOptions = {
  signal?: AbortSignal;
};

export type RunEvalSuiteOptions = {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
};

export type SendStaffReplyInput = {
  conversationId: ConversationId;
  text: string;
  kind: "reply" | "internal_note";
  translation?: {
    language: "English" | "Malay" | "Mandarin";
    text: string;
  };
};

export type DeleteCaseOptions = {
  confirmed: boolean;
};

export type SetAgentModeInput = {
  conversationId: ConversationId;
  mode: AgentMode;
};

export type AddDatasetInput = {
  name: string;
};

export type RenameDatasetInput = {
  datasetId: EvalDatasetId;
  name: string;
};

export type DeleteDatasetOptions = {
  datasetId: EvalDatasetId;
  confirmed: boolean;
};

export type AddCaseInput = {
  datasetId: EvalDatasetId;
  title: string;
  split: EvalSplit;
  type: EvalCaseType;
  language: string;
  inputConversation: Pick<Conversation, "messages">;
  expectedHumanOutput: string;
  criterionIds: CriterionId[];
};

export type CreatePlaybookFileInput = {
  path: string;
  title: string;
  savedContent?: string;
};

export type CreatePlaybookFolderInput = {
  path: string;
};

export type RenamePlaybookFileInput = {
  fileId: PlaybookFileId;
  path: string;
  title: string;
};

export type DeletePlaybookFileOptions = {
  fileId: PlaybookFileId;
  confirmed: boolean;
};

export type CriterionInput = {
  label: string;
  instruction: string;
  required: boolean;
  caseTypes?: EvalCaseType[];
  examples?: {
    good?: string;
    bad?: string;
  };
};

export type PatientUpdateInput = {
  name: string;
  phone: string;
  preferredLanguage: string;
};

export type CaseEditInput = {
  expectedHumanOutput?: string;
  title?: string;
  split?: EvalSplit;
  type?: EvalCaseType;
  language?: string;
  criterionIds?: CriterionId[];
};

export type CriterionEditInput = {
  label?: string;
  instruction?: string;
  required?: boolean;
  caseTypes?: EvalCaseType[];
  examples?: {
    good?: string;
    bad?: string;
  };
};

export type ForbiddenGenerationFields = {
  expectedHumanOutput?: string;
  actualSyntheticOutput?: string;
  grade?: EvalGrade;
  rationale?: string;
};

export type MigrationResult =
  | { ok: true; state: AppState }
  | { ok: false; error: string };

export type TestChangesMutationResult = MutationResult & {
  result: TestChangesResult;
};
