import { describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";

import {
  createOpenAiSpeechProvider,
  type OpenAiSpeechClient,
} from "../../server/openai-speech-provider";

const config = {
  apiKey: "test-key",
  apiMode: "responses" as const,
  baseUrl: "https://api.openai.com/v1",
  liveEnabled: false,
  model: "test-text-model",
};
const fixtureFile = resolve(process.cwd(), "package.json");

function client(input: { language: string; text: string; translation?: string }) {
  return {
    audio: {
      transcriptions: {
        create: vi.fn().mockResolvedValue({
          language: input.language,
          text: input.text,
        }),
      },
      translations: {
        create: vi.fn().mockResolvedValue({
          text: input.translation ?? "",
        }),
      },
    },
  } satisfies OpenAiSpeechClient;
}

describe("OpenAI speech provider", () => {
  it("uses Whisper transcription plus translation for a non-English voice note", async () => {
    const mock = client({
      language: "Malay",
      text: "Saya mahu buat temujanji.",
      translation: "I would like to make an appointment.",
    });
    const provider = createOpenAiSpeechProvider(config, mock);

    await expect(provider.transcribe(fixtureFile)).resolves.toEqual({
      detectedLanguage: "Malay",
      originalTranscript: "Saya mahu buat temujanji.",
      englishGloss: "I would like to make an appointment.",
      model: "whisper-1",
    });
    expect(mock.audio.transcriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "whisper-1", response_format: "verbose_json" }),
      expect.any(Object),
    );
    expect(mock.audio.translations.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "whisper-1" }),
      expect.any(Object),
    );
  });

  it("does not translate English speech", async () => {
    const mock = client({ language: "English", text: "I need an appointment." });
    const provider = createOpenAiSpeechProvider(config, mock);

    await expect(provider.transcribe(fixtureFile)).resolves.toMatchObject({
      detectedLanguage: "English",
      originalTranscript: "I need an appointment.",
      englishGloss: null,
    });
    expect(mock.audio.translations.create).not.toHaveBeenCalled();
  });
});
