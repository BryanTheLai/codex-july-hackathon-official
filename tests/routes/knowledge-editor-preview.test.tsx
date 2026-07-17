import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Correction, PlaybookFile } from "../../src/domain";
import { EditorPane } from "../../src/routes/knowledge/editor-pane";

const selectionFile: PlaybookFile = {
  id: "file-aircon-service-selection",
  path: "playbooks/aircon-service-selection.md",
  title: "Aircon service selection",
  savedContent:
    "# Aircon service selection\n\nRoutine cleaning uses the RM99 general service.\nFor poor cooling and a musty smell, quote the RM99 general service.\nDo not diagnose parts or promise a repair outcome.\n",
  updatedAt: "2026-01-01T00:00:00.000Z",
  protected: true,
};

const selectionCorrection: Correction = {
  id: "corr-aircon-selection",
  fileId: "file-aircon-service-selection",
  oldText: "For poor cooling and a musty smell, quote the RM99 general service.",
  newText:
    "If a wall-mounted 1.0-1.5 HP unit has both poor cooling and a musty smell, recommend the RM160 chemical wash. Do not quote the RM99 general service.",
  evidence: "Combined symptoms need chemical wash.",
  status: "pending",
  sourceCaseId: "case-aircon-selection-train",
  lineHint: 3,
};

describe("Knowledge editor correction preview", () => {
  afterEach(cleanup);

  it("renders exact CodeMirror diff text without remove or add literals", async () => {
    const { container } = render(
      <EditorPane
        corrections={[selectionCorrection]}
        dock={null}
        file={selectionFile}
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
    expect(preview?.textContent).toContain(`- ${selectionCorrection.oldText}`);
    expect(preview?.textContent).toContain(`+ ${selectionCorrection.newText}`);
    expect(preview?.querySelector(".cm-correction-preview__remove")?.textContent).toBe(
      `- ${selectionCorrection.oldText}`,
    );
    expect(preview?.querySelector(".cm-correction-preview__add")?.textContent).toBe(
      `+ ${selectionCorrection.newText}`,
    );
    expect(preview?.textContent).not.toContain("- remove");
    expect(preview?.textContent).not.toContain("+ add");
  });
});
