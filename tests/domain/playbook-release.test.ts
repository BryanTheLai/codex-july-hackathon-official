import { describe, expect, it } from "vitest";

import {
  PlaybookReleaseError,
  activatePlaybookCandidate,
  createCandidateFromCorrection,
  createCandidateFromDraft,
  createCandidateFromMarkdownImport,
  createCanonicalServerState,
  discardPlaybookCandidate,
  rollbackPlaybook,
} from "../../src/domain";

const TIME = "2026-07-14T12:00:00.000Z";

describe("versioned Dream release state", () => {
  it("creates an inactive correction candidate without changing the active Chat bundle", async () => {
    const seed = await createCanonicalServerState();
    const correction = seed.corrections.find(
      (candidate) => candidate.fileId === "file-triage" && candidate.status === "pending",
    )!;

    const next = await createCandidateFromCorrection({
      state: seed,
      candidateVersionId: "candidate-2",
      correctionId: correction.id,
      createdAt: TIME,
    });

    const active = next.playbookHistory.versions.find(
      (candidate) => candidate.id === next.playbookHistory.activeVersionId,
    )!;
    const candidate = next.playbookHistory.versions.find((item) => item.id === "candidate-2")!;
    expect(next.playbookHistory.activeVersionId).toBe("playbook-version-1");
    expect(next.playbookHistory.candidateVersionId).toBe(candidate.id);
    expect(active.files.find((file) => file.id === correction.fileId)?.content).toContain(
      correction.oldText,
    );
    expect(candidate.files.find((file) => file.id === correction.fileId)?.content).toContain(
      correction.newText,
    );
    expect(next.corrections.find((item) => item.id === correction.id)?.status).toBe("approved");
  });

  it("accepts Markdown as an inactive bundle candidate instead of bypassing release review", async () => {
    const seed = await createCanonicalServerState();

    const next = await createCandidateFromMarkdownImport({
      state: seed,
      candidateVersionId: "candidate-import",
      fileId: "file-imported-sop",
      path: "playbooks/imported/intake.md",
      title: "Imported intake SOP",
      content: "# Intake\nVerify the caller's identity before discussing care.\n",
      createdAt: TIME,
    });

    expect(next.playbookHistory.activeVersionId).toBe("playbook-version-1");
    expect(next.playbookHistory.candidateVersionId).toBe("candidate-import");
    expect(
      next.playbookHistory.versions
        .find((candidate) => candidate.id === "candidate-import")
        ?.files.find((file) => file.id === "file-imported-sop"),
    ).toEqual(
      expect.objectContaining({ path: "playbooks/imported/intake.md" }),
    );
  });

  it("discards an inactive candidate without changing the active SOP or rewriting history", async () => {
    const seed = await createCanonicalServerState();
    const triage = seed.playbookHistory.versions[0]!.files.find((file) => file.id === "file-triage")!;
    const candidate = await createCandidateFromDraft({
      state: seed,
      candidateVersionId: "candidate-2",
      fileId: triage.id,
      content: `${triage.content}\nDraft-only instruction.\n`,
      createdAt: TIME,
    });

    const discarded = discardPlaybookCandidate({
      state: candidate,
      candidateVersionId: "candidate-2",
      discardedAt: "2026-07-14T12:03:00.000Z",
    });

    expect(discarded.playbookHistory.candidateVersionId).toBeNull();
    expect(discarded.playbookHistory.activeVersionId).toBe("playbook-version-1");
    expect(discarded.playbookHistory.versions.some((version) => version.id === "candidate-2")).toBe(true);
    expect(discarded.playbookFiles.find((file) => file.id === triage.id)?.savedContent).toBe(triage.content);
  });

  it("requires Ready evidence before activation and restores by creating a new immutable version", async () => {
    const seed = await createCanonicalServerState();
    const triage = seed.playbookHistory.versions[0]!.files.find((file) => file.id === "file-triage")!;
    const candidate = await createCandidateFromDraft({
      state: seed,
      candidateVersionId: "candidate-2",
      fileId: triage.id,
      content: `${triage.content}\nAlways acknowledge a patient concern.\n`,
      createdAt: TIME,
    });

    expect(() =>
      activatePlaybookCandidate({
        state: candidate,
        candidateVersionId: "candidate-2",
        activatedAt: TIME,
      }),
    ).toThrow(new PlaybookReleaseError("release_blocked", "Dream candidate is not Ready for activation"));

    const ready = structuredClone(candidate);
    ready.playbookHistory.versions.find((item) => item.id === "candidate-2")!.passingSuiteId =
      "suite-full";
    const activated = activatePlaybookCandidate({
      state: ready,
      candidateVersionId: "candidate-2",
      activatedAt: TIME,
    });
    const restored = await rollbackPlaybook({
      state: activated,
      restoreVersionId: "restore-3",
      createdAt: "2026-07-14T12:05:00.000Z",
    });

    expect(activated.playbookHistory.activeVersionId).toBe("candidate-2");
    expect(activated.playbookHistory.rollbackTargetVersionId).toBe("playbook-version-1");
    expect(restored.playbookHistory.activeVersionId).toBe("restore-3");
    expect(restored.playbookHistory.rollbackTargetVersionId).toBe("candidate-2");
    expect(restored.playbookHistory.versions.find((item) => item.id === "restore-3")).toEqual(
      expect.objectContaining({
        kind: "restore",
        parentVersionId: "candidate-2",
        restoredFromVersionId: "playbook-version-1",
      }),
    );
    expect(
      restored.playbookHistory.versions
        .find((item) => item.id === "restore-3")
        ?.files.find((file) => file.id === triage.id)?.content,
    ).toBe(triage.content);
  });
});
