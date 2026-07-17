import { readFile } from "node:fs/promises";

import { z } from "zod";

import { isAbortError } from "../src/shared/errors";
import type { TranslationService } from "./translation-service";
import type { SpeechProvider, SpeechResult } from "./openai-speech-provider";
import {
  TtsProviderError,
  type TtsProvider,
  type TtsSynthesisOptions,
} from "./openai-tts-provider";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const PROVIDERS = ["openai", "elevenlabs"] as const;
const DEFAULT_ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";
const PROVIDER_TIMEOUT_MS = 45_000;

const voiceProviderSelectionSchema = z
  .object({
    SPEECH_PROVIDER: z.enum(PROVIDERS).default("openai"),
    TTS_PROVIDER: z.enum(PROVIDERS).default("openai"),
  })
  .passthrough();

const optionalNumber = (min: number, max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.coerce.number().finite().min(min).max(max).optional(),
  );

const optionalBoolean = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.enum(["true", "false"]).transform((value) => value === "true").optional(),
);

const elevenLabsEnvironmentSchema = z
  .object({
    ELEVENLABS_API_KEY: z.string().trim().min(1),
    ELEVENLABS_BASE_URL: z
      .string()
      .trim()
      .url()
      .default(DEFAULT_ELEVENLABS_BASE_URL),
    ELEVENLABS_STT_MODEL: z.literal("scribe_v2").default("scribe_v2"),
    ELEVENLABS_TTS_MODEL: z.string().trim().min(1).max(256).default("eleven_flash_v2_5"),
    ELEVENLABS_VOICE_ID: z.string().trim().min(1).max(256).optional(),
    ELEVENLABS_TTS_STABILITY: optionalNumber(0, 1),
    ELEVENLABS_TTS_SIMILARITY_BOOST: optionalNumber(0, 1),
    ELEVENLABS_TTS_STYLE: optionalNumber(0, 1),
    ELEVENLABS_TTS_SPEED: optionalNumber(0.7, 1.2),
    ELEVENLABS_TTS_USE_SPEAKER_BOOST: optionalBoolean,
  })
  .passthrough();

const transcriptSchema = z
  .object({
    language_code: z.string().trim().min(1).max(64),
    text: z.string().trim().min(1).max(4096),
  })
  .passthrough();

export type VoiceProviderSelection = {
  speechProvider: (typeof PROVIDERS)[number];
  ttsProvider: (typeof PROVIDERS)[number];
};

export type ElevenLabsSpeechConfig = {
  apiKey: string;
  baseUrl: string;
  model: "scribe_v2";
};

export type ElevenLabsTtsConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  voiceId: string;
  voiceSettings?: {
    similarity_boost?: number;
    speed?: number;
    stability?: number;
    style?: number;
    use_speaker_boost?: boolean;
  };
};

export class ElevenLabsSpeechProviderError extends Error {
  readonly code: "provider_timeout" | "provider_failed";

  constructor(
    code: ElevenLabsSpeechProviderError["code"],
    message: string,
  ) {
    super(message);
    this.name = "ElevenLabsSpeechProviderError";
    this.code = code;
  }
}

function parseEnvironment(environment: Record<string, string | undefined>) {
  const parsed = elevenLabsEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error("ElevenLabs voice configuration is invalid");
  }
  return parsed.data;
}

function normalizedBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

function languageName(languageCode: string): string {
  const normalized = languageCode.trim().toLowerCase();
  if (normalized === "en" || normalized === "eng") return "English";
  if (normalized === "ms" || normalized === "msa" || normalized === "may") return "Malay";
  if (normalized === "zh" || normalized === "zho" || normalized === "cmn") return "Mandarin";
  return languageCode.trim();
}

function isEnglish(languageCode: string): boolean {
  const normalized = languageCode.trim().toLowerCase();
  return normalized === "en" || normalized === "eng" || normalized === "english";
}

function languageCodeForTts(targetLanguage?: string): string | undefined {
  const normalized = targetLanguage?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["en", "eng", "english"].includes(normalized)) return "en";
  if (["ms", "msa", "may", "malay"].includes(normalized)) return "ms";
  if (["zh", "zho", "cmn", "mandarin", "chinese"].includes(normalized)) return "zh";
  return undefined;
}

function failureMessage(response: Response): string {
  return `ElevenLabs returned ${response.status} ${response.statusText || "response"}.`;
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function readVoiceProviderSelection(
  environment: Record<string, string | undefined> = process.env,
): VoiceProviderSelection {
  const parsed = voiceProviderSelectionSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error("Voice provider selection is invalid");
  }
  return {
    speechProvider: parsed.data.SPEECH_PROVIDER,
    ttsProvider: parsed.data.TTS_PROVIDER,
  };
}

export function readElevenLabsSpeechConfig(
  environment: Record<string, string | undefined> = process.env,
): ElevenLabsSpeechConfig {
  const parsed = parseEnvironment(environment);
  return {
    apiKey: parsed.ELEVENLABS_API_KEY,
    baseUrl: normalizedBaseUrl(parsed.ELEVENLABS_BASE_URL),
    model: parsed.ELEVENLABS_STT_MODEL,
  };
}

export function readElevenLabsTtsConfig(
  environment: Record<string, string | undefined> = process.env,
): ElevenLabsTtsConfig {
  const parsed = parseEnvironment(environment);
  if (!parsed.ELEVENLABS_VOICE_ID) {
    throw new Error("ELEVENLABS_VOICE_ID is required when TTS_PROVIDER=elevenlabs");
  }
  const voiceSettings = {
    stability: parsed.ELEVENLABS_TTS_STABILITY,
    similarity_boost: parsed.ELEVENLABS_TTS_SIMILARITY_BOOST,
    style: parsed.ELEVENLABS_TTS_STYLE,
    speed: parsed.ELEVENLABS_TTS_SPEED,
    use_speaker_boost: parsed.ELEVENLABS_TTS_USE_SPEAKER_BOOST,
  };
  return {
    apiKey: parsed.ELEVENLABS_API_KEY,
    baseUrl: normalizedBaseUrl(parsed.ELEVENLABS_BASE_URL),
    model: parsed.ELEVENLABS_TTS_MODEL,
    voiceId: parsed.ELEVENLABS_VOICE_ID,
    ...(Object.values(voiceSettings).some((value) => value !== undefined)
      ? { voiceSettings }
      : {}),
  };
}

export function createElevenLabsSpeechProvider({
  config,
  fetcher = fetch,
  translation,
}: {
  config: ElevenLabsSpeechConfig;
  fetcher?: Fetcher;
  translation?: TranslationService;
}): SpeechProvider {
  return {
    async transcribe(filePath, signal) {
      try {
        const bytes = new Uint8Array(await readFile(filePath));
        const form = new FormData();
        form.set("model_id", config.model);
        form.set("tag_audio_events", "false");
        form.set("timestamps_granularity", "none");
        form.set("file", new Blob([bytes], { type: "audio/webm" }), "telegram-voice.webm");
        const response = await fetcher(`${config.baseUrl}/speech-to-text`, {
          method: "POST",
          headers: { "xi-api-key": config.apiKey },
          body: form,
          signal: requestSignal(signal),
        });
        if (!response.ok) {
          throw new ElevenLabsSpeechProviderError("provider_failed", failureMessage(response));
        }
        const transcript = transcriptSchema.parse(await response.json());
        const detectedLanguage = languageName(transcript.language_code);
        const englishGloss = isEnglish(transcript.language_code)
          ? null
          : translation
            ? (
                await translation.translate(
                  {
                    text: transcript.text,
                    sourceLanguage: detectedLanguage,
                    targetLanguage: "English",
                  },
                  signal,
                )
              ).translatedText
            : null;
        return {
          detectedLanguage,
          originalTranscript: transcript.text,
          englishGloss,
          model: config.model,
        } satisfies SpeechResult;
      } catch (error) {
        if (error instanceof ElevenLabsSpeechProviderError) throw error;
        if (isAbortError(error)) {
          throw new ElevenLabsSpeechProviderError(
            "provider_timeout",
            "ElevenLabs speech request timed out.",
          );
        }
        throw new ElevenLabsSpeechProviderError(
          "provider_failed",
          "ElevenLabs speech request failed.",
        );
      }
    },
  };
}

export function createElevenLabsTtsProvider({
  config,
  fetcher = fetch,
}: {
  config: ElevenLabsTtsConfig;
  fetcher?: Fetcher;
}): TtsProvider {
  return {
    async synthesize(text: string, options?: TtsSynthesisOptions) {
      try {
        const input = z.string().trim().min(1).max(4096).parse(text);
        const languageCode = languageCodeForTts(options?.targetLanguage);
        const response = await fetcher(
          `${config.baseUrl}/text-to-speech/${encodeURIComponent(config.voiceId)}/stream`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "xi-api-key": config.apiKey,
            },
            body: JSON.stringify({
              text: input,
              model_id: config.model,
              ...(languageCode ? { language_code: languageCode } : {}),
              ...(config.voiceSettings ? { voice_settings: config.voiceSettings } : {}),
            }),
            signal: requestSignal(options?.signal),
          },
        );
        if (!response.ok) {
          throw new TtsProviderError("provider_failed", failureMessage(response));
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength === 0) {
          throw new Error("ElevenLabs returned empty audio");
        }
        return { bytes, model: config.model, voice: config.voiceId };
      } catch (error) {
        if (error instanceof TtsProviderError) throw error;
        if (isAbortError(error)) {
          throw new TtsProviderError("provider_timeout", "Text-to-speech request timed out.");
        }
        throw new TtsProviderError("provider_failed", "Text-to-speech provider failed.");
      }
    },
  };
}
