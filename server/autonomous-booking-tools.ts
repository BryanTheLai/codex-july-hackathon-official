import { createHash } from "node:crypto";

import { z } from "zod";

import type {
  BookingPayload,
  EvalCasePayload,
  ServerDomainStatePayload,
} from "../src/contracts/app-state";
import type {
  AgentProviderFunctionTool,
  AgentToolExecution,
  AgentToolExecutor,
} from "./agent-service";
import type { CalendarAvailability } from "./google-calendar-service";
import type { OutboxRepository } from "./outbox-repository";
import type { WorkspaceRepository } from "./workspace-repository";

const SLOT_TIMES = ["09:00", "10:30", "14:00", "15:30"] as const;
const MAX_CAS_ATTEMPTS = 3;
const KUALA_LUMPUR_TIME_ZONE = "Asia/Kuala_Lumpur";

const listSlotsSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  })
  .strict();

const bookingArgumentsSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
    serviceAddress: z.string().trim().min(1).max(256).optional(),
    slotIso: z.iso.datetime({ offset: true }),
  })
  .strict();

const cancelArgumentsSchema = z.object({}).strict();

const feedbackArgumentsSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const autonomousBookingTools: AgentProviderFunctionTool[] = [
  {
    type: "function",
    name: "list_available_slots",
    description:
      "Read current service visit availability for wall-mounted 1.0-1.5 HP units. Use this before creating or rescheduling a booking when you need a valid slot.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        date: {
          anyOf: [
            { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            { type: "null" },
          ],
          description: "Requested local service date in YYYY-MM-DD, or null for the next available slots.",
        },
      },
      required: ["date"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "create_booking",
    description:
      "Create and confirm a new service visit immediately after the customer confirms slot and address. Only use a slot returned by list_available_slots. Quote only the fixed rate card (RM99 general service, RM160 chemical wash). This is an autonomous customer-facing action.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        slotIso: { type: "string", format: "date-time" },
        reason: { type: "string", minLength: 1, maxLength: 500 },
        serviceAddress: { type: "string", minLength: 1, maxLength: 256 },
      },
      required: ["slotIso", "reason", "serviceAddress"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "reschedule_booking",
    description:
      "Move the customer's already confirmed service visit to a returned available slot. This action is immediate and does not wait for operator approval.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        slotIso: { type: "string", format: "date-time" },
        reason: { type: "string", minLength: 1, maxLength: 500 },
      },
      required: ["slotIso", "reason"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "cancel_booking",
    description:
      "Cancel the customer's already confirmed service visit immediately. Use only when the customer asks to cancel.",
    strict: true,
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "flag_autonomous_action_wrong",
    description:
      "Create a pending Eval candidate when the customer says an autonomous action or reply was wrong, unwanted, or needs correction. Decide from the conversation itself; do not use keyword matching or flag ordinary new requests.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          minLength: 1,
          maxLength: 500,
          description: "A concise factual summary of why the customer says the autonomous outcome was wrong.",
        },
      },
      required: ["reason"],
      additionalProperties: false,
    },
  },
];

type BookingToolName =
  | "list_available_slots"
  | "create_booking"
  | "reschedule_booking"
  | "cancel_booking"
  | "flag_autonomous_action_wrong";

type ToolSuccess = {
  success: true;
  action:
    | "availability_listed"
    | "booking_created"
    | "booking_rescheduled"
    | "booking_cancelled"
    | "feedback_flagged";
  booking?: BookingPayload;
  conversationRevision: number | null;
  evalCaseId?: string;
  availabilitySource?: "demo" | "google";
  slots?: Array<{ slotIso: string }>;
};

type ToolFailure = {
  success: false;
  error_type: "invalid_arguments" | "invalid_state" | "revision_conflict" | "slot_unavailable" | "not_found" | "provider_failed";
  message: string;
  suggestion: string;
};

function failure(
  error_type: ToolFailure["error_type"],
  message: string,
  suggestion: string,
): AgentToolExecution {
  return {
    status: "failed",
    summary: message,
    conversationRevision: null,
    output: { success: false, error_type, message, suggestion } satisfies ToolFailure,
  };
}

function success(
  summary: string,
  output: ToolSuccess,
): AgentToolExecution {
  return {
    status: "completed",
    summary,
    conversationRevision: output.conversationRevision,
    output,
  };
}

function toolAuditMessageId(callId: string): string {
  return `agent-action-${createHash("sha256").update(callId).digest("hex").slice(0, 32)}`;
}

function feedbackCaseId(callId: string): string {
  return `case-agent-feedback-${createHash("sha256").update(callId).digest("hex").slice(0, 24)}`;
}

function localDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KUALA_LUMPUR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function nextDate(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function slotIso(date: string, time: (typeof SLOT_TIMES)[number]): string {
  return `${date}T${time}:00+08:00`;
}

function availableSlots(
  state: ServerDomainStatePayload,
  requestedDate: string | null,
  now: Date,
): Array<{ slotIso: string }> {
  const reserved = new Set(
    state.conversations
      .map((conversation) => conversation.booking)
      .filter(
        (booking): booking is BookingPayload =>
          booking?.status === "approved",
      )
      .map((booking) => booking.slotIso),
  );
  let date = requestedDate ?? localDate(now);
  const slots: Array<{ slotIso: string }> = [];
  for (let offset = 0; offset < 8 && slots.length < 8; offset += 1) {
    for (const time of SLOT_TIMES) {
      const candidate = slotIso(date, time);
      if (
        new Date(candidate) > now &&
        !reserved.has(candidate) &&
        (requestedDate === null || date === requestedDate)
      ) {
        slots.push({ slotIso: candidate });
      }
    }
    if (requestedDate !== null) break;
    date = nextDate(date);
  }
  return slots;
}

function parseArguments<T>(
  value: string,
  schema: z.ZodType<T>,
): { ok: true; value: T } | { ok: false } {
  try {
    return { ok: true, value: schema.parse(JSON.parse(value)) };
  } catch {
    return { ok: false };
  }
}

function isBookingToolName(name: string): name is BookingToolName {
  return autonomousBookingTools.some((tool) => tool.name === name);
}

type AutonomousBookingToolOptions = {
  calendarAvailability?: CalendarAvailability;
  now?: () => Date;
  outboxRepository?: OutboxRepository;
  requireConnectedCalendar?: boolean;
  workspaceId: string;
  workspaceRepository: WorkspaceRepository;
};

export function createAutonomousBookingToolExecutor({
  calendarAvailability,
  now = () => new Date(),
  outboxRepository,
  requireConnectedCalendar = false,
  workspaceId,
  workspaceRepository,
}: AutonomousBookingToolOptions): AgentToolExecutor {
  const enqueueCalendarSync = async (
    conversationId: string,
    bookingRevision: number,
  ) => {
    await outboxRepository?.enqueue({
      workspaceId,
      kind: "google_calendar_sync",
      dedupeKey: `google:${conversationId}:${bookingRevision}`,
      payload: { conversationId, bookingRevision },
    });
  };

  return async ({ call, request }) => {
    if (!isBookingToolName(call.name)) {
      return failure(
        "invalid_arguments",
        "The requested tool is not available to this agent.",
        "Choose one of the supplied autonomous agent tools.",
      );
    }

    if (call.name === "list_available_slots") {
      const parsed = parseArguments(call.argumentsJson, listSlotsSchema);
      if (!parsed.ok) {
        return failure(
          "invalid_arguments",
          "Availability lookup arguments are invalid.",
          "Provide a YYYY-MM-DD date or null.",
        );
      }
      const workspace = await workspaceRepository.load(workspaceId);
      if (!workspace) {
        return failure("not_found", "Workspace was not found.", "Try again later.");
      }
      const demoSlots = availableSlots(
        workspace.state,
        parsed.value.date,
        now(),
      );
      let availability: { source: "demo" | "google"; slots: typeof demoSlots };
      try {
        availability = calendarAvailability
          ? await calendarAvailability.filterAvailableSlots({ slots: demoSlots })
          : { source: "demo", slots: demoSlots };
      } catch {
        return failure(
          "provider_failed",
          "Calendar availability could not be confirmed.",
          "Retry the availability lookup before offering a slot.",
        );
      }
      if (requireConnectedCalendar && availability.source !== "google") {
        return failure(
          "provider_failed",
          "Live booking requires a connected Google Calendar.",
          "Ask staff to connect Google Calendar before offering a slot.",
        );
      }
      const slots = availability.slots;
      const summary =
        slots.length === 0
          ? parsed.value.date
            ? `No slots are available on ${parsed.value.date}.`
            : "No future slots are available."
          : `Found ${slots.length} available slot${slots.length === 1 ? "" : "s"}.`;
      return success(
        summary,
        {
          success: true,
          action: "availability_listed",
          conversationRevision: null,
          availabilitySource: availability.source,
          slots,
        },
      );
    }

    const parsed =
      call.name === "cancel_booking"
        ? parseArguments(call.argumentsJson, cancelArgumentsSchema)
        : call.name === "flag_autonomous_action_wrong"
          ? parseArguments(call.argumentsJson, feedbackArgumentsSchema)
          : parseArguments(call.argumentsJson, bookingArgumentsSchema);
    if (!parsed.ok) {
      return failure(
        "invalid_arguments",
        `${call.name} arguments are invalid.`,
        "Use only the exact schema supplied for this tool.",
      );
    }

    const auditMessageId = toolAuditMessageId(call.callId);
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const workspace = await workspaceRepository.load(workspaceId);
      if (!workspace) {
        return failure("not_found", "Workspace was not found.", "Try again later.");
      }
      const index = workspace.state.conversations.findIndex(
        (conversation) => conversation.id === request.conversation.id,
      );
      if (index < 0) {
        return failure("not_found", "Conversation was not found.", "Ask the customer to send a new message.");
      }
      const conversation = workspace.state.conversations[index]!;
      if (conversation.messages.some((message) => message.id === auditMessageId)) {
        const action =
          call.name === "create_booking"
            ? "booking_created"
            : call.name === "reschedule_booking"
              ? "booking_rescheduled"
              : call.name === "cancel_booking"
                ? "booking_cancelled"
                : "feedback_flagged";
        if (call.name !== "flag_autonomous_action_wrong" && conversation.booking) {
          await enqueueCalendarSync(conversation.id, conversation.booking.revision);
        }
        return success("This autonomous action was already completed.", {
          success: true,
          action,
          booking: conversation.booking,
          conversationRevision: conversation.revision,
          ...(call.name === "flag_autonomous_action_wrong"
            ? { evalCaseId: feedbackCaseId(call.callId) }
            : {}),
        });
      }
      if (conversation.revision !== request.conversation.revision) {
        return failure(
          "revision_conflict",
          "The conversation changed while the agent was working.",
          "Use the newest customer message and retry the task once.",
        );
      }
      if (conversation.workflowStatus === "resolved") {
        return failure(
          "invalid_state",
          "A resolved conversation cannot change a booking.",
          "Ask the customer to start a new request.",
        );
      }

      if (call.name === "flag_autonomous_action_wrong") {
        const feedback = parsed.value as z.infer<typeof feedbackArgumentsSchema>;
        const protectedDatasetIndex = workspace.state.evalDatasets.findIndex(
          (dataset) => dataset.protected,
        );
        const targetDatasetIndex =
          protectedDatasetIndex >= 0
            ? protectedDatasetIndex
            : workspace.state.evalDatasets.length > 0
              ? 0
              : -1;
        if (targetDatasetIndex < 0) {
          return failure(
            "invalid_state",
            "No Eval dataset is available for customer feedback.",
            "Choose an Eval dataset before retrying the feedback action.",
          );
        }
        const inputMessages = conversation.messages.filter((message) => message.role !== "system");
        if (inputMessages.length === 0) {
          return failure(
            "invalid_state",
            "Customer feedback needs a conversation transcript.",
            "Wait for a customer message before creating an Eval candidate.",
          );
        }
        const dataset = workspace.state.evalDatasets[targetDatasetIndex]!;
        const type =
          conversation.urgency === "emergency" || conversation.labels.includes("emergency")
            ? "emergency_triage"
            : conversation.labels.includes("booking") || conversation.booking
              ? "booking"
              : conversation.labels.includes("prescription")
                ? "prescription"
                : conversation.labels.includes("lab-results")
                  ? "lab_follow_up"
                  : "general";
        const evalCaseId = feedbackCaseId(call.callId);
        const evalCase: EvalCasePayload = {
          id: evalCaseId,
          title: `Autonomous feedback: ${conversation.patient.name}`,
          split: "train",
          type,
          language: conversation.patient.preferredLanguage,
          inputConversation: { messages: inputMessages },
          expectedHumanOutput: "",
          criterionIds: dataset.criteria
            .filter((criterion) =>
              criterion.caseTypes && criterion.caseTypes.length > 0
                ? criterion.caseTypes.includes(type)
                : true,
            )
            .map((criterion) => criterion.id),
          source: {
            kind: "autonomous_feedback",
            conversationId: conversation.id,
            messageIds: inputMessages.map((message) => message.id),
            reason: feedback.reason,
          },
        };
        const auditText = `Autonomous agent flagged customer feedback as Eval candidate ${evalCaseId}.`;
        const nextState = structuredClone(workspace.state);
        nextState.evalDatasets[targetDatasetIndex] = {
          ...dataset,
          cases: [...dataset.cases, evalCase],
        };
        const existing = nextState.conversations[index]!;
        nextState.conversations[index] = {
          ...existing,
          revision: existing.revision + 1,
          labels: existing.labels.includes("agent-feedback")
            ? existing.labels
            : [...existing.labels, "agent-feedback"],
          messages: [
            ...existing.messages,
            {
              id: auditMessageId,
              role: "system",
              text: auditText,
              sentAt: now().toISOString(),
            },
          ],
        };
        const saved = await workspaceRepository.save(
          workspaceId,
          workspace.revision,
          nextState,
        );
        if (saved.ok) {
          const savedConversation = saved.workspace.state.conversations[index]!;
          return success(auditText, {
            success: true,
            action: "feedback_flagged",
            conversationRevision: savedConversation.revision,
            evalCaseId,
          });
        }
        continue;
      }

      let nextBooking: BookingPayload;
      let action: ToolSuccess["action"];
      let auditText: string;
      if (call.name === "cancel_booking") {
        if (!conversation.booking || conversation.booking.status !== "approved") {
          return failure(
            "invalid_state",
            "Only a confirmed service visit can be cancelled.",
            "Explain the current service visit status and offer available slots if needed.",
          );
        }
        nextBooking = {
          ...conversation.booking,
          status: "cancelled",
          revision: conversation.booking.revision + 1,
        };
        action = "booking_cancelled";
        auditText = "Autonomous agent cancelled the confirmed service visit.";
      } else {
        const argumentsValue = parsed.value as z.infer<typeof bookingArgumentsSchema>;
        const demoSlots = availableSlots(
          workspace.state,
          argumentsValue.slotIso.slice(0, 10),
          now(),
        );
        let availability: { source: "demo" | "google"; slots: typeof demoSlots };
        try {
          availability = calendarAvailability
            ? await calendarAvailability.filterAvailableSlots({ slots: demoSlots })
            : { source: "demo", slots: demoSlots };
        } catch {
          return failure(
            "provider_failed",
            "Calendar availability could not be confirmed.",
            "Retry the availability lookup before confirming a booking.",
          );
        }
        if (requireConnectedCalendar && availability.source !== "google") {
          return failure(
            "provider_failed",
            "Live booking requires a connected Google Calendar.",
            "Ask staff to connect Google Calendar before confirming a booking.",
          );
        }
        const slots = availability.slots;
        if (!slots.some((slot) => slot.slotIso === argumentsValue.slotIso)) {
          return failure(
            "slot_unavailable",
            "That service slot is no longer available.",
            "Call list_available_slots again and offer one of the returned slots.",
          );
        }
        if (call.name === "create_booking") {
          if (conversation.booking?.status === "approved") {
            return failure(
              "invalid_state",
              "The customer already has a confirmed service visit.",
              "Use reschedule_booking or cancel_booking instead.",
            );
          }
          if (!argumentsValue.serviceAddress) {
            return failure(
              "invalid_arguments",
              "A service address is required to create a booking.",
              "Ask the customer for the service address before confirming the booking.",
            );
          }
          nextBooking = {
            slotIso: argumentsValue.slotIso,
            reason: argumentsValue.reason,
            serviceAddress: argumentsValue.serviceAddress,
            status: "approved",
            revision: (conversation.booking?.revision ?? 0) + 1,
          };
          action = "booking_created";
          auditText = `Autonomous agent checked ${availability.source === "google" ? "Google Calendar" : "demo"} availability and confirmed a service visit.`;
        } else {
          if (!conversation.booking || conversation.booking.status !== "approved") {
            return failure(
              "invalid_state",
              "Only a confirmed service visit can be rescheduled.",
              "Create a new booking or explain the current service visit status.",
            );
          }
          nextBooking = {
            ...conversation.booking,
            slotIso: argumentsValue.slotIso,
            reason: argumentsValue.reason,
            revision: conversation.booking.revision + 1,
          };
          action = "booking_rescheduled";
          auditText = `Autonomous agent checked ${availability.source === "google" ? "Google Calendar" : "demo"} availability and rescheduled the service visit.`;
        }
      }

      const nextState = structuredClone(workspace.state);
      const existing = nextState.conversations[index]!;
      nextState.conversations[index] = {
        ...existing,
        revision: existing.revision + 1,
        booking: nextBooking,
        labels: existing.labels.includes("booking")
          ? existing.labels
          : [...existing.labels, "booking"],
        messages: [
          ...existing.messages,
          {
            id: auditMessageId,
            role: "system",
            text: auditText,
            sentAt: now().toISOString(),
          },
        ],
      };
      const saved = await workspaceRepository.save(
        workspaceId,
        workspace.revision,
        nextState,
      );
      if (saved.ok) {
        const savedConversation = saved.workspace.state.conversations[index]!;
        await enqueueCalendarSync(savedConversation.id, nextBooking.revision);
        return success(auditText, {
          success: true,
          action,
          booking: nextBooking,
          conversationRevision: savedConversation.revision,
        });
      }
    }

    return failure(
      "revision_conflict",
      "The workspace kept changing while the agent was updating the booking.",
      "Tell the customer the booking could not be changed and retry from the newest state.",
    );
  };
}
