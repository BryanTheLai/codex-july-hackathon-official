import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

const disabledSchema = z.object({
  GOOGLE_CALENDAR_ENABLED: z.enum(["true", "false"]).default("false"),
});

const enabledSchema = z.object({
  GOOGLE_CALENDAR_ADMIN_TOKEN: z.string().trim().min(24).max(512),
  GOOGLE_CALENDAR_CLIENT_ID: z.string().trim().min(1).max(512),
  GOOGLE_CALENDAR_CLIENT_SECRET: z.string().trim().min(1).max(512),
  GOOGLE_CALENDAR_ID: z.string().trim().min(1).max(512).default("primary"),
  GOOGLE_CALENDAR_REDIRECT_URI: z.url(),
  GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY: z.string().trim().min(1).max(512),
  GOOGLE_CALENDAR_TIME_ZONE: z.string().trim().min(1).max(128).default("Asia/Kuala_Lumpur"),
  CALENDAR_DEFAULT_DURATION_MINUTES: z.coerce.number().int().min(5).max(480).default(30),
});

export type GoogleCalendarConfig =
  | { enabled: false }
  | {
      enabled: true;
      adminToken: string;
      calendarId: string;
      clientId: string;
      clientSecret: string;
      defaultDurationMinutes: number;
      redirectUri: string;
      timeZone: string;
      tokenEncryptionKey: Buffer;
    };

function tokenKey(value: string): Buffer {
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, "base64url");
  } catch {
    throw new Error("GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY must be base64url-encoded");
  }
  if (decoded.byteLength !== 32) {
    throw new Error("GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY must decode to 32 bytes");
  }
  return decoded;
}

export function readGoogleCalendarConfig(
  environment: Record<string, string | undefined> = process.env,
): GoogleCalendarConfig {
  const basic = disabledSchema.parse(environment);
  if (basic.GOOGLE_CALENDAR_ENABLED === "false") return { enabled: false };
  const parsed = enabledSchema.parse(environment);
  return {
    enabled: true,
    adminToken: parsed.GOOGLE_CALENDAR_ADMIN_TOKEN,
    calendarId: parsed.GOOGLE_CALENDAR_ID,
    clientId: parsed.GOOGLE_CALENDAR_CLIENT_ID,
    clientSecret: parsed.GOOGLE_CALENDAR_CLIENT_SECRET,
    defaultDurationMinutes: parsed.CALENDAR_DEFAULT_DURATION_MINUTES,
    redirectUri: parsed.GOOGLE_CALENDAR_REDIRECT_URI,
    timeZone: parsed.GOOGLE_CALENDAR_TIME_ZONE,
    tokenEncryptionKey: tokenKey(parsed.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY),
  };
}

export function encryptGoogleCalendarToken(value: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptGoogleCalendarToken(value: string, key: Buffer): string {
  const [version, encodedIv, encodedTag, encodedCiphertext] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error("Stored Google Calendar token is malformed");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encodedIv, "base64url"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

type OAuthState = { expiresAt: number; nonce: string; workspaceId: string };

export function createGoogleOAuthState(
  workspaceId: string,
  key: Buffer,
  now: () => number = Date.now,
): string {
  const payload = Buffer.from(
    JSON.stringify({
      expiresAt: now() + 10 * 60_000,
      nonce: randomBytes(16).toString("base64url"),
      workspaceId,
    } satisfies OAuthState),
  ).toString("base64url");
  const signature = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyGoogleOAuthState(
  value: string,
  key: Buffer,
  now: () => number = Date.now,
): OAuthState {
  const [payload, signature] = value.split(".");
  if (!payload || !signature) throw new Error("Google authorization state is invalid");
  const expected = createHmac("sha256", key).update(payload).digest("base64url");
  const actual = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actual.byteLength !== expectedBuffer.byteLength || !timingSafeEqual(actual, expectedBuffer)) {
    throw new Error("Google authorization state is invalid");
  }
  const parsed = z.object({
    expiresAt: z.number().int().positive(),
    nonce: z.string().min(16),
    workspaceId: z.string().min(1).max(128),
  }).strict().safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  if (!parsed.success || parsed.data.expiresAt < now()) {
    throw new Error("Google authorization state expired");
  }
  return parsed.data;
}
