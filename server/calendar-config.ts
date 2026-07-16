import { z } from "zod";

import type { CalendarDispatchConfig } from "./calendar-dispatch-service";

const calendarEnvironmentSchema = z.object({
  CALENDAR_DEFAULT_DURATION_MINUTES: z.coerce.number().int().min(5).max(480).default(30),
  CALENDAR_DISPATCH_ENABLED: z.enum(["true", "false"]).default("true"),
  CALENDAR_LOCATION: z.string().trim().max(256).default(""),
  CALENDAR_UID_DOMAIN: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(/^[A-Za-z0-9.-]+$/)
    .default("calendar.kaunterai.demo"),
});

export function readCalendarDispatchConfig(
  environment: Record<string, string | undefined> = process.env,
): CalendarDispatchConfig {
  const parsed = calendarEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error("Calendar dispatch configuration is invalid");
  }
  return {
    defaultDurationMinutes: parsed.data.CALENDAR_DEFAULT_DURATION_MINUTES,
    enabled: parsed.data.CALENDAR_DISPATCH_ENABLED === "true",
    location: parsed.data.CALENDAR_LOCATION || null,
    uidDomain: parsed.data.CALENDAR_UID_DOMAIN,
  };
}
