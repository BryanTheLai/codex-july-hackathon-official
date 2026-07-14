import {
  addLabel,
  approveBooking,
  cancelBooking,
  escalateEmergency,
  rejectBooking,
  removeLabel,
  reopenConversation,
  resolveConversation,
  sendStaffReply,
  setAgentMode,
  simulatePatient,
  updateBooking,
  updatePatient,
  type MutationResult,
  type SendStaffReplyInput,
  type SetAgentModeInput,
  type SimulateScenario,
  type PatientUpdateInput,
  type ConversationId,
  type UpdateBookingInput,
} from "../domain";
import { applyMutation } from "./apply-mutation";
import type { AppStateRepository } from "./repository";

type ChatSliceDeps = {
  getState: () => import("../domain").AppState;
  set: (partial: { state?: import("../domain").AppState; lastFeedback?: string }) => void;
  repository: AppStateRepository;
};

export function createChatActions({ getState, set, repository }: ChatSliceDeps) {
  const run = (result: MutationResult, successFeedback: string) =>
    applyMutation(set, repository, result, successFeedback);

  return {
    sendStaffReply(input: SendStaffReplyInput) {
      return run(sendStaffReply(getState(), input), "Staff reply sent.");
    },

    resolveConversation(conversationId: ConversationId) {
      return run(resolveConversation(getState(), conversationId), "Conversation resolved.");
    },

    reopenConversation(conversationId: ConversationId) {
      return run(reopenConversation(getState(), conversationId), "Conversation reopened.");
    },

    updatePatient(conversationId: ConversationId, input: PatientUpdateInput) {
      return run(updatePatient(getState(), conversationId, input), "Patient details updated.");
    },

    approveBooking(conversationId: ConversationId) {
      return run(
        approveBooking(getState(), conversationId),
        "Appointment confirmed and patient notified.",
      );
    },

    rejectBooking(conversationId: ConversationId) {
      return run(
        rejectBooking(getState(), conversationId),
        "Booking request rejected and patient notified.",
      );
    },

    cancelBooking(conversationId: ConversationId) {
      return run(
        cancelBooking(getState(), conversationId),
        "Appointment cancelled and patient notified.",
      );
    },

    updateBooking(conversationId: ConversationId, input: UpdateBookingInput) {
      return run(
        updateBooking(getState(), conversationId, input),
        "Booking updated and patient notified.",
      );
    },

    escalateEmergency(conversationId: ConversationId) {
      return run(escalateEmergency(getState(), conversationId), "Emergency escalation recorded.");
    },

    addLabel(conversationId: ConversationId, label: string) {
      return run(addLabel(getState(), conversationId, label), "Label added.");
    },

    removeLabel(conversationId: ConversationId, label: string) {
      return run(removeLabel(getState(), conversationId, label), "Label removed.");
    },

    setAgentMode(input: SetAgentModeInput) {
      return run(setAgentMode(getState(), input), "Agent mode updated.");
    },

    simulatePatient(scenario: SimulateScenario) {
      return run(simulatePatient(getState(), scenario), "Simulated patient conversation added.");
    },
  };
}
