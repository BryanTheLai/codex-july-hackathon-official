import { z } from "zod";

const appointmentCalendarEventInputSchema = z
  .object({
    durationMinutes: z.number().int().min(5).max(480),
    location: z.string().trim().min(1).max(256).nullable(),
    slotIso: z.iso.datetime({ offset: true }),
  })
  .strict();

export type AppointmentCalendarEvent = {
  endIso: string;
  location: string | null;
  startIso: string;
  summary: "Appointment";
};

export function createAppointmentCalendarEvent(
  input: z.input<typeof appointmentCalendarEventInputSchema>,
): AppointmentCalendarEvent {
  const parsed = appointmentCalendarEventInputSchema.parse(input);
  const start = new Date(parsed.slotIso);
  return {
    endIso: new Date(
      start.valueOf() + parsed.durationMinutes * 60_000,
    ).toISOString(),
    location: parsed.location,
    startIso: start.toISOString(),
    summary: "Appointment",
  };
}
