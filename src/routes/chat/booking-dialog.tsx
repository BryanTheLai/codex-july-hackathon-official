import * as Dialog from "@radix-ui/react-dialog";
import { CalendarClock } from "lucide-react";
import { useEffect, useState } from "react";

import type {
  Conversation,
  MutationResult,
  UpdateBookingInput,
} from "../../domain";
import { previewBookingNotification } from "../../domain";

function toDateTimeLocal(slotIso: string): string {
  return slotIso.slice(0, 16);
}

function toMalaysiaIso(value: string): string {
  return `${value}:00+08:00`;
}

export function BookingDialog({
  conversation,
  onOpenChange,
  onSave,
  open,
}: {
  conversation: Conversation | null;
  onOpenChange: (open: boolean) => void;
  onSave: (input: UpdateBookingInput) => MutationResult | Promise<MutationResult>;
  open: boolean;
}) {
  const [dateTime, setDateTime] = useState("");
  const [provider, setProvider] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !conversation?.booking) {
      return;
    }
    setDateTime(toDateTimeLocal(conversation.booking.slotIso));
    setProvider(conversation.booking.provider);
    setReason(conversation.booking.reason);
    setError("");
  }, [conversation, open]);

  const input: UpdateBookingInput | null = conversation?.booking
    ? {
        expectedRevision: conversation.booking.revision,
        provider,
        reason,
        slotIso: toMalaysiaIso(dateTime),
      }
    : null;
  const previewResult =
    conversation && input ? previewBookingNotification(conversation, input) : null;
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
            Edit booking
          </Dialog.Title>
          <Dialog.Description className="chat-dialog__description">
            {isPersistedTelegramBooking
              ? "Update the booking and preview the patient message. Google Calendar synchronization is queued when it is connected. Times use Malaysia Time (MYT)."
              : "Update this synthetic booking and preview the patient message. Nothing is sent to Telegram. Times use Malaysia Time (MYT)."}
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
            Provider
            <input
              aria-label="Booking provider"
              onChange={(event) => setProvider(event.target.value)}
              value={provider}
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
            <strong>Patient message</strong>
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
                Change a booking detail to preview the exact message.
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
              {saving ? "Saving…" : "Save booking"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
