import { describe, expect, it } from "vitest";

import { createAppointmentCalendarEvent } from "../../server/calendar-event";

describe("service visit calendar event contract", () => {
  it("owns the shared ICS and Google Calendar core fields", () => {
    expect(
      createAppointmentCalendarEvent({
        durationMinutes: 30,
        location: "KaunterAI Aircon Service Hub",
        slotIso: "2026-07-21T10:30:00+08:00",
      }),
    ).toEqual({
      endIso: "2026-07-21T03:00:00.000Z",
      location: "KaunterAI Aircon Service Hub",
      startIso: "2026-07-21T02:30:00.000Z",
      summary: "Aircon service visit",
    });
  });
});
