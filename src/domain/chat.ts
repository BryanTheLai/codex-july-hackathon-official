import type {
  AgentMode,
  AppState,
  Booking,
  BookingNotificationPreview,
  ConversationId,
  MutationResult,
  PatientUpdateInput,
  SendStaffReplyInput,
  SetAgentModeInput,
  SimulateScenario,
  UpdateBookingInput,
} from "./types";
import { FIXTURE_TIME_ISO } from "./types";
import {
  createBookingNotification,
  previewBookingNotification,
} from "./booking-notifications";
import { createCanonicalSeed } from "./seed";
import {
  cloneState,
  err,
  findConversation,
  formatKualaLumpurSlot,
  nextId,
  ok,
  systemMessage,
  trimOrEmpty,
  updateConversation,
} from "./shared";

function agentModeLabel(mode: AgentMode): string {
  return mode === "staff_only" ? "Staff only" : "Autonomous agent";
}

export function sendStaffReply(state: AppState, input: SendStaffReplyInput): MutationResult {
  const conversation = findConversation(state, input.conversationId);
  if (!conversation) {
    return err(state, "Conversation not found");
  }
  if (conversation.workflowStatus === "resolved") {
    return err(state, "Cannot send to a resolved conversation");
  }

  const text = trimOrEmpty(input.text);
  if (!text) {
    return err(state, "Message text is empty");
  }
  const translatedText = input.translation ? trimOrEmpty(input.translation.text) : "";
  if (input.translation && !translatedText) {
    return err(state, "Translated message text is empty");
  }

  const messageId = nextId(
    `${input.conversationId}-msg`,
    conversation.messages.map((message) => message.id),
  );
  const message =
    input.kind === "internal_note"
      ? systemMessage(`Internal note: ${text}`, messageId, state.fixtureTime)
      : {
          id: messageId,
          role: "staff" as const,
          text: input.translation ? translatedText : text,
          gloss: input.translation ? text : undefined,
          language: input.translation?.language ?? "English",
          sentAt: state.fixtureTime,
        };

  const next = updateConversation(state, input.conversationId, (current) => ({
    ...current,
    messages: [...current.messages, message],
  }));
  return ok(next);
}

export function resolveConversation(state: AppState, conversationId: ConversationId): MutationResult {
  const conversation = findConversation(state, conversationId);
  if (!conversation) {
    return err(state, "Conversation not found");
  }
  if (conversation.workflowStatus === "resolved") {
    return err(state, "Conversation already resolved");
  }

  const next = updateConversation(state, conversationId, (current) => ({
    ...current,
    workflowStatus: "resolved",
    resolvedAt: state.fixtureTime,
  }));
  return ok(next);
}

export function reopenConversation(state: AppState, conversationId: ConversationId): MutationResult {
  const conversation = findConversation(state, conversationId);
  if (!conversation) {
    return err(state, "Conversation not found");
  }
  if (conversation.workflowStatus !== "resolved") {
    return err(state, "Conversation is not resolved");
  }

  const next = updateConversation(state, conversationId, (current) => ({
    ...current,
    workflowStatus: "in_progress",
    resolvedAt: null,
  }));
  return ok(next);
}

export function updatePatient(
  state: AppState,
  conversationId: ConversationId,
  input: PatientUpdateInput,
): MutationResult {
  const conversation = findConversation(state, conversationId);
  if (!conversation) {
    return err(state, "Conversation not found");
  }

  const name = trimOrEmpty(input.name);
  const phone = trimOrEmpty(input.phone);
  const preferredLanguage = trimOrEmpty(input.preferredLanguage);
  if (!name) {
    return err(state, "Patient name cannot be empty");
  }
  if (!phone) {
    return err(state, "Patient phone cannot be empty");
  }
  if (!preferredLanguage) {
    return err(state, "Patient preferred language cannot be empty");
  }

  const next = updateConversation(state, conversationId, (current) => ({
    ...current,
    patient: {
      ...current.patient,
      name,
      phone,
      preferredLanguage,
    },
  }));
  return ok(next);
}

function appendBookingTransition(
  state: AppState,
  conversationId: ConversationId,
  booking: Booking,
  notification: BookingNotificationPreview,
  auditText: string,
): AppState {
  return updateConversation(state, conversationId, (current) => {
    const patientMessageId = nextId(
      `${conversationId}-msg`,
      current.messages.map((message) => message.id),
    );
    const auditMessageId = nextId(
      `${conversationId}-audit`,
      [...current.messages.map((message) => message.id), patientMessageId],
    );
    return {
      ...current,
      booking,
      messages: [
        ...current.messages,
        {
          id: patientMessageId,
          role: "staff",
          text: notification.text,
          gloss: notification.gloss,
          language: notification.language,
          sentAt: state.fixtureTime,
        },
        systemMessage(auditText, auditMessageId, state.fixtureTime),
      ],
    };
  });
}

export function approveBooking(state: AppState, conversationId: ConversationId): MutationResult {
  const conversation = findConversation(state, conversationId);
  if (!conversation?.booking) {
    return err(state, "No booking to approve");
  }
  if (conversation.booking.status !== "pending") {
    return err(state, "Booking is not pending");
  }

  const nextBooking: Booking = {
    ...conversation.booking,
    status: "approved",
    revision: conversation.booking.revision + 1,
  };
  const slot = formatKualaLumpurSlot(nextBooking.slotIso);
  const next = appendBookingTransition(
    state,
    conversationId,
    nextBooking,
    createBookingNotification(conversation, nextBooking, "confirmed"),
    `Booking approved by staff for ${slot} with ${nextBooking.provider} at ${state.fixtureTime}.`,
  );
  return ok(next);
}

export function rejectBooking(state: AppState, conversationId: ConversationId): MutationResult {
  const conversation = findConversation(state, conversationId);
  if (!conversation?.booking) {
    return err(state, "No booking to reject");
  }
  if (conversation.booking.status !== "pending") {
    return err(state, "Booking is not pending");
  }

  const nextBooking: Booking = {
    ...conversation.booking,
    status: "rejected",
    revision: conversation.booking.revision + 1,
  };
  const slot = formatKualaLumpurSlot(nextBooking.slotIso);
  const next = appendBookingTransition(
    state,
    conversationId,
    nextBooking,
    createBookingNotification(conversation, nextBooking, "request_rejected"),
    `Booking rejected by staff for ${slot} with ${nextBooking.provider} at ${state.fixtureTime}.`,
  );
  return ok(next);
}

export function updateBooking(
  state: AppState,
  conversationId: ConversationId,
  input: UpdateBookingInput,
): MutationResult {
  const conversation = findConversation(state, conversationId);
  if (!conversation?.booking) {
    return err(state, "No booking to edit");
  }
  const preview = previewBookingNotification(conversation, input);
  if (!preview.ok) {
    return err(state, preview.error);
  }

  const previous = conversation.booking;
  const nextBooking: Booking = {
    ...previous,
    provider: trimOrEmpty(input.provider),
    reason: trimOrEmpty(input.reason),
    slotIso: trimOrEmpty(input.slotIso),
    revision: previous.revision + 1,
  };
  const before = `${formatKualaLumpurSlot(previous.slotIso)} with ${previous.provider}; reason: ${previous.reason}`;
  const after = `${formatKualaLumpurSlot(nextBooking.slotIso)} with ${nextBooking.provider}; reason: ${nextBooking.reason}`;
  const eventLabel =
    preview.preview.event === "request_updated"
      ? "Booking request updated"
      : preview.preview.event === "rescheduled"
        ? "Booking rescheduled"
        : "Booking details updated";
  const next = appendBookingTransition(
    state,
    conversationId,
    nextBooking,
    preview.preview,
    `${eventLabel} by staff at ${state.fixtureTime}. Before: ${before}. After: ${after}.`,
  );
  return ok(next);
}

export function cancelBooking(state: AppState, conversationId: ConversationId): MutationResult {
  const conversation = findConversation(state, conversationId);
  if (!conversation?.booking) {
    return err(state, "No booking to cancel");
  }
  if (conversation.booking.status !== "approved") {
    return err(state, "Only an approved appointment can be cancelled");
  }

  const nextBooking: Booking = {
    ...conversation.booking,
    status: "cancelled",
    revision: conversation.booking.revision + 1,
  };
  const slot = formatKualaLumpurSlot(nextBooking.slotIso);
  const next = appendBookingTransition(
    state,
    conversationId,
    nextBooking,
    createBookingNotification(conversation, nextBooking, "cancelled"),
    `Booking cancelled by staff for ${slot} with ${nextBooking.provider} at ${state.fixtureTime}.`,
  );
  return ok(next);
}

export function escalateEmergency(state: AppState, conversationId: ConversationId): MutationResult {
  const conversation = findConversation(state, conversationId);
  if (!conversation) {
    return err(state, "Conversation not found");
  }
  if (conversation.urgency !== "emergency") {
    return err(state, "Emergency escalation is only available for emergency conversations");
  }

  const messageId = nextId(
    `${conversationId}-audit`,
    conversation.messages.map((message) => message.id),
  );
  const next = updateConversation(state, conversationId, (current) => ({
    ...current,
    agentMode: "staff_only",
    messages: [
      ...current.messages,
      systemMessage(
        "Autonomous agent paused for staff handling. This demo did not contact any external service.",
        messageId,
        state.fixtureTime,
      ),
    ],
  }));
  return ok(next);
}

export function addLabel(state: AppState, conversationId: ConversationId, label: string): MutationResult {
  const conversation = findConversation(state, conversationId);
  if (!conversation) {
    return err(state, "Conversation not found");
  }

  const normalized = trimOrEmpty(label);
  if (!normalized) {
    return err(state, "Label is empty");
  }
  if (conversation.labels.includes(normalized)) {
    return err(state, "Label already exists");
  }

  const next = updateConversation(state, conversationId, (current) => ({
    ...current,
    labels: [...current.labels, normalized],
  }));
  return ok(next);
}

export function removeLabel(state: AppState, conversationId: ConversationId, label: string): MutationResult {
  const conversation = findConversation(state, conversationId);
  if (!conversation) {
    return err(state, "Conversation not found");
  }

  const normalized = trimOrEmpty(label);
  if (!conversation.labels.includes(normalized)) {
    return err(state, "Label not found");
  }

  const next = updateConversation(state, conversationId, (current) => ({
    ...current,
    labels: current.labels.filter((item) => item !== normalized),
  }));
  return ok(next);
}

export function setAgentMode(state: AppState, input: SetAgentModeInput): MutationResult {
  const conversation = findConversation(state, input.conversationId);
  if (!conversation) {
    return err(state, "Conversation not found");
  }
  if (conversation.workflowStatus === "resolved") {
    return err(state, "Cannot change agent mode on a resolved conversation");
  }
  if (conversation.agentMode === input.mode) {
    return ok(state);
  }

  const messageId = nextId(
    `${input.conversationId}-audit`,
    conversation.messages.map((message) => message.id),
  );
  const next = updateConversation(state, input.conversationId, (current) => ({
    ...current,
    agentMode: input.mode,
    messages: [
      ...current.messages,
      systemMessage(
        `Agent mode changed to ${agentModeLabel(input.mode)} by staff.`,
        messageId,
        state.fixtureTime,
      ),
    ],
  }));
  return ok(next);
}

export function resetSyntheticConversation(
  state: AppState,
  conversationId: ConversationId,
): MutationResult {
  const conversation = findConversation(state, conversationId);
  if (!conversation) {
    return err(state, "Conversation not found");
  }

  const canonical = createCanonicalSeed().conversations.find(
    (item) => item.id === conversationId,
  );
  if (canonical) {
    const next: AppState = {
      ...cloneState(state),
      conversations: state.conversations.map((item) =>
        item.id === conversationId ? canonical : item,
      ),
    };
    return ok(next);
  }

  if (conversationId.startsWith("sim-")) {
    const remaining = state.conversations.filter((item) => item.id !== conversationId);
    const next: AppState = {
      ...cloneState(state),
      conversations: remaining,
      selections: {
        ...state.selections,
        conversationId:
          state.selections.conversationId === conversationId
            ? (remaining[0]?.id ?? null)
            : state.selections.conversationId,
      },
    };
    return ok(next);
  }

  return err(state, "Only synthetic demo conversations can be reset individually");
}

const SIMULATED_CONVERSATIONS: Record<SimulateScenario, AppState["conversations"][number]> = {
  emergency_chest_pain: {
    id: "sim-emergency-chest-pain",
    patient: {
      name: "Hafiz Rahman",
      phone: "+60123456101",
      medicalRecordNumber: "MRN-1101",
      preferredLanguage: "English",
    },
    channel: "WhatsApp",
    urgency: "emergency",
    agentMode: "synthetic_agent",
    workflowStatus: "in_progress",
    resolvedAt: null,
    labels: ["emergency", "simulated"],
    triageGuidance:
      "Chest-pain fixture: keep staff control and direct the patient to urgent in-person care.",
    messages: [
      {
        id: "sim-em-1",
        role: "patient",
        text: "Chest pain and sweating since breakfast.",
        sentAt: FIXTURE_TIME_ISO,
      },
    ],
  },
  malay_booking: {
    id: "sim-malay-booking",
    patient: {
      name: "Aina Zulkifli",
      phone: "+60123456102",
      medicalRecordNumber: "MRN-1102",
      preferredLanguage: "Malay",
    },
    channel: "WhatsApp",
    urgency: "routine",
    agentMode: "synthetic_agent",
    workflowStatus: "in_progress",
    resolvedAt: null,
    labels: ["booking", "simulated"],
    triageGuidance:
      "Routine booking fixture: the autonomous agent confirms the date, time, and provider before it books.",
    messages: [
      {
        id: "sim-bk-1",
        role: "patient",
        text: "Boleh saya buat temujanji minggu depan?",
        sentAt: FIXTURE_TIME_ISO,
      },
    ],
  },
  mandarin_voice: {
    id: "sim-mandarin-voice",
    patient: {
      name: "Li Wei",
      phone: "+60123456103",
      medicalRecordNumber: "MRN-1103",
      preferredLanguage: "Mandarin",
    },
    channel: "Voice transcript",
    urgency: "routine",
    agentMode: "synthetic_agent",
    workflowStatus: "in_progress",
    resolvedAt: null,
    labels: ["prescription", "simulated"],
    triageGuidance:
      "Prescription fixture: verify medication details before a clinic follow-up.",
    messages: [
      {
        id: "sim-rx-1",
        role: "patient",
        text: "我想了解处方续药流程。",
        gloss: "I want to understand the prescription renewal process.",
        language: "Mandarin",
        sentAt: FIXTURE_TIME_ISO,
      },
    ],
  },
};

export function simulatePatient(state: AppState, scenario: SimulateScenario): MutationResult {
  const simulated = structuredClone(SIMULATED_CONVERSATIONS[scenario]);
  simulated.messages = simulated.messages.map((message) => ({
    ...message,
    sentAt: state.fixtureTime,
  }));
  if (state.conversations.some((conversation) => conversation.id === simulated.id)) {
    const next: AppState = {
      ...cloneState(state),
      selections: {
        ...state.selections,
        conversationId: simulated.id,
      },
    };
    return ok(next);
  }

  const next: AppState = {
    ...cloneState(state),
    conversations: [simulated, ...state.conversations],
    selections: {
      ...state.selections,
      conversationId: simulated.id,
    },
  };
  return ok(next);
}
