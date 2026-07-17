import { describe, expect, it } from "vitest";

import { createCalendarInvitation } from "../../server/calendar-ics";

describe("calendar invitation", () => {
  it("creates a minimal private appointment without patient medical data", () => {
    const invitation = createCalendarInvitation({
      endIso: "2026-07-21T02:30:00.000Z",
      kind: "publish",
      location: "KaunterAI Clinic",
      sequence: 2,
      startIso: "2026-07-21T02:00:00.000Z",
      uid: "booking-demo-convo-42@calendar.kaunterai.test",
    });

    expect(invitation).toContain("BEGIN:VCALENDAR\r\n");
    expect(invitation).toContain("METHOD:PUBLISH\r\n");
    expect(invitation).toContain("UID:booking-demo-convo-42@calendar.kaunterai.test\r\n");
    expect(invitation).toContain("SEQUENCE:2\r\n");
    expect(invitation).toContain("DTSTART:20260721T020000Z\r\n");
    expect(invitation).toContain("DTEND:20260721T023000Z\r\n");
    expect(invitation).toContain("SUMMARY:Appointment\r\n");
    expect(invitation).not.toContain("MRN-");
    expect(invitation).not.toContain("reason");
  });

  it("keeps the UID and increases sequence for cancellation", () => {
    const invitation = createCalendarInvitation({
      endIso: "2026-07-21T02:30:00.000Z",
      kind: "cancel",
      location: null,
      sequence: 3,
      startIso: "2026-07-21T02:00:00.000Z",
      uid: "booking-demo-convo-42@calendar.kaunterai.test",
    });

    expect(invitation).toContain("METHOD:CANCEL\r\n");
    expect(invitation).toContain("STATUS:CANCELLED\r\n");
    expect(invitation).toContain("UID:booking-demo-convo-42@calendar.kaunterai.test\r\n");
    expect(invitation).toContain("SEQUENCE:3\r\n");
  });
});
