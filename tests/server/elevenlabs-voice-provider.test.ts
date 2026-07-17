import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  ElevenLabsSpeechProviderError,
  createElevenLabsSpeechProvider,
  createElevenLabsTtsProvider,
  readElevenLabsSpeechConfig,
  readElevenLabsTtsConfig,
  readVoiceProviderSelection,
} from "../../server/elevenlabs-voice-provider";
import { TtsProviderError } from "../../server/openai-tts-provider";

const fixtureFile = resolve(process.cwd(), "package.json");
const environment = {
  ELEVENLABS_API_KEY: "eleven-test-key",
  ELEVENLABS_VOICE_ID: "voice-demo-1",
};

describe("ElevenLabs voice providers", () => {
  it("keeps OpenAI selected until the deployment explicitly changes each speech side", () => {
    expect(readVoiceProviderSelection({})).toEqual({
      speechProvider: "openai",
      ttsProvider: "openai",
    });
    expect(
      readVoiceProviderSelection({
        SPEECH_PROVIDER: "elevenlabs",
        TTS_PROVIDER: "elevenlabs",
      }),
    ).toEqual({ speechProvider: "elevenlabs", ttsProvider: "elevenlabs" });
  });

  it("reads the direct ElevenLabs model, voice, and optional code-controlled voice settings", () => {
    expect(readElevenLabsSpeechConfig(environment)).toEqual({
      apiKey: "eleven-test-key",
      baseUrl: "https://api.elevenlabs.io/v1",
      model: "scribe_v2",
    });
    expect(
      readElevenLabsTtsConfig({
        ...environment,
        ELEVENLABS_TTS_STABILITY: "0.25",
        ELEVENLABS_TTS_SIMILARITY_BOOST: "0.8",
        ELEVENLABS_TTS_STYLE: "0.1",
        ELEVENLABS_TTS_SPEED: "1.05",
        ELEVENLABS_TTS_USE_SPEAKER_BOOST: "true",
      }),
    ).toMatchObject({
      model: "eleven_v3",
      voiceId: "voice-demo-1",
      voiceSettings: {
        stability: 0.25,
        similarity_boost: 0.8,
        style: 0.1,
        speed: 1.05,
        use_speaker_boost: true,
      },
    });
    expect(() => readElevenLabsTtsConfig({ ELEVENLABS_API_KEY: "key" })).toThrow(
      "ELEVENLABS_VOICE_ID",
    );
  });

  it("keeps the code defaults and deployment example on Eleven v3 and Scribe v2", () => {
    const example = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");
    expect(example).toContain("ELEVENLABS_STT_MODEL=scribe_v2");
    expect(example).toContain("ELEVENLABS_TTS_MODEL=eleven_v3");
    expect(readElevenLabsSpeechConfig(environment).model).toBe("scribe_v2");
    expect(readElevenLabsTtsConfig(environment).model).toBe("eleven_v3");
  });

  it("transcribes a Telegram WebM with Scribe v2 and creates the existing English gloss", async () => {
    const translate = vi.fn().mockResolvedValue({
      translatedText: "I would like to make an appointment.",
      targetLanguage: "English",
      model: "text-model",
    });
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ language_code: "ms", text: "Saya mahu buat temujanji." }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = createElevenLabsSpeechProvider({
      config: readElevenLabsSpeechConfig(environment),
      fetcher,
      translation: { translate },
    });

    await expect(provider.transcribe(fixtureFile)).resolves.toEqual({
      detectedLanguage: "Malay",
      originalTranscript: "Saya mahu buat temujanji.",
      englishGloss: "I would like to make an appointment.",
      model: "scribe_v2",
    });
    const request = fetcher.mock.calls[0]?.[1];
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.elevenlabs.io/v1/speech-to-text",
      expect.objectContaining({ method: "POST", headers: { "xi-api-key": "eleven-test-key" } }),
    );
    expect(request?.body).toBeInstanceOf(FormData);
    const form = request?.body as FormData;
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(translate).toHaveBeenCalledWith(
      expect.objectContaining({ sourceLanguage: "Malay", targetLanguage: "English" }),
      undefined,
    );
  });

  it("does not translate an English Scribe v2 result and reports provider failures clearly", async () => {
    const translate = vi.fn();
    const provider = createElevenLabsSpeechProvider({
      config: readElevenLabsSpeechConfig(environment),
      fetcher: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ language_code: "en", text: "I need an appointment." })),
      ),
      translation: { translate },
    });
    await expect(provider.transcribe(fixtureFile)).resolves.toMatchObject({
      detectedLanguage: "English",
      englishGloss: null,
    });
    expect(translate).not.toHaveBeenCalled();

    const failing = createElevenLabsSpeechProvider({
      config: readElevenLabsSpeechConfig(environment),
      fetcher: vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })),
    });
    await expect(failing.transcribe(fixtureFile)).rejects.toBeInstanceOf(
      ElevenLabsSpeechProviderError,
    );

    const timedOut = createElevenLabsSpeechProvider({
      config: readElevenLabsSpeechConfig(environment),
      fetcher: vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" })),
    });
    await expect(timedOut.transcribe(fixtureFile)).rejects.toMatchObject({
      code: "provider_timeout",
    });
  });

  it("synthesizes bytes with only the configured voice controls and rejects empty audio", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    const provider = createElevenLabsTtsProvider({
      config: readElevenLabsTtsConfig({
        ...environment,
        ELEVENLABS_TTS_SPEED: "1.1",
      }),
      fetcher,
    });

    await expect(provider.synthesize("Temujanji anda disahkan.", { targetLanguage: "Malay" })).resolves.toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      model: "eleven_v3",
      voice: "voice-demo-1",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.elevenlabs.io/v1/text-to-speech/voice-demo-1/stream",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toEqual({
      text: "Temujanji anda disahkan.",
      model_id: "eleven_v3",
      language_code: "ms",
      voice_settings: { speed: 1.1 },
    });

    const empty = createElevenLabsTtsProvider({
      config: readElevenLabsTtsConfig(environment),
      fetcher: vi.fn().mockResolvedValue(new Response(new Uint8Array())),
    });
    await expect(empty.synthesize("Hello")).rejects.toBeInstanceOf(TtsProviderError);

    const timedOut = createElevenLabsTtsProvider({
      config: readElevenLabsTtsConfig(environment),
      fetcher: vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" })),
    });
    await expect(timedOut.synthesize("Hello")).rejects.toMatchObject({ code: "provider_timeout" });
  });
});
