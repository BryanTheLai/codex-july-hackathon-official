import { describe, expect, it } from "vitest";

import { readCalendarDispatchConfig } from "../../server/calendar-config";

describe("calendar dispatch configuration", () => {
  it("requires an allowlisted chat before live calendar dispatch can be enabled", () => {
    expect(() =>
      readCalendarDispatchConfig({
        CALENDAR_ALLOWED_TELEGRAM_CHAT_IDS: "",
        CALENDAR_DEFAULT_DURATION_MINUTES: "30",
        CALENDAR_DISPATCH_ENABLED: "true",
        CALENDAR_LOCATION: "KaunterAI Clinic",
        CALENDAR_UID_DOMAIN: "calendar.kaunterai.test",
      }),
    ).toThrow("Calendar dispatch requires an allowlisted Telegram chat");
  });

  it("keeps disabled calendar delivery inert without an allowlist", () => {
    expect(
      readCalendarDispatchConfig({
        CALENDAR_ALLOWED_TELEGRAM_CHAT_IDS: "",
        CALENDAR_DEFAULT_DURATION_MINUTES: "30",
        CALENDAR_DISPATCH_ENABLED: "false",
        CALENDAR_LOCATION: "",
        CALENDAR_UID_DOMAIN: "calendar.kaunterai.test",
      }),
    ).toMatchObject({
      allowedChatIds: new Set(),
      defaultDurationMinutes: 30,
      enabled: false,
      location: null,
    });
  });
});
