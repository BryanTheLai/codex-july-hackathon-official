import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Correction, PlaybookFile } from "../../src/domain";
import { EditorPane } from "../../src/routes/dream/editor-pane";

const triageFile: PlaybookFile = {
  id: "file-triage",
  path: "playbooks/triage.md",
  title: "Triage",
  savedContent:
    "# Triage\n\nSeek urgent care for chest pain.\nAsk about sweating and breathing difficulty.\n",
  updatedAt: "2026-01-01T00:00:00.000Z",
  protected: true,
};

const triageCorrection: Correction = {
  id: "corr-triage",
  fileId: "file-triage",
  oldText: "Seek urgent care for chest pain.",
  newText: "Call 999 guidance for chest pain with sweating.",
  evidence: "English emergency train case failed blocking criterion.",
  status: "pending",
  sourceCaseId: "case-emergency-train",
  lineHint: 3,
};

describe("Dream editor correction preview", () => {
  afterEach(cleanup);

  it("renders exact CodeMirror diff text without remove or add literals", async () => {
    const { container } = render(
      <EditorPane
        corrections={[triageCorrection]}
        dock={null}
        file={triageFile}
        focusedCorrectionId={null}
        focusLine={null}
        focusRequest={0}
        onChange={() => undefined}
        onSave={() => undefined}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector(".cm-correction-preview")).toBeTruthy();
    });

    const preview = container.querySelector(".cm-correction-preview");
    expect(preview?.textContent).toContain("- Seek urgent care for chest pain.");
    expect(preview?.textContent).toContain("+ Call 999 guidance for chest pain with sweating.");
    expect(preview?.querySelector(".cm-correction-preview__remove")?.textContent).toBe(
      "- Seek urgent care for chest pain.",
    );
    expect(preview?.querySelector(".cm-correction-preview__add")?.textContent).toBe(
      "+ Call 999 guidance for chest pain with sweating.",
    );
    expect(preview?.textContent).not.toContain("- remove");
    expect(preview?.textContent).not.toContain("+ add");
  });
});
