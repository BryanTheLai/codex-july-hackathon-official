import { z } from "zod";

import type { CalendarDispatchConfig } from "./calendar-dispatch-service";

const calendarEnvironmentSchema = z.object({
  CALENDAR_ALLOWED_TELEGRAM_CHAT_IDS: z.string(),
  CALENDAR_DEFAULT_DURATION_MINUTES: z.coerce.number().int().min(5).max(480),
  CALENDAR_DISPATCH_ENABLED: z.enum(["true", "false"]),
  CALENDAR_LOCATION: z.string().trim().max(256),
  CALENDAR_UID_DOMAIN: z.string().trim().min(1).max(253).regex(/^[A-Za-z0-9.-]+$/),
});

export function readCalendarDispatchConfig(
  environment: Record<string, string | undefined> = process.env,
): CalendarDispatchConfig {
  const parsed = calendarEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error("Calendar dispatch configuration is invalid");
  }
  const allowedChatIds = new Set(
    parsed.data.CALENDAR_ALLOWED_TELEGRAM_CHAT_IDS.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (parsed.data.CALENDAR_DISPATCH_ENABLED === "true" && allowedChatIds.size === 0) {
    throw new Error("Calendar dispatch requires an allowlisted Telegram chat");
  }
  return {
    allowedChatIds,
    defaultDurationMinutes: parsed.data.CALENDAR_DEFAULT_DURATION_MINUTES,
    enabled: parsed.data.CALENDAR_DISPATCH_ENABLED === "true",
    location: parsed.data.CALENDAR_LOCATION || null,
    uidDomain: parsed.data.CALENDAR_UID_DOMAIN,
  };
}
