import { describe, expect, it, vi } from "vitest";

import { createCanonicalServerState, mergeTelegramInboundVoice } from "../../src/domain";
import { createInboundSpeechService } from "../../server/inbound-speech-service";
import { createWorkspaceRepository } from "../../server/workspace-repository";
import { InMemoryWorkspaceDataSource } from "./fixtures/workspace-data-source";

async function setup() {
  const repository = createWorkspaceRepository(new InMemoryWorkspaceDataSource());
  const seed = mergeTelegramInboundVoice(await createCanonicalServerState(), {
    channel: "telegram",
    externalEventId: "1002",
    externalConversationId: "-10042",
    externalMessageId: "89",
    sender: { externalId: "42", displayName: "Aina Zulkifli" },
    message: { kind: "voice", telegramFileId: "voice-1", language: "ms" },
    receivedAt: "2026-07-13T12:00:00.000Z",
  });
  if (!seed.ok) {
    throw new Error(seed.error);
  }
  await repository.bootstrap("demo", seed.state);
  const cleanup = vi.fn().mockResolvedValue(undefined);
  return { cleanup, repository };
}

describe("inbound speech service", () => {
  it("prioritizes a newly received voice note over retrying an older failed one", async () => {
    const { cleanup, repository } = await setup();
    const initial = await repository.load("demo");
    expect(initial).not.toBeNull();
    if (!initial) {
      return;
    }
    const firstArtifact = initial.state.speechArtifacts[0]!;
    const retryState = structuredClone(initial.state);
    retryState.speechArtifacts[0] = {
      ...firstArtifact,
      status: "failed",
      detectedLanguage: null,
      originalTranscript: null,
      englishGloss: null,
      model: "whisper-1",
      error: "Retry later",
    };
    const second = mergeTelegramInboundVoice(retryState, {
      channel: "telegram",
      externalEventId: "1003",
      externalConversationId: "-10042",
      externalMessageId: "90",
      sender: { externalId: "42", displayName: "Aina Zulkifli" },
      message: { kind: "voice", telegramFileId: "voice-2", language: "ms" },
      receivedAt: "2026-07-13T12:01:00.000Z",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    await repository.save("demo", initial.revision, second.state);
    const downloadVoice = vi.fn().mockResolvedValue(new Uint8Array([1]));
    const service = createInboundSpeechService({
      workspaceId: "demo",
      workspaceRepository: repository,
      voiceDownloader: { downloadVoice },
      converter: {
        convertToWebm: vi.fn().mockResolvedValue({
          filePath: "C:/tmp/inbound.webm",
          cleanup,
        }),
        convertToOgg: vi.fn(),
      },
      speechProvider: {
        transcribe: vi.fn().mockResolvedValue({
          detectedLanguage: "Malay",
          originalTranscript: "Mesej baharu.",
          englishGloss: "New message.",
          model: "whisper-1",
        }),
      },
    });

    await expect(service.transcribeNext()).resolves.toMatchObject({ status: "ready" });
    expect(downloadVoice).toHaveBeenCalledWith("voice-2", undefined);
  });

  it("downloads, converts, transcribes, and atomically publishes a staff-visible gloss", async () => {
    const { cleanup, repository } = await setup();
    const service = createInboundSpeechService({
      workspaceId: "demo",
      workspaceRepository: repository,
      voiceDownloader: { downloadVoice: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])) },
      converter: {
        convertToWebm: vi.fn().mockResolvedValue({
          filePath: "C:/tmp/inbound.webm",
          cleanup,
        }),
        convertToOgg: vi.fn(),
      },
      speechProvider: {
        transcribe: vi.fn().mockResolvedValue({
          detectedLanguage: "Malay",
          originalTranscript: "Saya mahu buat temujanji.",
          englishGloss: "I would like to make an appointment.",
          model: "whisper-1",
        }),
      },
    });

    await expect(service.transcribeNext()).resolves.toMatchObject({
      status: "ready",
      result: {
        artifact: expect.objectContaining({ status: "ready", model: "whisper-1" }),
      },
    });
    const workspace = await repository.load("demo");
    expect(workspace?.state.conversations[0]?.messages.at(-1)).toEqual(
      expect.objectContaining({
        text: "Saya mahu buat temujanji.",
        gloss: "I would like to make an appointment.",
      }),
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("persists a retryable failed artifact when speech processing fails", async () => {
    const { cleanup, repository } = await setup();
    const service = createInboundSpeechService({
      workspaceId: "demo",
      workspaceRepository: repository,
      voiceDownloader: { downloadVoice: vi.fn().mockResolvedValue(new Uint8Array([1])) },
      converter: {
        convertToWebm: vi.fn().mockResolvedValue({
          filePath: "C:/tmp/inbound.webm",
          cleanup,
        }),
        convertToOgg: vi.fn(),
      },
      speechProvider: { transcribe: vi.fn().mockRejectedValue(new Error("provider unavailable")) },
    });

    await expect(service.transcribeNext()).resolves.toEqual({ status: "failed" });
    expect((await repository.load("demo"))?.state.speechArtifacts[0]).toEqual(
      expect.objectContaining({ status: "failed", model: "whisper-1" }),
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
