import * as Dialog from "@radix-ui/react-dialog";
import { CheckCircle2, CircleAlert, Clock3 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  hitlImportAvailability,
  type Conversation,
  type EvalDataset,
  type MutationResult,
} from "../../domain";

const STATUS_COPY = {
  already_imported: "Already imported",
  no_staff_reply: "No staff reply",
  ready: "Ready",
  unresolved: "Resolve in Chat",
} as const;

export function ImportHitlDialog({
  conversations,
  dataset,
  open,
  preferredConversationId,
  onImport,
  onOpenChange,
}: {
  conversations: Conversation[];
  dataset: EvalDataset;
  open: boolean;
  preferredConversationId?: string | null;
  onImport: (conversationIds: string[]) => MutationResult;
  onOpenChange: (open: boolean) => void;
}) {
  const rows = useMemo(
    () =>
      conversations.map((conversation) => ({
        availability: hitlImportAvailability(conversation, dataset),
        conversation,
        latestStaffReply: [...conversation.messages]
          .reverse()
          .find((message) => message.role === "staff")?.text,
      })),
    [conversations, dataset],
  );
  const availableIds = useMemo(
    () =>
      rows
        .filter((row) => row.availability.status === "ready")
        .map((row) => row.conversation.id),
    [rows],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submitTimer = useRef<number | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      const preferred = rows.find(
        (row) =>
          row.conversation.id === preferredConversationId &&
          row.availability.status === "ready",
      );
      setSelectedIds(preferred ? [preferred.conversation.id] : []);
      setError("");
    }
  }, [open, preferredConversationId, rows]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate =
        selectedIds.length > 0 && selectedIds.length < availableIds.length;
    }
  }, [availableIds.length, selectedIds.length]);

  useEffect(
    () => () => {
      if (submitTimer.current !== null) {
        window.clearTimeout(submitTimer.current);
      }
    },
    [],
  );

  const submit = () => {
    setSubmitting(true);
    submitTimer.current = window.setTimeout(() => {
      const result = onImport(selectedIds);
      setSubmitting(false);
      if (result.ok) {
        onOpenChange(false);
      } else {
        setError(result.error);
      }
    }, 40);
  };

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen && submitTimer.current !== null) {
      window.clearTimeout(submitTimer.current);
      submitTimer.current = null;
      setSubmitting(false);
    }
    onOpenChange(nextOpen);
  };

  const selectedCount = selectedIds.length;
  const importLabel =
    selectedCount === 0
      ? "Import conversations"
      : `Import ${selectedCount} ${selectedCount === 1 ? "conversation" : "conversations"}`;

  return (
    <Dialog.Root onOpenChange={changeOpen} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="eval-dialog__overlay" />
        <Dialog.Content className="eval-dialog__content eval-dialog__content--import">
          <Dialog.Title className="eval-dialog__title">Import resolved conversations</Dialog.Title>
          <Dialog.Description className="eval-dialog__description">
            Each resolved conversation becomes one test. The staff reply is the hidden human in
            the loop (HITL) reference; earlier messages become the replay input.
          </Dialog.Description>
          <div className="eval-import">
            <label className="eval-import__select-all">
              <input
                aria-label="Select all available conversations"
                checked={
                  availableIds.length > 0 && selectedIds.length === availableIds.length
                }
                disabled={availableIds.length === 0 || submitting}
                onChange={(event) =>
                  setSelectedIds(event.target.checked ? availableIds : [])
                }
                ref={selectAllRef}
                type="checkbox"
              />
              <span>Select all available</span>
              <b>{availableIds.length}</b>
            </label>
            <div aria-label="Conversation import list" className="eval-import__list" role="group">
              {rows.map(({ availability, conversation, latestStaffReply }) => {
                const ready = availability.status === "ready";
                const selected = selectedIds.includes(conversation.id);
                const statusCopy = STATUS_COPY[availability.status];
                return (
                  <label
                    className={`eval-import__row${
                      ready ? "" : " eval-import__row--disabled"
                    }`}
                    key={conversation.id}
                  >
                    <input
                      aria-label={`${conversation.patient.name}, ${statusCopy}`}
                      checked={selected}
                      disabled={!ready || submitting}
                      onChange={(event) =>
                        setSelectedIds((current) =>
                          event.target.checked
                            ? [...current, conversation.id]
                            : current.filter((id) => id !== conversation.id),
                        )
                      }
                      type="checkbox"
                    />
                    <span className="eval-import__identity">
                      <strong>{conversation.patient.name}</strong>
                      <small>
                        {latestStaffReply ?? "No human-reviewed staff reply is available."}
                      </small>
                    </span>
                    <span
                      className={`eval-import__status eval-import__status--${availability.status}`}
                    >
                      {availability.status === "ready" ||
                      availability.status === "already_imported" ? (
                        <CheckCircle2 aria-hidden="true" size={13} />
                      ) : availability.status === "unresolved" ? (
                        <Clock3 aria-hidden="true" size={13} />
                      ) : (
                        <CircleAlert aria-hidden="true" size={13} />
                      )}
                      {statusCopy}
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="eval-import__summary">
              {selectedCount} selected. Only resolved, not-yet-imported conversations are
              available.
            </p>
            {error ? <p className="eval-inline-error" role="alert">{error}</p> : null}
          </div>
          <div className="eval-dialog__actions">
            <Dialog.Close asChild>
              <button className="eval-button" type="button">Cancel</button>
            </Dialog.Close>
            <button
              className="eval-button eval-button--primary"
              disabled={selectedCount === 0 || submitting}
              onClick={submit}
              type="button"
            >
              {submitting ? "Importing" : importLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
