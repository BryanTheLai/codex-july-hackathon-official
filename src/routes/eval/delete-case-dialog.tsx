import * as AlertDialog from "@radix-ui/react-alert-dialog";

import type { EvalCase, MutationResult } from "../../domain";

export function DeleteCaseDialog({
  evalCase,
  onDelete,
  onOpenChange,
}: {
  evalCase: EvalCase | null;
  onDelete: () => MutationResult;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <AlertDialog.Root onOpenChange={onOpenChange} open={Boolean(evalCase)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="eval-dialog__overlay" />
        <AlertDialog.Content className="eval-dialog__content eval-dialog__content--small">
          <AlertDialog.Title className="eval-dialog__title">
            Delete {evalCase?.title}?
          </AlertDialog.Title>
          <AlertDialog.Description className="eval-dialog__description">
            This removes the case and its run history. Pending Dream corrections from this case
            are removed; approved or rejected corrections keep their decision but lose this case
            link.
          </AlertDialog.Description>
          <div className="eval-dialog__actions">
            <AlertDialog.Cancel asChild>
              <button className="eval-button" type="button">Cancel</button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                className="eval-button eval-button--risk"
                onClick={(event) => {
                  const result = onDelete();
                  if (!result.ok) {
                    event.preventDefault();
                  }
                }}
                type="button"
              >
                Delete case
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
