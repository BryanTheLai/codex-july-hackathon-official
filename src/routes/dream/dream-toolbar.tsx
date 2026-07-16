import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal, Save, TestTube2 } from "lucide-react";

import type { PlaybookFile } from "../../domain";

export function DreamToolbar({
  file,
  onDelete,
  onDiscard,
  onImport,
  onNew,
  onRename,
  onReplayAffected,
  onReplayFull,
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
  onReplayAffected: () => void;
  onReplayFull: () => void;
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
  return (
    <header className="route-toolbar dream-toolbar">
      <div className="dream-toolbar__identity">
        <h1 id="dream-route-title">Dream</h1>
        <span className="dream-toolbar__path">{file?.path ?? "No file selected"}</span>
        <span>{pending} pending</span>
        <span className={dirty ? "dream-state--dirty" : "dream-state--saved"}>
          {saving ? "Saving" : dirty ? "Unsaved" : "Saved"}
        </span>
        {release?.candidateVersionId ? (
          <span className="dream-state--dirty">
            {release.candidateReady ? "Ready candidate" : "Inactive candidate"}
          </span>
        ) : null}
      </div>
      <div className="dream-toolbar__actions">
        <button
          className="dream-button"
          disabled={!dirty || saving}
          onClick={onSave}
          type="button"
        >
          <Save aria-hidden="true" size={15} />
          {saving ? "Saving" : "Save"}
        </button>
        <button className="dream-button" disabled={!file} onClick={onTest} type="button">
          <TestTube2 aria-hidden="true" size={15} />
          Test Changes
        </button>
        {release?.candidateVersionId ? (
          <>
            <button className="dream-button" disabled={releaseBusy} onClick={onReplayAffected} type="button">
              Replay affected
            </button>
            <button
              className="dream-button dream-release-action"
              disabled={releaseBusy}
              onClick={onReplayFull}
              type="button"
            >
              Full replay
            </button>
            <button
              className="dream-button dream-button--primary dream-release-action"
              disabled={!release.candidateReady || releaseBusy}
              onClick={onActivate}
              type="button"
            >
              Activate
            </button>
            <button
              className="dream-button dream-release-action"
              disabled={releaseBusy}
              onClick={onDiscardCandidate}
              type="button"
            >
              Discard candidate
            </button>
          </>
        ) : null}
        {release?.rollbackTargetVersionId ? (
          <button className="dream-button" disabled={dirty || releaseBusy} onClick={onRollback} type="button">
            Roll back
          </button>
        ) : null}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button aria-label="More file actions" className="dream-button dream-toolbar__more" type="button">
              <MoreHorizontal aria-hidden="true" size={16} />
              More
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" className="dream-menu" sideOffset={4}>
              {release?.candidateVersionId ? (
                <>
                  <DropdownMenu.Item
                    className="dream-menu__item dream-menu__release"
                    disabled={releaseBusy}
                    onSelect={onReplayFull}
                  >
                    Full replay
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="dream-menu__item dream-menu__release"
                    disabled={!release.candidateReady || releaseBusy}
                    onSelect={onActivate}
                  >
                    Activate candidate
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="dream-menu__item dream-menu__item--risk dream-menu__release"
                    disabled={releaseBusy}
                    onSelect={onDiscardCandidate}
                  >
                    Discard candidate
                  </DropdownMenu.Item>
                </>
              ) : null}
              <DropdownMenu.Item className="dream-menu__item" onSelect={onNew}>
                New File
              </DropdownMenu.Item>
              <DropdownMenu.Item className="dream-menu__item" onSelect={onImport}>
                Import Markdown
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="dream-menu__item"
                disabled={!file}
                onSelect={onRename}
              >
                Rename
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="dream-menu__item dream-menu__item--risk"
                disabled={!file}
                onSelect={onDelete}
              >
                Delete
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="dream-menu__item"
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
