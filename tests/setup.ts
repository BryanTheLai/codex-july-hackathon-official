/// <reference types="node" />
import "@testing-library/jest-dom/vitest";

// Unit tests must not inherit laptop/DO secrets from a sourced .env.
// Providers construct OpenAI clients at app boot when LLM_API_KEY is set;
// jsdom then trips the SDK browser guard.
for (const key of [
  "LLM_API_KEY",
  "LLM_BASE_URL",
  "JUDGE_MODEL",
  "LIVE_AGENT_ENABLED",
  "SPEECH_PROVIDER",
  "TTS_PROVIDER",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_VOICE_ID",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "LIVE_TELEGRAM_ENABLED",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GOOGLE_CALENDAR_ENABLED",
  "GOOGLE_CALENDAR_ADMIN_TOKEN",
  "GOOGLE_CALENDAR_CLIENT_ID",
  "GOOGLE_CALENDAR_CLIENT_SECRET",
  "GOOGLE_CALENDAR_REDIRECT_URI",
  "GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY",
]) {
  delete process.env[key];
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

class ResizeObserverStub implements ResizeObserver {
  disconnect(): void {}

  observe(): void {}

  unobserve(): void {}
}

globalThis.ResizeObserver = ResizeObserverStub;
