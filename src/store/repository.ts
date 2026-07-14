import { createCanonicalSeed, hydrateAppState, serializeAppState } from "../domain";
import type { AppState } from "../domain";

export const STORAGE_KEY = "kaunter-ai-app-state-v4";
export const LEGACY_STORAGE_KEY = "kaunter-ai-app-state-v3";

export type LoadAppStateResult = {
  state: AppState;
  loadNotice: string;
  migrated: boolean;
};

export interface AppStateRepository {
  load(): LoadAppStateResult;
  save(state: AppState): void;
}

function emptyLoadResult(): LoadAppStateResult {
  return {
    state: createCanonicalSeed(),
    loadNotice: "",
    migrated: false,
  };
}

function recoveryLoadResult(): LoadAppStateResult {
  return {
    state: createCanonicalSeed(),
    loadNotice: "Saved demo data could not be read and was reset to the canonical seed.",
    migrated: true,
  };
}

export function createLocalAppStateRepository(storage: Storage): AppStateRepository {
  return {
    load() {
      const current = storage.getItem(STORAGE_KEY);
      const legacy = current === null ? storage.getItem(LEGACY_STORAGE_KEY) : null;
      const raw = current ?? legacy;
      if (!raw) {
        return emptyLoadResult();
      }

      try {
        const payload: unknown = JSON.parse(raw);
        const hydrated = hydrateAppState(payload);
        const recovered = hydrated.fallback === "reseed";
        return {
          state: hydrated.state,
          loadNotice: hydrated.migratedFrom
            ? "Scoring rules were upgraded. Legacy evaluation grades and run history were cleared; conversations, playbooks, test definitions, and bookings were preserved."
            : recovered
              ? "Saved demo data could not be read and was reset to the canonical seed."
            : "",
          migrated: hydrated.migratedFrom !== undefined || legacy !== null || recovered,
        };
      } catch {
        return recoveryLoadResult();
      }
    },

    save(state) {
      storage.setItem(STORAGE_KEY, JSON.stringify(serializeAppState(state)));
      storage.removeItem(LEGACY_STORAGE_KEY);
    },
  };
}

export function loadAppStateResult(storage: Storage): LoadAppStateResult {
  return createLocalAppStateRepository(storage).load();
}

export function loadAppState(storage: Storage): AppState {
  return loadAppStateResult(storage).state;
}

export function saveAppState(storage: Storage, state: AppState): void {
  createLocalAppStateRepository(storage).save(state);
}
