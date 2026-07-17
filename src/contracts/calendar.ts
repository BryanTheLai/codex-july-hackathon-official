import { z } from "zod";

export const CALENDAR_INVITATION_SENT_AUDIT_PREFIX =
  "Calendar invitation sent to Telegram";

export const googleCalendarStatusSchema = z.object({
  calendarId: z.string().nullable(),
  configured: z.boolean(),
  mode: z.enum(["demo", "google"]),
  status: z.enum(["disabled", "disconnected", "connected", "error", "revoked"]),
});

export const googleCalendarConnectResponseSchema = z.object({
  authorizationUrl: z.string().url(),
});

export type GoogleCalendarStatus = z.infer<typeof googleCalendarStatusSchema>;
