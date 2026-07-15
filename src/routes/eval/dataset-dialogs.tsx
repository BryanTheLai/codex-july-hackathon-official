import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";

import type { EvalDataset, MutationResult } from "../../domain";

export function DatasetDialog({
  dataset,
  mode,
  open,
  onCreate,
  onOpenChange,
  onRename,
}: {
  dataset: EvalDataset;
  mode: "create" | "rename";
  open: boolean;
  onCreate: (name: string) => MutationResult;
  onOpenChange: (open: boolean) => void;
  onRename: (name: string) => MutationResult;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setName(mode === "rename" ? dataset.name : "");
      setError("");
    }
  }, [dataset.name, mode, open]);

  const submit = () => {
    const result = mode === "create" ? onCreate(name) : onRename(name);
    if (result.ok) {
      onOpenChange(false);
    } else {
      setError(result.error);
    }
  };

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="eval-dialog__overlay" />
        <Dialog.Content className="eval-dialog__content eval-dialog__content--small">
          <Dialog.Title className="eval-dialog__title">
            {mode === "create" ? "New dataset" : "Rename dataset"}
          </Dialog.Title>
          <Dialog.Description className="eval-dialog__description">
            Datasets isolate cases, criteria, candidate versions, and run history.
          </Dialog.Description>
          <label className="eval-dialog__field">
            Dataset name
            <input
              aria-label="Dataset name"
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </label>
          {error ? <p className="eval-inline-error" role="alert">{error}</p> : null}
          <div className="eval-dialog__actions">
            <Dialog.Close asChild>
              <button className="eval-button" type="button">Cancel</button>
            </Dialog.Close>
            <button className="eval-button eval-button--primary" onClick={submit} type="button">
              {mode === "create" ? "Create dataset" : "Save dataset name"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function DeleteDatasetDialog({
  dataset,
  open,
  onDelete,
  onOpenChange,
}: {
  dataset: EvalDataset;
  open: boolean;
  onDelete: () => MutationResult;
  onOpenChange: (open: boolean) => void;
}) {
  const [error, setError] = useState("");
  return (
    <AlertDialog.Root onOpenChange={onOpenChange} open={open}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="eval-dialog__overlay" />
        <AlertDialog.Content className="eval-dialog__content eval-dialog__content--small">
          <AlertDialog.Title className="eval-dialog__title">
            Delete {dataset.name}?
          </AlertDialog.Title>
          <AlertDialog.Description className="eval-dialog__description">
            This deletes the dataset, its cases, criteria, suite snapshots, and run history. The
            protected synthetic seed and last dataset cannot be deleted.
          </AlertDialog.Description>
          {error ? <p className="eval-inline-error" role="alert">{error}</p> : null}
          <div className="eval-dialog__actions">
            <AlertDialog.Cancel asChild>
              <button className="eval-button" type="button">Cancel</button>
            </AlertDialog.Cancel>
            <button
              className="eval-button eval-button--risk"
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
              Delete dataset
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
