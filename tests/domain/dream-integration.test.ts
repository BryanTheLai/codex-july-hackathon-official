import { describe, expect, it } from "vitest";

import {
  analyzeFailures,
  approveCorrection,
  createCanonicalSeed,
  createPlaybookFile,
  createPlaybookFolder,
  deletePlaybookFile,
  discardPlaybookDraft,
  importHitlFromConversation,
  playbookIdForConversation,
  rejectCorrection,
  renamePlaybookFile,
  resolveConversation,
  runEvalCase,
  runTestChanges,
  savePlaybookDraft,
  sendStaffReply,
  setPlaybookDraft,
  type AppState,
} from "../../src/domain";
import { createFixtureJudgeClient } from "../fixtures/judge-client";

const SEED_DATASET_ID = "dataset-seed";
const TRIAGE_FILE_ID = "file-triage";

function fileById(state: AppState, fileId: string) {
  return state.playbookFiles.find((f) => f.id === fileId)!;
}

function pendingForFile(state: AppState, fileId: string) {
  return state.corrections.filter((c) => c.fileId === fileId && c.status === "pending");
}

describe("per-file drafts", () => {
  it("preserves drafts per file and save copies draft into saved content", () => {
    const seed = createCanonicalSeed();
    const otherFile = seed.playbookFiles.find((f) => f.id !== TRIAGE_FILE_ID)!;

    const dirty = setPlaybookDraft(seed, TRIAGE_FILE_ID, "# triage draft\n");
    expect(dirty.ok).toBe(true);
    if (!dirty.ok) return;
    expect(fileById(dirty.state, TRIAGE_FILE_ID).draft).toBe("# triage draft\n");
    expect(fileById(dirty.state, otherFile.id).draft).toBeUndefined();

    const saved = savePlaybookDraft(dirty.state, TRIAGE_FILE_ID);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const file = fileById(saved.state, TRIAGE_FILE_ID);
    expect(file.savedContent).toBe("# triage draft\n");
    expect(file.draft).toBeUndefined();
  });

  it("discardPlaybookDraft restores saved content and clears draft", () => {
    const seed = createCanonicalSeed();
    const savedBefore = fileById(seed, TRIAGE_FILE_ID).savedContent;
    const dirty = setPlaybookDraft(seed, TRIAGE_FILE_ID, "# unsaved discard test\n");
    expect(dirty.ok).toBe(true);
    if (!dirty.ok) return;

    const discarded = discardPlaybookDraft(dirty.state, TRIAGE_FILE_ID);
    expect(discarded.ok).toBe(true);
    if (!discarded.ok) return;

    const file = fileById(discarded.state, TRIAGE_FILE_ID);
    expect(file.draft).toBeUndefined();
    expect(file.savedContent).toBe(savedBefore);
  });
});

describe("playbookIdForConversation", () => {
  it("routes booking, prescription, emergency or triage labels, and default to triage", () => {
    const seed = createCanonicalSeed();

    const booking = seed.conversations.find((c) => c.id === "convo-booking")!;
    const prescription = seed.conversations.find((c) => c.id === "convo-prescription")!;
    const emergency = seed.conversations.find((c) => c.id === "convo-emergency")!;
    const resolved = seed.conversations.find((c) => c.id === "convo-resolved")!;

    expect(playbookIdForConversation(booking)).toBe("file-malay-booking");
    expect(playbookIdForConversation(prescription)).toBe("file-mandarin-prescription");
    expect(playbookIdForConversation(emergency)).toBe("file-triage");
    expect(playbookIdForConversation(resolved)).toBe("file-triage");
  });
});

describe("dirty draft blocks review", () => {
  it("blocks approve and reject while draft is dirty", () => {
    const seed = createCanonicalSeed();
    const correction = pendingForFile(seed, TRIAGE_FILE_ID)[0]!;
    const savedContent = fileById(seed, TRIAGE_FILE_ID).savedContent;
    const dirty = setPlaybookDraft(seed, TRIAGE_FILE_ID, `${savedContent}\n# unsaved edit\n`);

    const approveBlocked = approveCorrection(dirty.state, correction.id);
    expect(approveBlocked.ok).toBe(false);
    if (approveBlocked.ok) return;
    expect(approveBlocked.error).toMatch(/draft|unsaved|dirty/i);

    const rejectBlocked = rejectCorrection(dirty.state, correction.id);
    expect(rejectBlocked.ok).toBe(false);
    if (rejectBlocked.ok) return;
    expect(rejectBlocked.error).toMatch(/draft|unsaved|dirty/i);
  });
});

describe("correction approve and reject", () => {
  it("approve replaces exact old text, marks approved, and stale old text blocks", () => {
    const seed = createCanonicalSeed();
    const correction = pendingForFile(seed, TRIAGE_FILE_ID)[0]!;

    const approved = approveCorrection(seed, correction.id);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    const file = fileById(approved.state, TRIAGE_FILE_ID);
    expect(file.savedContent).toContain(correction.newText);
    expect(file.savedContent).not.toContain(correction.oldText);
    expect(
      approved.state.corrections.find((c) => c.id === correction.id)?.status,
    ).toBe("approved");

    const stale = approveCorrection(approved.state, correction.id);
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.error).toMatch(/stale|old text|already/i);
  });

  it("reject leaves saved content unchanged", () => {
    const seed = createCanonicalSeed();
    const correction = pendingForFile(seed, TRIAGE_FILE_ID)[0]!;
    const beforeContent = fileById(seed, TRIAGE_FILE_ID).savedContent;

    const rejected = rejectCorrection(seed, correction.id);
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;

    expect(fileById(rejected.state, TRIAGE_FILE_ID).savedContent).toBe(beforeContent);
    expect(
      rejected.state.corrections.find((c) => c.id === correction.id)?.status,
    ).toBe("rejected");
  });
});

describe("test changes boundary", () => {
  it("verifies saved text only and never mutates eval grades", () => {
    const seed = createCanonicalSeed();
    const correction = pendingForFile(seed, TRIAGE_FILE_ID)[0]!;
    const approved = approveCorrection(seed, correction.id);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    const beforeGrades = approved.state.evalDatasets
      .flatMap((d) => d.cases)
      .map((c) => c.grade);

    const test = runTestChanges(approved.state, TRIAGE_FILE_ID);
    expect(test.ok).toBe(true);
    if (!test.ok) return;

    expect(test.result.evaluated).toBeGreaterThan(0);
    expect(test.result.passed).toBeGreaterThan(0);
    expect(test.result.boundaryNote).toMatch(/eval|score|separate/i);

    const afterGrades = test.state.evalDatasets.flatMap((d) => d.cases).map((c) => c.grade);
    expect(afterGrades).toEqual(beforeGrades);
    expect(test.state).not.toBe(approved.state);
  });
});

describe("playbook file CRUD", () => {
  it("creates nested folders and files while rejecting duplicate folder paths", () => {
    const seed = createCanonicalSeed();
    const folder = createPlaybookFolder(seed, "playbooks/research");

    expect(folder.ok).toBe(true);
    if (!folder.ok) return;
    expect(folder.state.playbookFolders).toContain("playbooks/research");

    const nestedFile = createPlaybookFile(folder.state, {
      path: "playbooks/research/clinic-context.md",
      title: "Clinic context",
    });
    expect(nestedFile.ok).toBe(true);
    if (!nestedFile.ok) return;
    expect(nestedFile.state.playbookFiles).toContainEqual(
      expect.objectContaining({ path: "playbooks/research/clinic-context.md" }),
    );

    const duplicate = createPlaybookFolder(nestedFile.state, "playbooks/research");
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) return;
    expect(duplicate.error).toMatch(/exists/i);
  });

  it("creates with valid playbooks/*.md path, stable id, and selects new file", () => {
    const seed = createCanonicalSeed();

    const created = createPlaybookFile(seed, {
      path: "playbooks/custom-intake.md",
      title: "Custom intake",
      savedContent: "# Custom\n",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const file = created.state.playbookFiles.find((f) => f.path === "playbooks/custom-intake.md");
    expect(file).toBeDefined();
    expect(file?.id).toBeTruthy();
    expect(file?.protected).toBe(false);
    expect(created.state.selections.playbookFileId).toBe(file?.id);
  });

  it("rejects invalid path or extension and duplicate path", () => {
    const seed = createCanonicalSeed();

    const badPrefix = createPlaybookFile(seed, {
      path: "docs/bad.md",
      title: "Bad",
    });
    expect(badPrefix.ok).toBe(false);
    if (badPrefix.ok) return;
    expect(badPrefix.error).toMatch(/playbooks\//i);

    const badExt = createPlaybookFile(seed, {
      path: "playbooks/bad.txt",
      title: "Bad ext",
    });
    expect(badExt.ok).toBe(false);
    if (badExt.ok) return;
    expect(badExt.error).toMatch(/\.md/i);

    const dup = createPlaybookFile(seed, {
      path: "playbooks/triage.md",
      title: "Duplicate",
    });
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.error).toMatch(/duplicate|exists|collision/i);
  });

  it("renames path and title without changing stable id", () => {
    const seed = createCanonicalSeed();
    const created = createPlaybookFile(seed, {
      path: "playbooks/rename-me.md",
      title: "Rename me",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const beforeId = created.state.playbookFiles.find((f) => f.path === "playbooks/rename-me.md")!.id;
    const renamed = renamePlaybookFile(created.state, {
      fileId: beforeId,
      path: "playbooks/renamed.md",
      title: "Renamed",
    });
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;

    const file = renamed.state.playbookFiles.find((f) => f.id === beforeId)!;
    expect(file.path).toBe("playbooks/renamed.md");
    expect(file.title).toBe("Renamed");
    expect(file.id).toBe(beforeId);
  });

  it("blocks delete for protected seed files and correction-history files", () => {
    const seed = createCanonicalSeed();

    const protectedDelete = deletePlaybookFile(seed, {
      fileId: "file-triage",
      confirmed: true,
    });
    expect(protectedDelete.ok).toBe(false);
    if (protectedDelete.ok) return;
    expect(protectedDelete.error).toMatch(/protected|seed/i);

    const created = createPlaybookFile(seed, {
      path: "playbooks/with-history.md",
      title: "With history",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const withCorrection = {
      ...created.state,
      corrections: [
        ...created.state.corrections,
        {
          id: "corr-custom",
          fileId: created.state.playbookFiles.find((f) => f.path === "playbooks/with-history.md")!.id,
          oldText: "old",
          newText: "new",
          evidence: "manual",
          status: "rejected" as const,
        },
      ],
    };

    const historyBlocked = deletePlaybookFile(withCorrection, {
      fileId: withCorrection.playbookFiles.find((f) => f.path === "playbooks/with-history.md")!.id,
      confirmed: true,
    });
    expect(historyBlocked.ok).toBe(false);
    if (historyBlocked.ok) return;
    expect(historyBlocked.error).toMatch(/correction|history/i);
  });

  it("deletes unprotected file without correction history after confirmation", () => {
    const seed = createCanonicalSeed();
    const created = createPlaybookFile(seed, {
      path: "playbooks/disposable.md",
      title: "Disposable",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const fileId = created.state.playbookFiles.find((f) => f.path === "playbooks/disposable.md")!.id;
    const canceled = deletePlaybookFile(created.state, { fileId, confirmed: false });
    expect(canceled.ok).toBe(false);
    if (canceled.ok) return;
    expect(canceled.state.playbookFiles.some((f) => f.id === fileId)).toBe(true);

    const deleted = deletePlaybookFile(created.state, { fileId, confirmed: true });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.state.playbookFiles.some((f) => f.id === fileId)).toBe(false);
  });
});

describe("cross-route flow", () => {
  it("staff reply -> HITL import -> run -> failed train correction -> approve -> test changes pass", async () => {
    let state = createCanonicalSeed();

    const active = state.conversations.find((c) => c.workflowStatus !== "resolved")!;
    const sent = sendStaffReply(state, {
      conversationId: active.id,
      text: "Please bring your insurance card to counter three.",
      kind: "reply",
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    state = sent.state;

    const resolved = resolveConversation(state, active.id);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    state = resolved.state;

    const imported = importHitlFromConversation(state, active.id);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    state = imported.state;

    const newCase = state.evalDatasets
      .flatMap((d) => d.cases)
      .find((c) => c.expectedHumanOutput.includes("insurance card"));
    expect(newCase).toBeDefined();
    if (!newCase) return;

    const run = await runEvalCase(state, newCase.id, createFixtureJudgeClient());
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    state = run.state;

    const analyzed = analyzeFailures(state, SEED_DATASET_ID);
    expect(analyzed.ok).toBe(true);
    if (!analyzed.ok) return;
    state = analyzed.state;

    const pending = state.corrections.find(
      (c) => c.sourceCaseId === newCase.id && c.status === "pending",
    );
    expect(pending).toBeDefined();
    if (!pending) return;

    const approved = approveCorrection(state, pending.id);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    state = approved.state;

    const test = runTestChanges(state, pending.fileId);
    expect(test.ok).toBe(true);
    if (!test.ok) return;
    expect(test.result.passed).toBeGreaterThan(0);
  });
});
