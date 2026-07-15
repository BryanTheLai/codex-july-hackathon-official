import * as AlertDialog from "@radix-ui/react-alert-dialog";
import type { ReactNode } from "react";

export function ConfirmAction({
  confirmLabel,
  description,
  onConfirm,
  title,
  trigger,
}: {
  confirmLabel: string;
  description: string;
  onConfirm: () => void;
  title: string;
  trigger: ReactNode;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="chat-dialog__overlay" />
        <AlertDialog.Content className="chat-dialog__content">
          <AlertDialog.Title className="chat-dialog__title">{title}</AlertDialog.Title>
          <AlertDialog.Description className="chat-dialog__description">
            {description}
          </AlertDialog.Description>
          <div className="chat-dialog__actions">
            <AlertDialog.Cancel asChild>
              <button className="chat-button" type="button">
                Cancel
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                className="chat-button chat-button--risk"
                onClick={onConfirm}
                type="button"
              >
                {confirmLabel}
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
