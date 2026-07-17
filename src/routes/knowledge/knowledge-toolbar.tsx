import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal, Save, TestTube2 } from "lucide-react";

import type { PlaybookFile } from "../../domain";

export function KnowledgeToolbar({
  file,
  onDelete,
  onDiscard,
  onImport,
  onNew,
  onRename,
  onValidate,
  onActivate,
  onDiscardCandidate,
  onRollback,
  onSave,
  onTest,
  pending,
  release,
  releaseBusy,
  saving,
}: {
  file: PlaybookFile | null;
  onDelete: () => void;
  onDiscard: () => void;
  onImport: () => void;
  onNew: () => void;
  onRename: () => void;
  onValidate: () => void;
  onActivate: () => void;
  onDiscardCandidate: () => void;
  onRollback: () => void;
  onSave: () => void;
  onTest: () => void;
  pending: number;
  release: {
    candidateVersionId: string | null;
    candidateReady: boolean;
    rollbackTargetVersionId: string | null;
  } | null;
  releaseBusy: boolean;
  saving: boolean;
}) {
  const dirty = file?.draft !== undefined;
  const rollbackDisabledReason = release?.candidateVersionId
    ? "Discard or activate the candidate before rollback"
    : releaseBusy
      ? "Release action in progress"
      : dirty
        ? "Save or discard draft changes before rollback"
        : !release?.rollbackTargetVersionId
          ? "Available after the first candidate is activated"
          : null;
  const rollbackEnabled = rollbackDisabledReason === null;
  const rollbackLabel = rollbackEnabled ? "Roll back" : `Roll back: ${rollbackDisabledReason}`;

  return (
    <header className="route-toolbar knowledge-toolbar">
      <div className="knowledge-toolbar__identity">
        <h1 id="knowledge-route-title">Knowledge</h1>
        <span className="knowledge-toolbar__path">{file?.path ?? "No file selected"}</span>
        <span>{pending} pending</span>
        <span className={dirty ? "knowledge-state--dirty" : "knowledge-state--saved"}>
          {saving ? "Saving" : dirty ? "Unsaved" : "Saved"}
        </span>
        {release?.candidateVersionId ? (
          <span className="knowledge-state--dirty">
            {release.candidateReady ? "Ready candidate" : "Inactive candidate"}
          </span>
        ) : null}
      </div>
      <div className="knowledge-toolbar__actions">
        <button
          className="knowledge-button"
          disabled={!dirty || saving}
          onClick={onSave}
          type="button"
        >
          <Save aria-hidden="true" size={15} />
          {saving ? "Saving" : "Save"}
        </button>
        <button className="knowledge-button" disabled={!file} onClick={onTest} type="button">
          <TestTube2 aria-hidden="true" size={15} />
          Check saved text
        </button>
        {release?.candidateVersionId ? (
          <>
            <button
              className="knowledge-button knowledge-release-action"
              disabled={releaseBusy}
              onClick={onValidate}
              title="Checks affected train cases, then the full train and holdout suite."
              type="button"
            >
              Validate candidate
            </button>
            <button
              className="knowledge-button knowledge-button--primary knowledge-release-action"
              disabled={!release.candidateReady || releaseBusy}
              onClick={onActivate}
              title={
                release.candidateReady
                  ? "Activate this validated Knowledge version."
                  : "Validate the candidate before activation."
              }
              type="button"
            >
              {release.candidateReady ? "Activate" : "Validate first"}
            </button>
            <button
              className="knowledge-button knowledge-release-action"
              disabled={releaseBusy}
              onClick={onDiscardCandidate}
              type="button"
            >
              Discard candidate
            </button>
          </>
        ) : null}
        <button
          aria-label={rollbackLabel}
          className="knowledge-button"
          disabled={!rollbackEnabled}
          onClick={onRollback}
          title={rollbackDisabledReason ?? undefined}
          type="button"
        >
          Roll back
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button aria-label="More file actions" className="knowledge-button knowledge-toolbar__more" type="button">
              <MoreHorizontal aria-hidden="true" size={16} />
              More
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" className="knowledge-menu" sideOffset={4}>
              {release?.candidateVersionId ? (
                <>
                  <DropdownMenu.Item
                    className="knowledge-menu__item knowledge-menu__release"
                    disabled={releaseBusy}
                    onSelect={onValidate}
                  >
                    Validate candidate
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="knowledge-menu__item knowledge-menu__release"
                    disabled={!release.candidateReady || releaseBusy}
                    onSelect={onActivate}
                  >
                    Activate candidate
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="knowledge-menu__item knowledge-menu__item--risk knowledge-menu__release"
                    disabled={releaseBusy}
                    onSelect={onDiscardCandidate}
                  >
                    Discard candidate
                  </DropdownMenu.Item>
                </>
              ) : null}
              <DropdownMenu.Item className="knowledge-menu__item" onSelect={onNew}>
                New File
              </DropdownMenu.Item>
              <DropdownMenu.Item className="knowledge-menu__item" onSelect={onImport}>
                Import Markdown
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="knowledge-menu__item"
                disabled={!file}
                onSelect={onRename}
              >
                Rename
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="knowledge-menu__item knowledge-menu__item--risk"
                disabled={!file}
                onSelect={onDelete}
              >
                Delete
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="knowledge-menu__item"
                disabled={!dirty}
                onSelect={onDiscard}
              >
                Discard draft
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );
}
