import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { createCanonicalSeed } from "../../src/domain";
import { KnowledgeToolbar } from "../../src/routes/knowledge/knowledge-toolbar";

describe("Knowledge toolbar", () => {
  it("names saved-text and behavioral replay actions by their actual scope", () => {
    const file = createCanonicalSeed().playbookFiles[0]!;
    const action = vi.fn();
    render(
      <MemoryRouter>
        <KnowledgeToolbar
          file={file}
          onActivate={action}
          onDelete={action}
          onDiscard={action}
          onDiscardCandidate={action}
          onImport={action}
          onNew={action}
          onRename={action}
          onReplayAffected={action}
          onReplayFull={action}
          onRollback={action}
          onSave={action}
          onTest={action}
          pending={0}
          release={{
            candidateReady: false,
            candidateVersionId: "candidate-1",
            rollbackTargetVersionId: null,
          }}
          releaseBusy={false}
          saving={false}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Check saved text" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replay affected train cases" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replay all eval cases" })).toBeInTheDocument();
  });

  it("always renders Roll back disabled with reason before first activation", () => {
    const file = createCanonicalSeed().playbookFiles[0]!;
    render(
      <MemoryRouter>
        <KnowledgeToolbar
          file={file}
          onActivate={vi.fn()}
          onDelete={vi.fn()}
          onDiscard={vi.fn()}
          onDiscardCandidate={vi.fn()}
          onImport={vi.fn()}
          onNew={vi.fn()}
          onRename={vi.fn()}
          onReplayAffected={vi.fn()}
          onReplayFull={vi.fn()}
          onRollback={vi.fn()}
          onSave={vi.fn()}
          onTest={vi.fn()}
          pending={0}
          release={{
            candidateReady: false,
            candidateVersionId: null,
            rollbackTargetVersionId: null,
          }}
          releaseBusy={false}
          saving={false}
        />
      </MemoryRouter>,
    );

    const rollback = screen.getByRole("button", {
      name: "Roll back: Available after the first candidate is activated",
    });
    expect(rollback).toBeDisabled();
    expect(rollback).toHaveAttribute(
      "title",
      "Available after the first candidate is activated",
    );
  });

  it("disables Roll back while draft is dirty", () => {
    const file = {
      ...createCanonicalSeed().playbookFiles[0]!,
      draft: "pending edit",
    };
    render(
      <MemoryRouter>
        <KnowledgeToolbar
          file={file}
          onActivate={vi.fn()}
          onDelete={vi.fn()}
          onDiscard={vi.fn()}
          onDiscardCandidate={vi.fn()}
          onImport={vi.fn()}
          onNew={vi.fn()}
          onRename={vi.fn()}
          onReplayAffected={vi.fn()}
          onReplayFull={vi.fn()}
          onRollback={vi.fn()}
          onSave={vi.fn()}
          onTest={vi.fn()}
          pending={0}
          release={{
            candidateReady: false,
            candidateVersionId: null,
            rollbackTargetVersionId: "version-1",
          }}
          releaseBusy={false}
          saving={false}
        />
      </MemoryRouter>,
    );

    const rollback = screen.getByRole("button", {
      name: "Roll back: Save or discard draft changes before rollback",
    });
    expect(rollback).toBeDisabled();
    expect(rollback).toHaveAttribute("title", "Save or discard draft changes before rollback");
  });

  it("disables Roll back while a release action is in progress", () => {
    const file = createCanonicalSeed().playbookFiles[0]!;
    render(
      <MemoryRouter>
        <KnowledgeToolbar
          file={file}
          onActivate={vi.fn()}
          onDelete={vi.fn()}
          onDiscard={vi.fn()}
          onDiscardCandidate={vi.fn()}
          onImport={vi.fn()}
          onNew={vi.fn()}
          onRename={vi.fn()}
          onReplayAffected={vi.fn()}
          onReplayFull={vi.fn()}
          onRollback={vi.fn()}
          onSave={vi.fn()}
          onTest={vi.fn()}
          pending={0}
          release={{
            candidateReady: false,
            candidateVersionId: null,
            rollbackTargetVersionId: "version-1",
          }}
          releaseBusy={true}
          saving={false}
        />
      </MemoryRouter>,
    );

    const rollback = screen.getByRole("button", {
      name: "Roll back: Release action in progress",
    });
    expect(rollback).toBeDisabled();
    expect(rollback).toHaveAttribute("title", "Release action in progress");
  });

  it("disables Roll back while a candidate is present", () => {
    const file = createCanonicalSeed().playbookFiles[0]!;
    render(
      <MemoryRouter>
        <KnowledgeToolbar
          file={file}
          onActivate={vi.fn()}
          onDelete={vi.fn()}
          onDiscard={vi.fn()}
          onDiscardCandidate={vi.fn()}
          onImport={vi.fn()}
          onNew={vi.fn()}
          onRename={vi.fn()}
          onReplayAffected={vi.fn()}
          onReplayFull={vi.fn()}
          onRollback={vi.fn()}
          onSave={vi.fn()}
          onTest={vi.fn()}
          pending={0}
          release={{
            candidateReady: false,
            candidateVersionId: "candidate-1",
            rollbackTargetVersionId: "version-1",
          }}
          releaseBusy={false}
          saving={false}
        />
      </MemoryRouter>,
    );

    const toolbar = document.querySelector(".knowledge-toolbar") as HTMLElement;
    const rollback = within(toolbar).getByRole("button", {
      name: "Roll back: Discard or activate the candidate before rollback",
    });
    expect(rollback).toBeDisabled();
    expect(rollback).toHaveAttribute(
      "title",
      "Discard or activate the candidate before rollback",
    );
  });

  it("enables Roll back when a rollback target exists and draft is clean", () => {
    const file = createCanonicalSeed().playbookFiles[0]!;
    const onRollback = vi.fn();
    render(
      <MemoryRouter>
        <KnowledgeToolbar
          file={file}
          onActivate={vi.fn()}
          onDelete={vi.fn()}
          onDiscard={vi.fn()}
          onDiscardCandidate={vi.fn()}
          onImport={vi.fn()}
          onNew={vi.fn()}
          onRename={vi.fn()}
          onReplayAffected={vi.fn()}
          onReplayFull={vi.fn()}
          onRollback={onRollback}
          onSave={vi.fn()}
          onTest={vi.fn()}
          pending={0}
          release={{
            candidateReady: false,
            candidateVersionId: null,
            rollbackTargetVersionId: "version-1",
          }}
          releaseBusy={false}
          saving={false}
        />
      </MemoryRouter>,
    );

    const rollback = screen.getByRole("button", { name: "Roll back" });
    expect(rollback).toBeEnabled();
    rollback.click();
    expect(onRollback).toHaveBeenCalledOnce();
  });
});
