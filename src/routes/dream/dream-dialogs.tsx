import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";

import type { MutationResult, PlaybookFile } from "../../domain";

function parentLocation(path: string): string {
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
  const separator = normalized.lastIndexOf("/");
  return separator === -1 ? "" : `${normalized.slice(0, separator)}/`;
}

function fileName(path: string): string {
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function titleFileName(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `${slug}.md` : "";
}

export function FileDialog({
  file,
  initialPath,
  mode,
  onCreate,
  onOpenChange,
  onRename,
  open,
}: {
  file: PlaybookFile | null;
  initialPath: string;
  mode: "create" | "rename";
  onCreate: (path: string, title: string) => MutationResult;
  onOpenChange: (open: boolean) => void;
  onRename: (path: string, title: string) => MutationResult;
  open: boolean;
}) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [error, setError] = useState("");
  const location =
    mode === "rename" ? parentLocation(file?.path ?? initialPath) : initialPath;

  useEffect(() => {
    if (!open) {
      return;
    }
    setName(mode === "rename" ? fileName(file?.path ?? "") : "");
    setTitle(mode === "rename" ? file?.title ?? "" : "");
    setNameEdited(mode === "rename");
    setError("");
  }, [file?.path, file?.title, initialPath, mode, open]);

  const submit = () => {
    const path = `${location}${name}`;
    const result =
      mode === "create" ? onCreate(path, title) : onRename(path, title);
    if (result.ok) {
      onOpenChange(false);
      return;
    }
    setError(result.error);
  };

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="dream-dialog__overlay" />
        <Dialog.Content className="dream-dialog__content">
          <Dialog.Title className="dream-dialog__title">
            {mode === "create" ? "New playbook file" : "Rename playbook file"}
          </Dialog.Title>
          <Dialog.Description className="dream-dialog__description">
            {mode === "create" ? "Create in" : "Rename inside"} <code>{location}</code>
          </Dialog.Description>
          <label className="dream-dialog__field">
            File title
            <input
              aria-label="File title"
              onChange={(event) => {
                const nextTitle = event.target.value;
                setTitle(nextTitle);
                if (!nameEdited) {
                  setName(titleFileName(nextTitle));
                }
              }}
              value={title}
            />
          </label>
          <label className="dream-dialog__field">
            File name
            <input
              aria-label="File name"
              onChange={(event) => {
                setNameEdited(true);
                setName(event.target.value);
              }}
              placeholder="follow-up.md"
              value={name}
            />
          </label>
          {error ? <p className="dream-inline-error" role="alert">{error}</p> : null}
          <div className="dream-dialog__actions">
            <Dialog.Close asChild>
              <button className="dream-button" type="button">Cancel</button>
            </Dialog.Close>
            <button
              className="dream-button dream-button--primary"
              disabled={!name.trim() || !title.trim()}
              onClick={submit}
              type="button"
            >
              {mode === "create" ? "Create file" : "Save file name"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function FolderDialog({
  parentPath,
  onCreate,
  onOpenChange,
  open,
}: {
  parentPath: string;
  onCreate: (path: string) => MutationResult;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
      setError("");
    }
  }, [open]);

  const submit = () => {
    const result = onCreate(`${parentPath}/${name}`);
    if (result.ok) {
      onOpenChange(false);
      return;
    }
    setError(result.error);
  };

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="dream-dialog__overlay" />
        <Dialog.Content className="dream-dialog__content">
          <Dialog.Title className="dream-dialog__title">New playbook folder</Dialog.Title>
          <Dialog.Description className="dream-dialog__description">
            Create inside <code>{parentPath}/</code>
          </Dialog.Description>
          <label className="dream-dialog__field">
            Folder name
            <input
              aria-label="Folder name"
              autoFocus
              onChange={(event) => setName(event.target.value)}
              placeholder="follow-up"
              value={name}
            />
          </label>
          {error ? <p className="dream-inline-error" role="alert">{error}</p> : null}
          <div className="dream-dialog__actions">
            <Dialog.Close asChild>
              <button className="dream-button" type="button">Cancel</button>
            </Dialog.Close>
            <button
              className="dream-button dream-button--primary"
              disabled={!name.trim()}
              onClick={submit}
              type="button"
            >
              Create folder
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function DeleteFileDialog({
  file,
  onDelete,
  onOpenChange,
  open,
}: {
  file: PlaybookFile | null;
  onDelete: () => MutationResult;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setError("");
    }
  }, [open]);
  return (
    <AlertDialog.Root onOpenChange={onOpenChange} open={open}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dream-dialog__overlay" />
        <AlertDialog.Content className="dream-dialog__content">
          <AlertDialog.Title className="dream-dialog__title">
            Delete {file?.path ?? "playbook file"}?
          </AlertDialog.Title>
          <AlertDialog.Description className="dream-dialog__description">
            Protected seed files and files with correction history cannot be deleted.
          </AlertDialog.Description>
          {error ? <p className="dream-inline-error" role="alert">{error}</p> : null}
          <div className="dream-dialog__actions">
            <AlertDialog.Cancel asChild>
              <button className="dream-button" type="button">Cancel</button>
            </AlertDialog.Cancel>
            <button
              className="dream-button dream-button--risk"
              onClick={() => {
                const result = onDelete();
                if (result.ok) {
                  onOpenChange(false);
                } else {
                  setError(result.error);
                }
              }}
              type="button"
            >
              Delete file
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export function DiscardDraftDialog({
  file,
  onDiscard,
  onOpenChange,
  open,
}: {
  file: PlaybookFile | null;
  onDiscard: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <AlertDialog.Root onOpenChange={onOpenChange} open={open}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dream-dialog__overlay" />
        <AlertDialog.Content className="dream-dialog__content">
          <AlertDialog.Title className="dream-dialog__title">
            Discard draft for {file?.path ?? "this file"}?
          </AlertDialog.Title>
          <AlertDialog.Description className="dream-dialog__description">
            Only unsaved draft text is removed. The last saved playbook stays unchanged.
          </AlertDialog.Description>
          <div className="dream-dialog__actions">
            <AlertDialog.Cancel asChild>
              <button className="dream-button" type="button">Keep draft</button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button className="dream-button dream-button--risk" onClick={onDiscard} type="button">
                Discard draft
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
