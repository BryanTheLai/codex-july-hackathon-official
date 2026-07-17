import * as Dialog from "@radix-ui/react-dialog";
import { CalendarClock } from "lucide-react";
import { useEffect, useState } from "react";

import type {
  Conversation,
  CreateBookingInput,
  MutationResult,
  UpdateBookingInput,
} from "../../domain";
import {
  previewBookingNotification,
  previewNewBookingNotification,
} from "../../domain";

function toDateTimeLocal(slotIso: string): string {
  return slotIso.slice(0, 16);
}

function toMalaysiaIso(value: string): string {
  return `${value}:00+08:00`;
}

export function BookingDialog({
  conversation,
  defaultSlotIso,
  onOpenChange,
  onSave,
  open,
}: {
  conversation: Conversation | null;
  defaultSlotIso: string;
  onOpenChange: (open: boolean) => void;
  onSave: (
    input: CreateBookingInput | UpdateBookingInput,
  ) => MutationResult | Promise<MutationResult>;
  open: boolean;
}) {
  const [dateTime, setDateTime] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !conversation) {
      return;
    }
    if (conversation.booking) {
      setDateTime(toDateTimeLocal(conversation.booking.slotIso));
      setReason(conversation.booking.reason);
    } else {
      setDateTime(toDateTimeLocal(defaultSlotIso));
      setReason("");
    }
    setError("");
  }, [conversation, defaultSlotIso, open]);

  const isCreate = Boolean(conversation && !conversation.booking);
  const input: CreateBookingInput | UpdateBookingInput | null = conversation
    ? conversation.booking
      ? {
          expectedRevision: conversation.booking.revision,
          reason,
          slotIso: toMalaysiaIso(dateTime),
        }
      : { reason, slotIso: toMalaysiaIso(dateTime) }
    : null;
  const previewResult =
    conversation && input
      ? isCreate
        ? previewNewBookingNotification(conversation, input)
        : previewBookingNotification(conversation, input as UpdateBookingInput)
      : null;
  const preview = previewResult?.ok ? previewResult.preview : null;
  const isPersistedTelegramBooking =
    conversation?.channel === "Telegram" &&
    conversation.id.startsWith("telegram-conversation:");

  const submit = async () => {
    if (!input) {
      setError("Booking not found");
      return;
    }
    setSaving(true);
    const result = await onSave(input);
    setSaving(false);
    if (result.ok) {
      onOpenChange(false);
      return;
    }
    setError(result.error);
  };

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="chat-dialog__overlay" />
        <Dialog.Content className="chat-dialog__content">
          <Dialog.Title className="chat-dialog__title">
            <CalendarClock aria-hidden="true" size={18} />
            {isCreate ? "Create booking" : "Edit booking"}
          </Dialog.Title>
          <Dialog.Description className="chat-dialog__description">
            {isPersistedTelegramBooking
              ? isCreate
                ? "Create a confirmed appointment and preview the customer message. Google Calendar synchronization is queued when it is connected; sending the customer message remains a separate staff action. Times use Malaysia Time (MYT)."
                : "Update the booking and preview the customer message. Google Calendar synchronization is queued when it is connected; sending the customer message remains a separate staff action. Times use Malaysia Time (MYT)."
              : isCreate
                ? "Create this synthetic booking and preview the customer message. Nothing is sent to Telegram or Google Calendar. Times use Malaysia Time (MYT)."
                : "Update this synthetic booking and preview the customer message. Nothing is sent to Telegram. Times use Malaysia Time (MYT)."}
          </Dialog.Description>
          <label className="chat-dialog__field">
            Date and time
            <input
              aria-label="Booking date and time"
              onChange={(event) => setDateTime(event.target.value)}
              type="datetime-local"
              value={dateTime}
            />
          </label>
          <label className="chat-dialog__field">
            Reason
            <input
              aria-label="Booking reason"
              onChange={(event) => setReason(event.target.value)}
              value={reason}
            />
          </label>
          <section aria-live="polite" className="booking-notification-preview">
            <strong>Exact customer message preview</strong>
            {preview ? (
              <>
                <p lang={preview.language === "Malay" ? "ms" : preview.language === "Mandarin" ? "zh" : "en"}>
                  {preview.text}
                </p>
                {preview.gloss ? (
                  <p className="booking-notification-preview__gloss">
                    <span>English meaning</span>
                    {preview.gloss}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="booking-notification-preview__empty">
                {isCreate
                  ? "Enter appointment details above to preview the exact message before creating it."
                  : "Edit a booking detail above to preview the exact message before saving."}
              </p>
            )}
          </section>
          {error ? (
            <p className="chat-inline-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="chat-dialog__actions">
            <Dialog.Close asChild>
              <button className="chat-button" type="button">
                Cancel
              </button>
            </Dialog.Close>
            <button
              className="chat-button chat-button--primary"
              disabled={!preview || saving}
              onClick={() => void submit()}
              type="button"
            >
              {saving ? "Saving…" : isCreate ? "Create booking" : "Save booking"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
