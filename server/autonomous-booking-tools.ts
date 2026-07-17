import { createHash } from "node:crypto";

import { z } from "zod";

import type {
  BookingPayload,
  ServerDomainStatePayload,
} from "../src/contracts/app-state";
import type {
  AgentProviderFunctionTool,
  AgentToolExecution,
  AgentToolExecutor,
} from "./agent-service";
import type { WorkspaceRepository } from "./workspace-repository";

const PROVIDERS = ["Dr. Farah", "Dr. Lim"] as const;
const SLOT_TIMES = ["09:00", "10:30", "14:00", "15:30"] as const;
const MAX_CAS_ATTEMPTS = 3;
const KUALA_LUMPUR_TIME_ZONE = "Asia/Kuala_Lumpur";

const listSlotsSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    provider: z.enum(PROVIDERS),
  })
  .strict();

const bookingArgumentsSchema = z
  .object({
    provider: z.enum(PROVIDERS),
    reason: z.string().trim().min(1).max(500),
    slotIso: z.iso.datetime({ offset: true }),
  })
  .strict();

const cancelArgumentsSchema = z.object({}).strict();

export const autonomousBookingTools: AgentProviderFunctionTool[] = [
  {
    type: "function",
    name: "list_available_slots",
    description:
      "Read current clinic appointment availability. Use this before creating or rescheduling a booking when you need a valid slot.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        date: {
          anyOf: [
            { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            { type: "null" },
          ],
          description: "Requested local clinic date in YYYY-MM-DD, or null for the next available slots.",
        },
        provider: { type: "string", enum: PROVIDERS },
      },
      required: ["date", "provider"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "create_booking",
    description:
      "Create and confirm a new appointment immediately. Only use a slot returned by list_available_slots. This is an autonomous patient-facing action.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        provider: { type: "string", enum: PROVIDERS },
        slotIso: { type: "string", format: "date-time" },
        reason: { type: "string", minLength: 1, maxLength: 500 },
      },
      required: ["provider", "slotIso", "reason"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "reschedule_booking",
    description:
      "Move the patient's already confirmed appointment to a returned available slot. This action is immediate and does not wait for staff approval.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        provider: { type: "string", enum: PROVIDERS },
        slotIso: { type: "string", format: "date-time" },
        reason: { type: "string", minLength: 1, maxLength: 500 },
      },
      required: ["provider", "slotIso", "reason"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "cancel_booking",
    description:
      "Cancel the patient's already confirmed appointment immediately. Use only when the patient asks to cancel.",
    strict: true,
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
];

type BookingToolName =
  | "list_available_slots"
  | "create_booking"
  | "reschedule_booking"
  | "cancel_booking";

type ToolSuccess = {
  success: true;
  action: "availability_listed" | "booking_created" | "booking_rescheduled" | "booking_cancelled";
  booking?: BookingPayload;
  conversationRevision: number | null;
  slots?: Array<{ provider: string; slotIso: string }>;
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
  provider: (typeof PROVIDERS)[number],
  requestedDate: string | null,
  now: Date,
): Array<{ provider: string; slotIso: string }> {
  const reserved = new Set(
    state.conversations
      .map((conversation) => conversation.booking)
      .filter(
        (booking): booking is BookingPayload =>
          booking?.status === "approved" && booking.provider === provider,
      )
      .map((booking) => booking.slotIso),
  );
  let date = requestedDate ?? localDate(now);
  const slots: Array<{ provider: string; slotIso: string }> = [];
  for (let offset = 0; offset < 8 && slots.length < 8; offset += 1) {
    for (const time of SLOT_TIMES) {
      const candidate = slotIso(date, time);
      if (
        new Date(candidate) > now &&
        !reserved.has(candidate) &&
        (requestedDate === null || date === requestedDate)
      ) {
        slots.push({ provider, slotIso: candidate });
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
  now?: () => Date;
  workspaceId: string;
  workspaceRepository: WorkspaceRepository;
};

export function createAutonomousBookingToolExecutor({
  now = () => new Date(),
  workspaceId,
  workspaceRepository,
}: AutonomousBookingToolOptions): AgentToolExecutor {
  return async ({ call, request }) => {
    if (!isBookingToolName(call.name)) {
      return failure(
        "invalid_arguments",
        "The requested tool is not available to this agent.",
        "Choose one of the supplied booking tools.",
      );
    }

    if (call.name === "list_available_slots") {
      const parsed = parseArguments(call.argumentsJson, listSlotsSchema);
      if (!parsed.ok) {
        return failure(
          "invalid_arguments",
          "Availability lookup arguments are invalid.",
          "Provide one supported provider and a YYYY-MM-DD date or null.",
        );
      }
      const workspace = await workspaceRepository.load(workspaceId);
      if (!workspace) {
        return failure("not_found", "Workspace was not found.", "Try again later.");
      }
      const slots = availableSlots(
        workspace.state,
        parsed.value.provider,
        parsed.value.date,
        now(),
      );
      return success(
        `Found ${slots.length} available slot${slots.length === 1 ? "" : "s"} for ${parsed.value.provider}.`,
        {
          success: true,
          action: "availability_listed",
          conversationRevision: null,
          slots,
        },
      );
    }

    const parsed =
      call.name === "cancel_booking"
        ? parseArguments(call.argumentsJson, cancelArgumentsSchema)
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
        return failure("not_found", "Conversation was not found.", "Ask the patient to send a new message.");
      }
      const conversation = workspace.state.conversations[index]!;
      if (conversation.messages.some((message) => message.id === auditMessageId)) {
        const action =
          call.name === "create_booking"
            ? "booking_created"
            : call.name === "reschedule_booking"
              ? "booking_rescheduled"
              : "booking_cancelled";
        return success("This autonomous action was already completed.", {
          success: true,
          action,
          booking: conversation.booking,
          conversationRevision: conversation.revision,
        });
      }
      if (conversation.revision !== request.conversation.revision) {
        return failure(
          "revision_conflict",
          "The conversation changed while the agent was working.",
          "Use the newest patient message and retry the task once.",
        );
      }
      if (conversation.workflowStatus === "resolved") {
        return failure(
          "invalid_state",
          "A resolved conversation cannot change a booking.",
          "Ask the patient to start a new request.",
        );
      }

      let nextBooking: BookingPayload;
      let action: ToolSuccess["action"];
      let auditText: string;
      if (call.name === "cancel_booking") {
        if (!conversation.booking || conversation.booking.status !== "approved") {
          return failure(
            "invalid_state",
            "Only a confirmed appointment can be cancelled.",
            "Explain the current appointment status and offer available slots if needed.",
          );
        }
        nextBooking = {
          ...conversation.booking,
          status: "cancelled",
          revision: conversation.booking.revision + 1,
        };
        action = "booking_cancelled";
        auditText = "Autonomous agent cancelled the confirmed appointment.";
      } else {
        const argumentsValue = parsed.value as z.infer<typeof bookingArgumentsSchema>;
        const slots = availableSlots(
          workspace.state,
          argumentsValue.provider,
          argumentsValue.slotIso.slice(0, 10),
          now(),
        );
        if (!slots.some((slot) => slot.slotIso === argumentsValue.slotIso)) {
          return failure(
            "slot_unavailable",
            "That appointment slot is no longer available.",
            "Call list_available_slots again and offer one of the returned slots.",
          );
        }
        if (call.name === "create_booking") {
          if (conversation.booking?.status === "approved") {
            return failure(
              "invalid_state",
              "The patient already has a confirmed appointment.",
              "Use reschedule_booking or cancel_booking instead.",
            );
          }
          nextBooking = {
            provider: argumentsValue.provider,
            slotIso: argumentsValue.slotIso,
            reason: argumentsValue.reason,
            status: "approved",
            revision: (conversation.booking?.revision ?? 0) + 1,
          };
          action = "booking_created";
          auditText = `Autonomous agent confirmed an appointment with ${nextBooking.provider}.`;
        } else {
          if (!conversation.booking || conversation.booking.status !== "approved") {
            return failure(
              "invalid_state",
              "Only a confirmed appointment can be rescheduled.",
              "Create a new booking or explain the current appointment status.",
            );
          }
          nextBooking = {
            ...conversation.booking,
            provider: argumentsValue.provider,
            slotIso: argumentsValue.slotIso,
            reason: argumentsValue.reason,
            revision: conversation.booking.revision + 1,
          };
          action = "booking_rescheduled";
          auditText = `Autonomous agent rescheduled the appointment with ${nextBooking.provider}.`;
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
      "Tell the patient the booking could not be changed and retry from the newest state.",
    );
  };
}
