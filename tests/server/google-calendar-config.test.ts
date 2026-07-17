import { describe, expect, it } from "vitest";

import { readGoogleCalendarConfig } from "../../server/google-calendar-config";

function enabledEnvironment(timeZone?: string) {
  return {
    GOOGLE_CALENDAR_ENABLED: "true",
    GOOGLE_CALENDAR_ADMIN_TOKEN: "a".repeat(24),
    GOOGLE_CALENDAR_CLIENT_ID: "client-id",
    GOOGLE_CALENDAR_CLIENT_SECRET: "client-secret",
    GOOGLE_CALENDAR_REDIRECT_URI: "https://example.com/callback",
    GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString(
      "base64url",
    ),
    ...(timeZone ? { GOOGLE_CALENDAR_TIME_ZONE: timeZone } : {}),
  };
}

describe("Google Calendar timezone configuration", () => {
  it("defaults to Malaysian time", () => {
    expect(readGoogleCalendarConfig(enabledEnvironment())).toMatchObject({
      enabled: true,
      timeZone: "Asia/Kuala_Lumpur",
    });
  });

  it("rejects a timezone that would make Calendar disagree with the app", () => {
    expect(() =>
      readGoogleCalendarConfig(enabledEnvironment("America/New_York")),
    ).toThrow();
  });
});
