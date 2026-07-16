import { describe, expect, it } from "vitest";

import { readCalendarDispatchConfig } from "../../server/calendar-config";

describe("calendar dispatch configuration", () => {
  it("uses working demo defaults without a separate chat allowlist", () => {
    expect(
      readCalendarDispatchConfig({}),
    ).toMatchObject({
      defaultDurationMinutes: 30,
      enabled: true,
      location: null,
      uidDomain: "calendar.kaunterai.demo",
    });
  });

  it("honours an explicit demo switch-off", () => {
    expect(readCalendarDispatchConfig({ CALENDAR_DISPATCH_ENABLED: "false" })).toMatchObject({
      enabled: false,
    });
  });
});
