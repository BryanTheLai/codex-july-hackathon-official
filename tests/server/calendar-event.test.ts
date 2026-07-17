import { describe, expect, it } from "vitest";

import { createAppointmentCalendarEvent } from "../../server/calendar-event";

describe("appointment calendar event contract", () => {
  it("owns the shared ICS and Google Calendar core fields", () => {
    expect(
      createAppointmentCalendarEvent({
        durationMinutes: 30,
        location: "MoneyLion Health Clinic",
        slotIso: "2026-07-21T10:30:00+08:00",
      }),
    ).toEqual({
      endIso: "2026-07-21T03:00:00.000Z",
      location: "MoneyLion Health Clinic",
      startIso: "2026-07-21T02:30:00.000Z",
      summary: "Appointment",
    });
  });
});
