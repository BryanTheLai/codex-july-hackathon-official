import ical, {
  ICalCalendarMethod,
  ICalEventClass,
  ICalEventStatus,
} from "ical-generator";
import { z } from "zod";

const invitationInputSchema = z
  .object({
    endIso: z.iso.datetime({ offset: true }),
    kind: z.enum(["publish", "cancel"]),
    location: z.string().trim().min(1).max(256).nullable(),
    sequence: z.number().int().nonnegative(),
    startIso: z.iso.datetime({ offset: true }),
    uid: z.string().trim().min(1).max(512),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Date(value.endIso) <= new Date(value.startIso)) {
      context.addIssue({
        code: "custom",
        path: ["endIso"],
        message: "Calendar event end must be after its start",
      });
    }
  });

export type CalendarInvitationInput = z.infer<typeof invitationInputSchema>;

/**
 * Creates an appointment-only RFC 5545 invitation. Patient identity, reason,
 * medical data, and conversation content are deliberately excluded.
 */
export function createCalendarInvitation(input: CalendarInvitationInput): string {
  const invitation = invitationInputSchema.parse(input);
  const calendar = ical({
    name: "KaunterAI appointment",
    prodId: "-//KaunterAI//Appointment//EN",
  });
  calendar.method(
    invitation.kind === "cancel"
      ? ICalCalendarMethod.CANCEL
      : ICalCalendarMethod.PUBLISH,
  );
  calendar.createEvent({
    class: ICalEventClass.PRIVATE,
    end: new Date(invitation.endIso),
    id: invitation.uid,
    location: invitation.location,
    sequence: invitation.sequence,
    start: new Date(invitation.startIso),
    status:
      invitation.kind === "cancel"
        ? ICalEventStatus.CANCELLED
        : ICalEventStatus.CONFIRMED,
    summary: "Appointment",
  });
  return calendar.toString();
}
