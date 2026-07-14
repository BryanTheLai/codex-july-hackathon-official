import type { AppState, MutationResult } from "../domain";
import type { AppStateRepository } from "./repository";

const APP_STATE_FIELDS = {
  schemaVersion: true,
  fixtureTime: true,
  conversations: true,
  playbookFolders: true,
  playbookFiles: true,
  corrections: true,
  evalDatasets: true,
  selections: true,
} as const satisfies Record<keyof AppState, true>;

type AppStateKey = keyof typeof APP_STATE_FIELDS;
const APP_STATE_KEYS = Object.keys(APP_STATE_FIELDS) as AppStateKey[];

function topLevelFieldsChanged(base: AppState, next: AppState): AppStateKey[] {
  return APP_STATE_KEYS.filter((key) => !fieldEqual(base[key], next[key]));
}

function fieldEqual(left: AppState[AppStateKey], right: AppState[AppStateKey]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function copyStateField<Key extends AppStateKey>(
  target: AppState,
  source: AppState,
  key: Key,
): void {
  target[key] = source[key];
}

export function rebaseAsyncMutationResult(
  baseState: AppState,
  latestState: AppState,
  result: MutationResult,
): MutationResult {
  if (!result.ok) {
    return { ok: false, state: latestState, error: result.error };
  }

  const changedFields = topLevelFieldsChanged(baseState, result.state);
  const conflicts = changedFields.filter((key) => !fieldEqual(baseState[key], latestState[key]));
  if (conflicts.length > 0) {
    return {
      ok: false,
      state: latestState,
      error: `Operation result is stale because ${conflicts.join(", ")} changed while it was running. Retry.`,
    };
  }

  const rebasedState: AppState = { ...latestState };
  for (const key of changedFields) {
    copyStateField(rebasedState, result.state, key);
  }
  return { ok: true, state: rebasedState };
}

type StoreSlice = {
  state: MutationResult["state"];
  lastFeedback: string;
};

type Setter = (partial: Partial<StoreSlice>) => void;

export function applyMutation(
  set: Setter,
  repository: AppStateRepository,
  result: MutationResult,
  successFeedback: string | null,
): MutationResult {
  if (result.ok) {
    set(successFeedback === null ? { state: result.state } : {
      state: result.state,
      lastFeedback: successFeedback,
    });
    repository.save(result.state);
    return result;
  }

  set({ lastFeedback: result.error });
  return result;
}

export function applyTestChangesMutation(
  set: Setter,
  repository: AppStateRepository,
  result: MutationResult & { result?: unknown },
  successFeedback: string,
): MutationResult & { result?: unknown } {
  if (result.ok) {
    set({ state: result.state, lastFeedback: successFeedback });
    repository.save(result.state);
    return result;
  }

  set({ lastFeedback: result.error });
  return result;
}
