import { describe, expect, it } from "vitest";

import {
  PlaybookReleaseError,
  activatePlaybookCandidate,
  createCandidateFromCorrection,
  createCandidateFromDraft,
  createCandidateFromFile,
  createCandidateFromFileDeletion,
  createCandidateFromMarkdownImport,
  createCanonicalServerState,
  discardPlaybookCandidate,
  rollbackPlaybook,
} from "../../src/domain";

const TIME = "2026-07-14T12:00:00.000Z";
const SERVICE_SELECTION_FILE_ID = "file-aircon-service-selection";

describe("versioned Knowledge release state", () => {
  it("creates an inactive correction candidate without changing the active Chat bundle", async () => {
    const seed = await createCanonicalServerState();
    const withCorrection = {
      ...seed,
      corrections: [
        {
          id: "corr-aircon-selection",
          fileId: SERVICE_SELECTION_FILE_ID,
          oldText: "For poor cooling and a musty smell, quote the RM99 general service.",
          newText:
            "If a wall-mounted 1.0-1.5 HP unit has both poor cooling and a musty smell, recommend the RM160 chemical wash. Do not quote the RM99 general service.",
          evidence: "Combined symptoms train case failed package selection criterion.",
          status: "pending" as const,
          sourceCaseId: "case-aircon-selection-train",
          lineHint: 4,
        },
      ],
    };
    const correction = withCorrection.corrections[0]!;

    const next = await createCandidateFromCorrection({
      state: withCorrection,
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

  it("composes candidate file edits and removes the candidate when they net to the active bundle", async () => {
    const seed = await createCanonicalServerState();
    const fileId = "file-follow-up";
    const withFile = await createCandidateFromFile({
      state: seed,
      candidateVersionId: "candidate-file",
      file: {
        id: fileId,
        path: "playbooks/follow-up.md",
        title: "Follow-up",
        content: "# Follow-up\nInitial guidance.\n",
      },
      createdAt: TIME,
    });
    const edited = await createCandidateFromDraft({
      state: withFile,
      candidateVersionId: "candidate-edited",
      fileId,
      content: "# Follow-up\nUpdated guidance.\n",
      createdAt: TIME,
    });

    expect(
      edited.playbookHistory.versions
        .find((version) => version.id === "candidate-edited")
        ?.files.find((file) => file.id === fileId)?.content,
    ).toBe("# Follow-up\nUpdated guidance.\n");

    const deleted = await createCandidateFromFileDeletion({
      state: edited,
      candidateVersionId: "candidate-deleted",
      fileId,
      createdAt: TIME,
    });

    expect(deleted.playbookHistory.candidateVersionId).toBeNull();
    expect(deleted.playbookHistory.versions).toHaveLength(1);
    expect(deleted.playbookFiles.some((file) => file.id === fileId)).toBe(false);
  });

  it("discards an inactive candidate without changing the active SOP or rewriting history", async () => {
    const seed = await createCanonicalServerState();
    const rateCard = seed.playbookHistory.versions[0]!.files.find(
      (file) => file.id === "file-aircon-rate-card",
    )!;
    const candidate = await createCandidateFromDraft({
      state: seed,
      candidateVersionId: "candidate-2",
      fileId: rateCard.id,
      content: `${rateCard.content}\nDraft-only instruction.\n`,
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
    expect(discarded.playbookFiles.find((file) => file.id === rateCard.id)?.savedContent).toBe(
      rateCard.content,
    );
  });

  it("requires Ready evidence before activation and restores by creating a new immutable version", async () => {
    const seed = await createCanonicalServerState();
    const rateCard = seed.playbookHistory.versions[0]!.files.find(
      (file) => file.id === "file-aircon-rate-card",
    )!;
    const candidate = await createCandidateFromDraft({
      state: seed,
      candidateVersionId: "candidate-2",
      fileId: rateCard.id,
      content: `${rateCard.content}\nAlways acknowledge a customer concern.\n`,
      createdAt: TIME,
    });

    expect(() =>
      activatePlaybookCandidate({
        state: candidate,
        candidateVersionId: "candidate-2",
        activatedAt: TIME,
      }),
    ).toThrow(new PlaybookReleaseError("release_blocked", "Knowledge candidate is not Ready for activation"));

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
    expect(restored.playbookHistory.rollbackTargetVersionId).toBeNull();
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
        ?.files.find((file) => file.id === rateCard.id)?.content,
    ).toBe(rateCard.content);
    await expect(
      rollbackPlaybook({
        state: restored,
        restoreVersionId: "restore-4",
        createdAt: "2026-07-14T12:06:00.000Z",
      }),
    ).rejects.toThrow("No prior Knowledge version is available to restore");
  });
});
