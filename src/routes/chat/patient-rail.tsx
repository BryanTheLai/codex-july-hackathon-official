import { ExternalLink, Pencil, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  previewBookingCancellation,
  type Conversation,
  type MutationResult,
  type PatientUpdateInput,
} from "../../domain";
import { ConfirmAction } from "./confirm-action";
import {
  formatBookingSlot,
  hasResolvedStaffReply,
  triageGuidance,
} from "./chat-model";

const AVAILABLE_LABELS = [
  "booking",
  "chest-pain",
  "emergency",
  "follow-up",
  "lab-results",
  "needs-review",
  "prescription",
] as const;

function PatientIdentity({
  conversation,
  onUpdate,
}: {
  conversation: Conversation;
  onUpdate: (input: PatientUpdateInput) => MutationResult;
}) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<PatientUpdateInput>({
    name: conversation.patient.name,
    phone: conversation.patient.phone,
    preferredLanguage: conversation.patient.preferredLanguage,
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEditing(false);
    setValues({
      name: conversation.patient.name,
      phone: conversation.patient.phone,
      preferredLanguage: conversation.patient.preferredLanguage,
    });
    setError("");
    setSaving(false);
  }, [
    conversation.id,
    conversation.patient.name,
    conversation.patient.phone,
    conversation.patient.preferredLanguage,
  ]);

  const cancel = () => {
    setValues({
      name: conversation.patient.name,
      phone: conversation.patient.phone,
      preferredLanguage: conversation.patient.preferredLanguage,
    });
    setError("");
    setEditing(false);
  };

  const save = () => {
    setSaving(true);
    const result = onUpdate(values);
    if (result.ok) {
      setEditing(false);
      setError("");
    } else {
      setError(result.error);
    }
    setSaving(false);
  };

  return (
    <section className="rail-section">
      <header className="rail-section__header">
        <h3>Patient</h3>
        {!editing ? (
          <button className="chat-text-button" onClick={() => setEditing(true)} type="button">
            <Pencil aria-hidden="true" size={14} />
            Edit patient
          </button>
        ) : null}
      </header>
      {editing ? (
        <div className="rail-form">
          <label>
            Patient name
            <input
              aria-label="Patient name"
              onChange={(event) => setValues({ ...values, name: event.target.value })}
              value={values.name}
            />
          </label>
          <label>
            Phone
            <input
              aria-label="Patient phone"
              onChange={(event) => setValues({ ...values, phone: event.target.value })}
              value={values.phone}
            />
          </label>
          <label>
            Preferred language
            <select
              aria-label="Preferred language"
              onChange={(event) =>
                setValues({ ...values, preferredLanguage: event.target.value })
              }
              value={values.preferredLanguage}
            >
              <option>English</option>
              <option>Malay</option>
              <option>Mandarin</option>
            </select>
          </label>
          {error ? (
            <p className="chat-inline-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="rail-form__actions">
            <button className="chat-button" onClick={cancel} type="button">
              Cancel
            </button>
            <button className="chat-button chat-button--primary" onClick={save} type="button">
              {saving ? "Saving" : "Save patient"}
            </button>
          </div>
        </div>
      ) : (
        <dl className="rail-facts">
          <div>
            <dt>Name</dt>
            <dd>{conversation.patient.name}</dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>{conversation.patient.phone || "Not provided by patient"}</dd>
          </div>
          {conversation.patient.medicalRecordNumber ? (
            <div>
              <dt>MRN</dt>
              <dd>{conversation.patient.medicalRecordNumber}</dd>
            </div>
          ) : null}
          <div>
            <dt>Language</dt>
            <dd>{conversation.patient.preferredLanguage}</dd>
          </div>
          <div>
            <dt>Agent</dt>
            <dd>
              {conversation.agentMode === "synthetic_agent"
                ? conversation.channel === "Telegram"
                  ? "Autonomous Telegram agent"
                  : "Autonomous agent"
                : "Staff only"}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}

function BookingTimeline({ conversation }: { conversation: Conversation }) {
  const booking = conversation.booking;
  if (!booking) return null;

  const agentAudit = conversation.messages
    .filter((message) => message.role === "system")
    .map((message) => message.text)
    .join(" ")
    .toLocaleLowerCase();
  const availabilityChecked = agentAudit.includes("checked demo availability");
  const rescheduled = agentAudit.includes("rescheduled the appointment");
  const cancelled = booking.status === "cancelled";
  const confirmed = booking.status === "approved" || cancelled;
  const finalLabel = cancelled ? "Cancelled" : rescheduled ? "Rescheduled" : "Confirmed";
  const steps = [
    { label: "Requested", state: "complete" },
    {
      label: "Availability checked",
      state: availabilityChecked ? "complete" : "pending",
    },
    {
      label: finalLabel,
      state: confirmed ? "active" : "pending",
    },
  ];

  return (
    <section aria-label="Booking status timeline" className="rail-section booking-timeline">
      <header className="rail-section__header">
        <h3>Booking status</h3>
        <span>{booking.status}</span>
      </header>
      <ol>
        {steps.map((step) => (
          <li className={`booking-timeline__step booking-timeline__step--${step.state}`} key={step.label}>
            <span aria-hidden="true" />
            {step.label}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function PatientRail({
  conversation,
  showClose,
  onAddLabel,
  onCancelBooking,
  onClose,
  onDream,
  onEditBooking,
  onEscalate,
  onImportEval,
  onRemoveLabel,
  onResetSyntheticConversation,
  onUpdatePatient,
}: {
  conversation: Conversation;
  showClose: boolean;
  onAddLabel: (label: string) => MutationResult;
  onCancelBooking: () => MutationResult;
  onClose: () => void;
  onDream: () => void;
  onEditBooking: () => void;
  onEscalate: () => MutationResult;
  onImportEval: () => MutationResult;
  onRemoveLabel: (label: string) => MutationResult;
  onResetSyntheticConversation: () => MutationResult;
  onUpdatePatient: (input: PatientUpdateInput) => MutationResult;
}) {
  const availableLabels = useMemo(
    () => AVAILABLE_LABELS.filter((label) => !conversation.labels.includes(label)),
    [conversation.labels],
  );
  const systemLabels = conversation.labels.filter((label) => label === "telegram");
  const staffLabels = conversation.labels.filter((label) => label !== "telegram");
  const [newLabel, setNewLabel] = useState(availableLabels[0] ?? "");
  const [error, setError] = useState("");
  const importReady = hasResolvedStaffReply(conversation);
  const cancellationPreview = previewBookingCancellation(conversation);
  const canResetSyntheticConversation =
    conversation.id.startsWith("convo-") || conversation.id.startsWith("sim-");
  const importBlockedReason =
    conversation.workflowStatus !== "resolved"
      ? "Resolve this conversation before adding it to Evals."
      : "A human-reviewed staff response is required before adding this conversation to Evals.";

  useEffect(() => {
    setNewLabel(availableLabels[0] ?? "");
    setError("");
  }, [conversation.id, availableLabels.join("|")]);

  const run = (mutation: () => MutationResult) => {
    const result = mutation();
    setError(result.ok ? "" : result.error);
    return result;
  };

  return (
    <aside aria-label="Patient context" className="chat-pane patient-rail">
      <header className="chat-pane__header">
        <div>
          <strong>Patient context</strong>
          <span>{conversation.channel === "Telegram" ? "Telegram contact" : "Demo fixture"}</span>
        </div>
        {showClose ? (
          <button
            aria-label="Close details"
            className="chat-icon-button"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        ) : null}
      </header>
      <div aria-label="Patient details" className="chat-pane__scroll" tabIndex={0}>
        {error ? (
          <p className="chat-inline-error" role="alert">
            {error}
          </p>
        ) : null}

        <PatientIdentity
          conversation={conversation}
          onUpdate={(input) => run(() => onUpdatePatient(input))}
        />

        <section className="rail-section">
          <header className="rail-section__header">
            <h3>{conversation.channel === "Telegram" ? "Triage guidance" : "Synthetic triage guidance"}</h3>
          </header>
          <p className={conversation.urgency === "emergency" ? "rail-guidance--risk" : ""}>
            {triageGuidance(conversation)}
          </p>
          <p className="rail-boundary">Guidance only. No patient or emergency service was contacted.</p>
        </section>

        {conversation.booking ? (
          <section className="rail-section">
            <header className="rail-section__header">
              <h3>Booking</h3>
              <div className="rail-section__header-actions">
                {conversation.booking.status === "pending" ||
                conversation.booking.status === "approved" ? (
                  <button
                    aria-label="Edit booking"
                    className="chat-icon-button"
                    onClick={onEditBooking}
                    title="Edit booking"
                    type="button"
                  >
                    <Pencil aria-hidden="true" size={14} />
                  </button>
                ) : null}
                <span className={`chat-badge chat-badge--${conversation.booking.status}`}>
                  {conversation.booking.status}
                </span>
              </div>
            </header>
            <dl className="rail-facts">
              <div>
                <dt>Slot</dt>
                <dd>{formatBookingSlot(conversation.booking.slotIso)} MYT</dd>
              </div>
              <div>
                <dt>Provider</dt>
                <dd>{conversation.booking.provider}</dd>
              </div>
              <div>
                <dt>Reason</dt>
                <dd>{conversation.booking.reason}</dd>
              </div>
            </dl>
            <BookingTimeline conversation={conversation} />
            {conversation.booking.status === "approved" ? (
              <div className="rail-action-row">
                <ConfirmAction
                  confirmLabel="Cancel appointment"
                  description={
                    cancellationPreview.ok
                      ? `${cancellationPreview.preview.text}${
                          cancellationPreview.preview.gloss
                            ? ` English meaning: ${cancellationPreview.preview.gloss}`
                            : ""
                        }`
                      : cancellationPreview.error
                  }
                  onConfirm={() => {
                    run(onCancelBooking);
                  }}
                  title="Cancel this appointment?"
                  trigger={
                    <button className="chat-button chat-button--risk" type="button">
                      Cancel appointment
                    </button>
                  }
                />
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="rail-section">
          <header className="rail-section__header">
            <h3>Labels</h3>
          </header>
          {systemLabels.length > 0 ? (
            <div className="rail-label-group">
              <span>System labels</span>
              <div className="rail-labels">
                {systemLabels.map((label) => (
                  <span className="rail-label" key={label}>
                    Telegram · channel
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <div className="rail-label-group">
            <span>Staff labels</span>
            <div className="rail-labels">
            {staffLabels.map((label) => (
              <span className="rail-label" key={label}>
                {label}
                <button
                  aria-label={`Remove ${label} label`}
                  onClick={() => run(() => onRemoveLabel(label))}
                  type="button"
                >
                  <X aria-hidden="true" size={12} />
                </button>
              </span>
            ))}
            </div>
          </div>
          <div className="rail-label-add">
            <select
              aria-label="Add label"
              disabled={availableLabels.length === 0}
              onChange={(event) => setNewLabel(event.target.value)}
              value={newLabel}
            >
              {availableLabels.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
            <button
              aria-label="Add selected label"
              className="chat-icon-button"
              disabled={!newLabel}
              onClick={() => run(() => onAddLabel(newLabel))}
              type="button"
            >
              <Plus aria-hidden="true" size={16} />
            </button>
          </div>
        </section>

        {conversation.urgency === "emergency" ? (
          <section className="rail-section">
            <header className="rail-section__header">
              <h3>Emergency handoff</h3>
            </header>
            {conversation.agentMode === "staff_only" ? (
              <p className="rail-boundary">Staff control is active inside this demo.</p>
            ) : (
              <ConfirmAction
                confirmLabel="Confirm staff handoff"
                description="This turns off the synthetic agent and keeps the thread with staff. This demo does not contact a nurse, ambulance, 999, or any external service."
                onConfirm={() => {
                  run(onEscalate);
                }}
                title="Escalate inside the demo?"
                trigger={
                  <button className="chat-button chat-button--risk" type="button">
                    Escalate emergency
                  </button>
                }
              />
            )}
          </section>
        ) : null}

        {canResetSyntheticConversation ? (
          <section className="rail-section">
            <header className="rail-section__header">
              <h3>Demo controls</h3>
            </header>
            <ConfirmAction
              confirmLabel="Reset this synthetic conversation"
              description="Restores this fixture only. It does not reset the rest of the demo and never affects Telegram conversations."
              onConfirm={() => {
                run(onResetSyntheticConversation);
              }}
              title={`Reset ${conversation.patient.name}'s synthetic conversation?`}
              trigger={
                <button className="chat-button" type="button">
                  Reset this chat
                </button>
              }
            />
          </section>
        ) : null}

        <section className="rail-section rail-section--links">
          <header className="rail-section__header">
            <h3>Workflow links</h3>
          </header>
          <button
            aria-label="Add resolved conversation to Evals"
            className="chat-button"
            disabled={!importReady}
            onClick={() => run(onImportEval)}
            title={
              importReady
                ? "Add the resolved conversation as an evaluation test"
                : importBlockedReason
            }
            type="button"
          >
            <ExternalLink aria-hidden="true" size={15} />
            Add to Evals
          </button>
          {!importReady ? (
            <span className="rail-boundary">{importBlockedReason}</span>
          ) : null}
          <button className="chat-button" onClick={onDream} type="button">
            <ExternalLink aria-hidden="true" size={15} />
            Open routed playbook
          </button>
        </section>
      </div>
    </aside>
  );
}
