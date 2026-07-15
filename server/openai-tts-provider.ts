import OpenAI from "openai";
import { z } from "zod";

import { isAbortError } from "../src/shared/errors";
import type { AgentProviderConfig } from "./agent-provider";

const ttsEnvironmentSchema = z
  .object({
    TTS_MODEL: z.string().trim().min(1).max(256).default("gpt-4o-mini-tts"),
    TTS_VOICE: z
      .enum(["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"])
      .default("coral"),
  })
  .passthrough();

export type TtsConfig = {
  model: string;
  voice: z.infer<typeof ttsEnvironmentSchema>["TTS_VOICE"];
};

export type SynthesizedVoice = {
  bytes: Uint8Array;
  model: string;
  voice: string;
};

export interface TtsProvider {
  synthesize(text: string, signal?: AbortSignal): Promise<SynthesizedVoice>;
}

export class TtsProviderError extends Error {
  readonly code: "provider_timeout" | "provider_failed";

  constructor(code: TtsProviderError["code"], message: string) {
    super(message);
    this.name = "TtsProviderError";
    this.code = code;
  }
}

export function readTtsConfig(
  environment: Record<string, string | undefined> = process.env,
): TtsConfig {
  const parsed = ttsEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error("Text-to-speech configuration is invalid");
  }
  return { model: parsed.data.TTS_MODEL, voice: parsed.data.TTS_VOICE };
}

export function createOpenAiTtsProvider(
  config: AgentProviderConfig,
  ttsConfig: TtsConfig = readTtsConfig(),
): TtsProvider {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: 45_000,
    maxRetries: 1,
  });
  return {
    async synthesize(text, signal) {
      try {
        const response = await client.audio.speech.create(
          {
            model: ttsConfig.model,
            voice: ttsConfig.voice,
            input: z.string().trim().min(1).max(4096).parse(text),
            response_format: "opus",
          },
          { signal },
        );
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength === 0) {
          throw new Error("Text-to-speech returned empty audio");
        }
        return { bytes, model: ttsConfig.model, voice: ttsConfig.voice };
      } catch (error) {
        if (isAbortError(error)) {
          throw new TtsProviderError(
            "provider_timeout",
            "Text-to-speech request timed out.",
          );
        }
        throw new TtsProviderError(
          "provider_failed",
          "Text-to-speech provider failed.",
        );
      }
    },
  };
}
