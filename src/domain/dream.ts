import type {
  AppState,
  CreatePlaybookFileInput,
  DeletePlaybookFileOptions,
  MutationResult,
  RenamePlaybookFileInput,
  TestChangesMutationResult,
} from "./types";
import { cloneState, err, ok, slugify, trimOrEmpty } from "./shared";

function findFile(state: AppState, fileId: string) {
  return state.playbookFiles.find((file) => file.id === fileId);
}

function fileHasDraft(state: AppState, fileId: string): boolean {
  const file = findFile(state, fileId);
  return file?.draft !== undefined;
}

function updateFile(state: AppState, fileId: string, updater: (file: AppState["playbookFiles"][number]) => AppState["playbookFiles"][number]): AppState {
  return {
    ...state,
    playbookFiles: state.playbookFiles.map((file) => (file.id === fileId ? updater(file) : file)),
  };
}

function isValidPlaybookPath(path: string): boolean {
  if (!path.startsWith("playbooks/")) {
    return false;
  }
  if (!path.endsWith(".md")) {
    return false;
  }
  const segments = path.split("/");
  const filename = segments.at(-1) ?? "";
  const folders = segments.slice(1, -1);
  return (
    filename.length > 3 &&
    /^[a-z0-9][a-z0-9-]*\.md$/.test(filename) &&
    folders.every((segment) => /^[a-z0-9][a-z0-9-]*$/.test(segment))
  );
}

function isValidPlaybookFolder(path: string): boolean {
  const segments = path.split("/");
  return (
    segments[0] === "playbooks" &&
    segments.length > 1 &&
    segments.slice(1).every((segment) => /^[a-z0-9][a-z0-9-]*$/.test(segment))
  );
}

function parentPath(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

function fileIdFromPath(path: string): string {
  return `file-${slugify(path.replace(/^playbooks\//, "").replace(/\.md$/, ""))}`;
}

function correctionHistoryForFile(state: AppState, fileId: string): boolean {
  return state.corrections.some((correction) => correction.fileId === fileId);
}

export function createPlaybookFile(state: AppState, input: CreatePlaybookFileInput): MutationResult {
  if (!isValidPlaybookPath(input.path)) {
    return err(state, "Path must start with playbooks/, use lowercase folders, and end with .md");
  }
  if (!state.playbookFolders.includes(parentPath(input.path))) {
    return err(state, "Parent playbook folder does not exist");
  }
  if (state.playbookFiles.some((file) => file.path === input.path)) {
    return err(state, "Playbook path already exists");
  }

  const id = fileIdFromPath(input.path);
  if (state.playbookFiles.some((file) => file.id === id)) {
    return err(state, "Playbook id collision");
  }

  const file = {
    id,
    path: input.path,
    title: trimOrEmpty(input.title) || input.path,
    savedContent: input.savedContent ?? "",
    updatedAt: state.fixtureTime,
    protected: false,
  };
  const next: AppState = {
    ...cloneState(state),
    playbookFiles: [...state.playbookFiles, file],
    selections: { ...state.selections, playbookFileId: id },
  };
  return ok(next);
}

export function createPlaybookFolder(state: AppState, path: string): MutationResult {
  const normalizedPath = path.trim().replace(/\/+$/, "");
  if (!isValidPlaybookFolder(normalizedPath)) {
    return err(state, "Folder must be a lowercase path inside playbooks/");
  }
  if (!state.playbookFolders.includes(parentPath(normalizedPath))) {
    return err(state, "Parent playbook folder does not exist");
  }
  if (state.playbookFolders.includes(normalizedPath)) {
    return err(state, "Playbook folder already exists");
  }
  if (state.playbookFiles.some((file) => file.path === normalizedPath)) {
    return err(state, "A playbook file already uses this path");
  }

  return ok({
    ...cloneState(state),
    playbookFolders: [...state.playbookFolders, normalizedPath].sort(),
  });
}

export function renamePlaybookFile(state: AppState, input: RenamePlaybookFileInput): MutationResult {
  const file = findFile(state, input.fileId);
  if (!file) {
    return err(state, "Playbook file not found");
  }
  if (!isValidPlaybookPath(input.path)) {
    return err(state, "Path must start with playbooks/, use lowercase folders, and end with .md");
  }
  if (!state.playbookFolders.includes(parentPath(input.path))) {
    return err(state, "Parent playbook folder does not exist");
  }
  if (state.playbookFiles.some((item) => item.id !== input.fileId && item.path === input.path)) {
    return err(state, "Playbook path already exists");
  }

  const next = updateFile(state, input.fileId, (current) => ({
    ...current,
    path: input.path,
    title: trimOrEmpty(input.title) || input.path,
    updatedAt: state.fixtureTime,
  }));
  return ok(next);
}

export function deletePlaybookFile(state: AppState, options: DeletePlaybookFileOptions): MutationResult {
  const file = findFile(state, options.fileId);
  if (!file) {
    return err(state, "Playbook file not found");
  }
  if (!options.confirmed) {
    return err(state, "Delete playbook requires confirmation");
  }
  if (file.protected) {
    return err(state, "Protected seed playbook cannot be deleted");
  }
  if (correctionHistoryForFile(state, options.fileId)) {
    return err(state, "Playbook has correction history and cannot be deleted");
  }

  const remaining = state.playbookFiles.filter((item) => item.id !== options.fileId);
  const next: AppState = {
    ...cloneState(state),
    playbookFiles: remaining,
    selections: {
      ...state.selections,
      playbookFileId: remaining[0]?.id ?? null,
    },
  };
  return ok(next);
}

export function setPlaybookDraft(state: AppState, fileId: string, draft: string): MutationResult {
  const file = findFile(state, fileId);
  if (!file) {
    return err(state, "Playbook file not found");
  }
  const next = updateFile(state, fileId, (current) => ({ ...current, draft }));
  return ok(next);
}

export function savePlaybookDraft(state: AppState, fileId: string): MutationResult {
  const file = findFile(state, fileId);
  if (!file) {
    return err(state, "Playbook file not found");
  }
  if (file.draft === undefined) {
    return err(state, "No draft to save");
  }

  const next = updateFile(state, fileId, (current) => ({
    ...current,
    savedContent: current.draft ?? current.savedContent,
    draft: undefined,
    updatedAt: state.fixtureTime,
  }));
  return ok(next);
}

export function discardPlaybookDraft(state: AppState, fileId: string): MutationResult {
  const file = findFile(state, fileId);
  if (!file) {
    return err(state, "Playbook file not found");
  }
  if (file.draft === undefined) {
    return err(state, "No draft to discard");
  }

  const next = updateFile(state, fileId, (current) => ({ ...current, draft: undefined }));
  return ok(next);
}

export function approveCorrection(state: AppState, correctionId: string): MutationResult {
  const correction = state.corrections.find((item) => item.id === correctionId);
  if (!correction) {
    return err(state, "Correction not found");
  }
  if (correction.status !== "pending") {
    return err(state, "Correction already decided");
  }
  if (fileHasDraft(state, correction.fileId)) {
    return err(state, "Dirty draft blocks correction review");
  }

  const file = findFile(state, correction.fileId);
  if (!file) {
    return err(state, "Playbook file not found");
  }
  if (!file.savedContent.includes(correction.oldText)) {
    return err(state, "Stale old text no longer matches saved content");
  }

  const updatedContent = file.savedContent.replace(correction.oldText, correction.newText);
  let next = updateFile(state, correction.fileId, (current) => ({
    ...current,
    savedContent: updatedContent,
    updatedAt: state.fixtureTime,
  }));
  next = {
    ...next,
    corrections: next.corrections.map((item) =>
      item.id === correctionId ? { ...item, status: "approved" as const } : item,
    ),
  };
  return ok(next);
}

export function rejectCorrection(state: AppState, correctionId: string): MutationResult {
  const correction = state.corrections.find((item) => item.id === correctionId);
  if (!correction) {
    return err(state, "Correction not found");
  }
  if (correction.status !== "pending") {
    return err(state, "Correction already decided");
  }
  if (fileHasDraft(state, correction.fileId)) {
    return err(state, "Dirty draft blocks correction review");
  }

  const next: AppState = {
    ...cloneState(state),
    corrections: state.corrections.map((item) =>
      item.id === correctionId ? { ...item, status: "rejected" as const } : item,
    ),
  };
  return ok(next);
}

export function runTestChanges(state: AppState, fileId: string): TestChangesMutationResult {
  const file = findFile(state, fileId);
  if (!file) {
    return {
      ok: false,
      state: cloneState(state),
      error: "Playbook file not found",
      result: emptyTestResult(),
    };
  }

  const relevant = state.corrections.filter((correction) => correction.fileId === fileId);
  const details = relevant.map((correction) => {
    if (correction.status === "rejected") {
      return { correctionId: correction.id, result: "skipped" as const };
    }
    if (correction.status === "pending") {
      return { correctionId: correction.id, result: "pending" as const };
    }
    const pass = file.savedContent.includes(correction.newText);
    return { correctionId: correction.id, result: pass ? ("pass" as const) : ("fail" as const) };
  });

  const passed = details.filter((item) => item.result === "pass").length;
  const evaluated = details.filter((item) => item.result === "pass" || item.result === "fail").length;
  const pending = details.filter((item) => item.result === "pending").length;
  const rejected = details.filter((item) => item.result === "skipped").length;

  return {
    ok: true,
    state: cloneState(state),
    result: {
      passed,
      evaluated,
      pending,
      rejected,
      boundaryNote: "Test Changes verifies saved playbook text only; Evaluation Lab scores stay separate.",
      details,
    },
  };
}

function emptyTestResult() {
  return {
    passed: 0,
    evaluated: 0,
    pending: 0,
    rejected: 0,
    boundaryNote: "",
    details: [],
  };
}
