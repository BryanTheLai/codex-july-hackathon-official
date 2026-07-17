import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Correction, PlaybookFile } from "../../src/domain";
import { ChangesPane } from "../../src/routes/knowledge/changes-pane";

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

describe("Knowledge changes pane", () => {
  afterEach(cleanup);

  it("does not call onFocus when the nested Eval case link is clicked", async () => {
    const user = userEvent.setup();
    const onFocus = vi.fn();
    const onOpenEval = vi.fn();

    render(
      <ChangesPane
        corrections={[selectionCorrection]}
        file={selectionFile}
        focusedCorrectionId={null}
        onApprove={vi.fn()}
        onFocus={onFocus}
        onOpenEval={onOpenEval}
        onReject={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Eval case case-aircon-selection-train/i }));

    expect(onOpenEval).toHaveBeenCalledWith("case-aircon-selection-train");
    expect(onFocus).not.toHaveBeenCalled();
  });
});
