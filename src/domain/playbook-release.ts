import {
  serverDomainStateSchema,
  type PlaybookBundleVersionPayload,
  type PlaybookFileSnapshotPayload,
  type ServerDomainStatePayload,
} from "../contracts/app-state";
import { sha256 } from "./hash";

export class PlaybookReleaseError extends Error {
  constructor(
    readonly code: "invalid_input" | "not_found" | "release_blocked",
    message: string,
  ) {
    super(message);
    this.name = "PlaybookReleaseError";
  }
}

type CandidateInput = {
  candidateVersionId: string;
  createdAt: string;
  kind: Extract<PlaybookBundleVersionPayload["kind"], "correction" | "edit">;
  update: (files: PlaybookFileSnapshotPayload[]) => PlaybookFileSnapshotPayload[];
};

function fail(
  code: PlaybookReleaseError["code"],
  message: string,
): never {
  throw new PlaybookReleaseError(code, message);
}

function activeVersion(state: ServerDomainStatePayload): PlaybookBundleVersionPayload {
  const version = state.playbookHistory.versions.find(
    (candidate) => candidate.id === state.playbookHistory.activeVersionId,
  );
  if (!version) {
    fail("not_found", "Active Dream bundle is unavailable");
  }
  return version;
}

function versionById(
  state: ServerDomainStatePayload,
  versionId: string,
): PlaybookBundleVersionPayload {
  const version = state.playbookHistory.versions.find((candidate) => candidate.id === versionId);
  if (!version) {
    fail("not_found", "Dream bundle was not found");
  }
  return version;
}

async function bundleHash(files: PlaybookFileSnapshotPayload[]): Promise<string> {
  return sha256(
    JSON.stringify(
      files.map((file) => ({ id: file.id, contentHash: file.contentHash })),
    ),
  );
}

async function snapshotFiles(
  files: PlaybookFileSnapshotPayload[],
): Promise<PlaybookFileSnapshotPayload[]> {
  return Promise.all(
    files.map(async (file) => ({
      ...file,
      contentHash: await sha256(file.content),
    })),
  );
}

function projectFiles(
  state: ServerDomainStatePayload,
  files: PlaybookFileSnapshotPayload[],
  updatedAt: string,
): void {
  state.playbookFiles = files.map((file) => ({
    id: file.id,
    path: file.path,
    title: file.title,
    savedContent: file.content,
    updatedAt,
    protected: file.protected,
  }));
  state.playbookFolders = [
    ...new Set([
      ...state.playbookFolders,
      ...files
        .map((file) => file.path.slice(0, file.path.lastIndexOf("/")))
        .filter(Boolean),
    ]),
  ].sort();
}

export async function createPlaybookCandidate(
  input: CandidateInput & { state: ServerDomainStatePayload },
): Promise<ServerDomainStatePayload> {
  const state = serverDomainStateSchema.parse(structuredClone(input.state));
  if (state.playbookHistory.candidateVersionId) {
    // Replace current uncommitted candidate version smoothly with the new candidate
    const existingId = state.playbookHistory.candidateVersionId;
    state.playbookHistory.versions = state.playbookHistory.versions.filter(
      (version) => version.id !== existingId,
    );
    state.playbookHistory.candidateVersionId = null;
  }
  if (state.playbookHistory.versions.some((version) => version.id === input.candidateVersionId)) {
    fail("invalid_input", "Dream candidate version already exists");
  }

  const active = activeVersion(state);
  const updated = input.update(structuredClone(active.files));
  if (updated.length === 0) {
    fail("invalid_input", "Dream candidate must contain at least one file");
  }
  if (new Set(updated.map((file) => file.id)).size !== updated.length) {
    fail("invalid_input", "Dream candidate file identifiers must be unique");
  }
  const files = await snapshotFiles(updated);
  const nextVersion: PlaybookBundleVersionPayload = {
    id: input.candidateVersionId,
    sequence: Math.max(...state.playbookHistory.versions.map((version) => version.sequence)) + 1,
    parentVersionId: active.id,
    restoredFromVersionId: null,
    kind: input.kind,
    files,
    bundleHash: await bundleHash(files),
    passingSuiteId: null,
    createdAt: input.createdAt,
    activatedAt: null,
  };
  state.playbookHistory.versions.push(nextVersion);
  state.playbookHistory.candidateVersionId = nextVersion.id;
  projectFiles(state, nextVersion.files, input.createdAt);
  return serverDomainStateSchema.parse(state);
}

export async function createCandidateFromCorrection(input: {
  state: ServerDomainStatePayload;
  candidateVersionId: string;
  correctionId: string;
  createdAt: string;
}): Promise<ServerDomainStatePayload> {
  const correction = input.state.corrections.find((candidate) => candidate.id === input.correctionId);
  if (!correction) {
    fail("not_found", "Dream correction was not found");
  }
  if (correction.status !== "pending") {
    fail("release_blocked", "Dream correction has already been reviewed");
  }
  if (!correction.oldText || !correction.newText || correction.oldText === correction.newText) {
    fail("invalid_input", "Dream correction must replace distinct non-empty text");
  }

  const next = await createPlaybookCandidate({
    state: input.state,
    candidateVersionId: input.candidateVersionId,
    createdAt: input.createdAt,
    kind: "correction",
    update(files) {
      const file = files.find((candidate) => candidate.id === correction.fileId);
      if (!file) {
        fail("not_found", "Dream correction file was not found");
      }
      const occurrences = file.content.split(correction.oldText).length - 1;
      if (occurrences !== 1) {
        fail("release_blocked", "Dream correction no longer has one exact replacement target");
      }
      return files.map((candidate) =>
        candidate.id === file.id
          ? { ...candidate, content: candidate.content.replace(correction.oldText, correction.newText) }
          : candidate,
      );
    },
  });
  next.corrections = next.corrections.map((candidate) =>
    candidate.id === correction.id ? { ...candidate, status: "approved" as const } : candidate,
  );
  return serverDomainStateSchema.parse(next);
}

export async function createCandidateFromDraft(input: {
  state: ServerDomainStatePayload;
  candidateVersionId: string;
  fileId: string;
  content: string;
  createdAt: string;
}): Promise<ServerDomainStatePayload> {
  if (!input.content.trim()) {
    fail("invalid_input", "Dream candidate content cannot be empty");
  }
  return createPlaybookCandidate({
    state: input.state,
    candidateVersionId: input.candidateVersionId,
    createdAt: input.createdAt,
    kind: "edit",
    update(files) {
      const file = files.find((candidate) => candidate.id === input.fileId);
      if (!file) {
        fail("not_found", "Dream file was not found");
      }
      if (file.content === input.content) {
        fail("invalid_input", "Dream candidate does not change the active file");
      }
      return files.map((candidate) =>
        candidate.id === input.fileId ? { ...candidate, content: input.content } : candidate,
      );
    },
  });
}

export async function createCandidateFromFile(input: {
  state: ServerDomainStatePayload;
  candidateVersionId: string;
  file: Pick<PlaybookFileSnapshotPayload, "id" | "path" | "title" | "content">;
  createdAt: string;
}): Promise<ServerDomainStatePayload> {
  if (!/^playbooks(?:\/[a-z0-9][a-z0-9-]*)*\/[a-z0-9][a-z0-9-]*\.md$/i.test(input.file.path)) {
    fail("invalid_input", "Dream files must use a playbooks/*.md path");
  }
  return createPlaybookCandidate({
    state: input.state,
    candidateVersionId: input.candidateVersionId,
    createdAt: input.createdAt,
    kind: "edit",
    update(files) {
      const existing = files.find((file) => file.id === input.file.id);
      if (!existing && files.some((file) => file.path === input.file.path)) {
        fail("release_blocked", "Dream file path already exists in the active bundle");
      }
      if (existing) {
        if (files.some((file) => file.id !== existing.id && file.path === input.file.path)) {
          fail("release_blocked", "Dream file path already exists in the active bundle");
        }
        return files.map((file) =>
          file.id === existing.id
            ? { ...file, path: input.file.path, title: input.file.title, content: input.file.content }
            : file,
        );
      }
      return [...files, { ...input.file, contentHash: "", protected: false }];
    },
  });
}

export async function createCandidateFromFileDeletion(input: {
  state: ServerDomainStatePayload;
  candidateVersionId: string;
  fileId: string;
  createdAt: string;
}): Promise<ServerDomainStatePayload> {
  return createPlaybookCandidate({
    state: input.state,
    candidateVersionId: input.candidateVersionId,
    createdAt: input.createdAt,
    kind: "edit",
    update(files) {
      const file = files.find((candidate) => candidate.id === input.fileId);
      if (!file) fail("not_found", "Dream file was not found");
      if (file.protected) fail("release_blocked", "Protected Dream file cannot be deleted");
      if (input.state.corrections.some((correction) => correction.fileId === file.id)) {
        fail("release_blocked", "Dream file with correction history cannot be deleted");
      }
      return files.filter((candidate) => candidate.id !== file.id);
    },
  });
}

export async function createCandidateFromMarkdownImport(input: {
  state: ServerDomainStatePayload;
  candidateVersionId: string;
  fileId: string;
  path: string;
  title: string;
  content: string;
  createdAt: string;
}): Promise<ServerDomainStatePayload> {
  if (!/^playbooks(?:\/[a-z0-9][a-z0-9-]*)*\/[a-z0-9][a-z0-9-]*\.md$/i.test(input.path)) {
    fail("invalid_input", "Markdown imports must use a playbooks/*.md path");
  }
  if (!input.title.trim() || !input.content.trim()) {
    fail("invalid_input", "Markdown imports require a title and non-empty content");
  }
  return createPlaybookCandidate({
    state: input.state,
    candidateVersionId: input.candidateVersionId,
    createdAt: input.createdAt,
    kind: "edit",
    update(files) {
      if (files.some((file) => file.id === input.fileId || file.path === input.path)) {
        fail("release_blocked", "Markdown import already exists in the active Dream bundle");
      }
      return [
        ...files,
        {
          id: input.fileId,
          path: input.path,
          title: input.title.trim(),
          content: input.content,
          contentHash: "",
          protected: false,
        },
      ];
    },
  });
}

export function markCandidateReady(input: {
  state: ServerDomainStatePayload;
  candidateVersionId: string;
  suiteId: string;
}): ServerDomainStatePayload {
  const state = serverDomainStateSchema.parse(structuredClone(input.state));
  if (state.playbookHistory.candidateVersionId !== input.candidateVersionId) {
    fail("release_blocked", "Dream candidate is no longer current");
  }
  const candidate = versionById(state, input.candidateVersionId);
  const suite = state.evalArtifacts.suites.find((item) => item.id === input.suiteId);
  if (!suite || suite.playbookBundle.versionId !== candidate.id) {
    fail("release_blocked", "Full Eval replay is not pinned to the Dream candidate");
  }
  const dataset = state.evalDatasets.find((item) => item.id === suite.datasetId);
  if (
    !dataset ||
    !dataset.cases.some((evalCase) => evalCase.split === "train") ||
    !dataset.cases.some((evalCase) => evalCase.split === "holdout") ||
    dataset.cases.length !== suite.cases.length ||
    dataset.cases.some(
      (evalCase) => !suite.cases.some((candidateCase) => candidateCase.id === evalCase.id),
    )
  ) {
    fail("release_blocked", "Dream candidate requires a full train and holdout Eval replay");
  }
  const latestRuns = new Map<string, (typeof state.evalArtifacts.runs)[number]>();
  for (const run of state.evalArtifacts.runs) {
    if (run.suiteId !== suite.id) continue;
    const current = latestRuns.get(run.caseId);
    if (!current || run.attempt > current.attempt) latestRuns.set(run.caseId, run);
  }
  if (
    suite.cases.some(
      (evalCase) => latestRuns.get(evalCase.id)?.judgeResult.overallVerdict !== "pass",
    )
  ) {
    fail("release_blocked", "Dream candidate needs a complete passing Eval replay before activation");
  }
  candidate.passingSuiteId = suite.id;
  return serverDomainStateSchema.parse(state);
}

export function activatePlaybookCandidate(input: {
  state: ServerDomainStatePayload;
  candidateVersionId: string;
  activatedAt: string;
}): ServerDomainStatePayload {
  const state = serverDomainStateSchema.parse(structuredClone(input.state));
  if (state.playbookHistory.candidateVersionId !== input.candidateVersionId) {
    fail("release_blocked", "Dream candidate is no longer current");
  }
  const candidate = versionById(state, input.candidateVersionId);
  if (!candidate.passingSuiteId) {
    fail("release_blocked", "Dream candidate is not Ready for activation");
  }
  const previousActive = activeVersion(state);
  candidate.activatedAt = input.activatedAt;
  state.playbookHistory.activeVersionId = candidate.id;
  state.playbookHistory.candidateVersionId = null;
  state.playbookHistory.rollbackTargetVersionId = previousActive.id;
  projectFiles(state, candidate.files, input.activatedAt);
  return serverDomainStateSchema.parse(state);
}

export function discardPlaybookCandidate(input: {
  state: ServerDomainStatePayload;
  candidateVersionId: string;
  discardedAt: string;
}): ServerDomainStatePayload {
  const state = serverDomainStateSchema.parse(structuredClone(input.state));
  if (state.playbookHistory.candidateVersionId !== input.candidateVersionId) {
    fail("release_blocked", "Dream candidate is no longer current");
  }
  versionById(state, input.candidateVersionId);
  state.playbookHistory.candidateVersionId = null;
  projectFiles(state, activeVersion(state).files, input.discardedAt);
  return serverDomainStateSchema.parse(state);
}

export async function rollbackPlaybook(input: {
  state: ServerDomainStatePayload;
  restoreVersionId: string;
  createdAt: string;
}): Promise<ServerDomainStatePayload> {
  const state = serverDomainStateSchema.parse(structuredClone(input.state));
  if (state.playbookHistory.candidateVersionId) {
    fail("release_blocked", "Finish or discard the Dream candidate before rollback");
  }
  const targetId = state.playbookHistory.rollbackTargetVersionId;
  if (!targetId) {
    fail("release_blocked", "No prior Dream version is available to restore");
  }
  if (state.playbookHistory.versions.some((version) => version.id === input.restoreVersionId)) {
    fail("invalid_input", "Dream restore version already exists");
  }
  const current = activeVersion(state);
  const target = versionById(state, targetId);
  const files = await snapshotFiles(structuredClone(target.files));
  const restored: PlaybookBundleVersionPayload = {
    id: input.restoreVersionId,
    sequence: Math.max(...state.playbookHistory.versions.map((version) => version.sequence)) + 1,
    parentVersionId: current.id,
    restoredFromVersionId: target.id,
    kind: "restore",
    files,
    bundleHash: await bundleHash(files),
    passingSuiteId: target.passingSuiteId,
    createdAt: input.createdAt,
    activatedAt: input.createdAt,
  };
  state.playbookHistory.versions.push(restored);
  state.playbookHistory.activeVersionId = restored.id;
  state.playbookHistory.rollbackTargetVersionId = current.id;
  projectFiles(state, restored.files, input.createdAt);
  return serverDomainStateSchema.parse(state);
}
