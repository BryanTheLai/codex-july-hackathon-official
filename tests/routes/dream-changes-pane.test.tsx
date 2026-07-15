import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Correction, PlaybookFile } from "../../src/domain";
import { ChangesPane } from "../../src/routes/dream/changes-pane";

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

describe("Dream changes pane", () => {
  afterEach(cleanup);

  it("does not call onFocus when the nested Eval case link is clicked", async () => {
    const user = userEvent.setup();
    const onFocus = vi.fn();
    const onOpenEval = vi.fn();

    render(
      <ChangesPane
        corrections={[triageCorrection]}
        file={triageFile}
        focusedCorrectionId={null}
        onApprove={vi.fn()}
        onFocus={onFocus}
        onOpenEval={onOpenEval}
        onReject={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Eval case case-emergency-train/i }));

    expect(onOpenEval).toHaveBeenCalledWith("case-emergency-train");
    expect(onFocus).not.toHaveBeenCalled();
  });
});
