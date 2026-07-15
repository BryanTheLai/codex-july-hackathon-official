import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal, Save, TestTube2 } from "lucide-react";

import type { PlaybookFile } from "../../domain";

export function DreamToolbar({
  file,
  onDelete,
  onDiscard,
  onNew,
  onRename,
  onSave,
  onTest,
  pending,
  saving,
}: {
  file: PlaybookFile | null;
  onDelete: () => void;
  onDiscard: () => void;
  onNew: () => void;
  onRename: () => void;
  onSave: () => void;
  onTest: () => void;
  pending: number;
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
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button aria-label="More file actions" className="dream-button dream-toolbar__more" type="button">
              <MoreHorizontal aria-hidden="true" size={16} />
              More
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" className="dream-menu" sideOffset={4}>
              <DropdownMenu.Item className="dream-menu__item" onSelect={onNew}>
                New File
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
