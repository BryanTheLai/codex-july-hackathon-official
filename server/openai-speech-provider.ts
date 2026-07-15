import { createReadStream } from "node:fs";

import OpenAI from "openai";
import { z } from "zod";

import type { AgentProviderConfig } from "./agent-provider";
import { isAbortError } from "../src/shared/errors";

const whisperModel = "whisper-1" as const;

const speechResultSchema = z
  .object({
    detectedLanguage: z.string().trim().min(1).max(64),
    originalTranscript: z.string().trim().min(1).max(4096),
    englishGloss: z.string().trim().min(1).max(4096).nullable(),
    model: z.literal(whisperModel),
  })
  .strict();

export type SpeechResult = z.infer<typeof speechResultSchema>;

export type OpenAiSpeechClient = {
  audio: {
    transcriptions: {
      create(
        input: {
          file: ReturnType<typeof createReadStream>;
          model: typeof whisperModel;
          response_format: "verbose_json";
        },
        options?: { signal?: AbortSignal },
      ): Promise<{ language: string; text: string }>;
    };
    translations: {
      create(
        input: {
          file: ReturnType<typeof createReadStream>;
          model: typeof whisperModel;
        },
        options?: { signal?: AbortSignal },
      ): Promise<{ text: string }>;
    };
  };
};

export interface SpeechProvider {
  transcribe(filePath: string, signal?: AbortSignal): Promise<SpeechResult>;
}

export class OpenAiSpeechProviderError extends Error {
  readonly code: "provider_timeout" | "provider_failed";

  constructor(code: OpenAiSpeechProviderError["code"], message: string) {
    super(message);
    this.name = "OpenAiSpeechProviderError";
    this.code = code;
  }
}

function defaultClient(config: AgentProviderConfig): OpenAiSpeechClient {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: 45_000,
    maxRetries: 1,
  }) as unknown as OpenAiSpeechClient;
}

function isEnglish(language: string): boolean {
  const normalized = language.trim().toLowerCase();
  return normalized === "english" || normalized === "en";
}

export function createOpenAiSpeechProvider(
  config: AgentProviderConfig,
  client: OpenAiSpeechClient = defaultClient(config),
): SpeechProvider {
  return {
    async transcribe(filePath, signal) {
      try {
        const transcription = await client.audio.transcriptions.create(
          {
            file: createReadStream(filePath),
            model: whisperModel,
            response_format: "verbose_json",
          },
          { signal },
        );
        const detectedLanguage = transcription.language.trim();
        const englishGloss = isEnglish(detectedLanguage)
          ? null
          : (
              await client.audio.translations.create(
                { file: createReadStream(filePath), model: whisperModel },
                { signal },
              )
            ).text;
        return speechResultSchema.parse({
          detectedLanguage,
          originalTranscript: transcription.text,
          englishGloss,
          model: whisperModel,
        });
      } catch (error) {
        if (isAbortError(error)) {
          throw new OpenAiSpeechProviderError(
            "provider_timeout",
            "OpenAI speech request timed out.",
          );
        }
        throw new OpenAiSpeechProviderError(
          "provider_failed",
          "OpenAI speech request failed.",
        );
      }
    },
  };
}
