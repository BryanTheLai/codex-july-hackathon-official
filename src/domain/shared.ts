import type {
  AppState,
  Conversation,
  ConversationId,
  EvalCase,
  EvalCaseId,
  EvalDataset,
  EvalDatasetId,
  MutationResult,
} from "./types";

export function cloneState(state: AppState): AppState {
  return structuredClone(state);
}

export function ok(state: AppState): MutationResult {
  return { ok: true, state: cloneState(state) };
}

export function err(state: AppState, error: string): MutationResult {
  return { ok: false, state: cloneState(state), error };
}

export function trimOrEmpty(value: string): string {
  return value.trim();
}

export function findConversation(state: AppState, id: ConversationId): Conversation | undefined {
  return state.conversations.find((conversation) => conversation.id === id);
}

export function updateConversation(
  state: AppState,
  id: ConversationId,
  updater: (conversation: Conversation) => Conversation,
): AppState {
  return {
    ...state,
    conversations: state.conversations.map((conversation) =>
      conversation.id === id ? updater(conversation) : conversation,
    ),
  };
}

export function findDataset(state: AppState, datasetId: EvalDatasetId): EvalDataset | undefined {
  return state.evalDatasets.find((dataset) => dataset.id === datasetId);
}

export function updateDataset(
  state: AppState,
  datasetId: EvalDatasetId,
  updater: (dataset: EvalDataset) => EvalDataset,
): AppState {
  return {
    ...state,
    evalDatasets: state.evalDatasets.map((dataset) =>
      dataset.id === datasetId ? updater(dataset) : dataset,
    ),
  };
}

export function findCaseInState(
  state: AppState,
  caseId: EvalCaseId,
): { dataset: EvalDataset; evalCase: EvalCase } | undefined {
  for (const dataset of state.evalDatasets) {
    const evalCase = dataset.cases.find((item) => item.id === caseId);
    if (evalCase) {
      return { dataset, evalCase };
    }
  }
  return undefined;
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function nextId(prefix: string, existing: string[]): string {
  let index = existing.length + 1;
  let candidate = `${prefix}-${index}`;
  while (existing.includes(candidate)) {
    index += 1;
    candidate = `${prefix}-${index}`;
  }
  return candidate;
}

export function systemMessage(text: string, id: string, sentAt: string) {
  return {
    id,
    role: "system" as const,
    text,
    sentAt,
  };
}

export function formatKualaLumpurSlot(slotIso: string): string {
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(slotIso));
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
