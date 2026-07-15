import { describe, expect, it } from "vitest";

import {
  inboundSpeechArtifactSchema,
  inboundTranscriptionRequestSchema,
  inboundTranscriptionResultSchema,
} from "../../src/contracts/speech";

const pendingArtifact = {
  messageId: "telegram-message:-10042:89",
  telegramFileId: "telegram-voice-file-1",
  status: "pending",
  detectedLanguage: null,
  originalTranscript: null,
  englishGloss: null,
  model: null,
  error: null,
} as const;

const readyArtifact = {
  ...pendingArtifact,
  status: "ready",
  detectedLanguage: "Malay",
  originalTranscript: "Boleh saya buat temujanji?",
  englishGloss: "Can I make an appointment?",
  model: "gpt-4o-transcribe",
} as const;

describe("inbound speech contracts", () => {
  it("validates pending, transcribing, ready, and failed artifact states", () => {
    expect(
      inboundSpeechArtifactSchema.parse(pendingArtifact),
    ).toEqual(pendingArtifact);
    expect(
      inboundSpeechArtifactSchema.safeParse({
        ...pendingArtifact,
        status: "transcribing",
        model: "gpt-4o-transcribe",
      }).success,
    ).toBe(true);
    expect(
      inboundSpeechArtifactSchema.parse(readyArtifact),
    ).toEqual(readyArtifact);
    expect(
      inboundSpeechArtifactSchema.safeParse({
        ...pendingArtifact,
        status: "failed",
        error: "Telegram media download failed.",
      }).success,
    ).toBe(true);
  });

  it("rejects impossible artifact field combinations", () => {
    expect(
      inboundSpeechArtifactSchema.safeParse({
        ...pendingArtifact,
        originalTranscript: "Unexpected transcript",
      }).success,
    ).toBe(false);
    expect(
      inboundSpeechArtifactSchema.safeParse({
        ...pendingArtifact,
        status: "transcribing",
      }).success,
    ).toBe(false);
    expect(
      inboundSpeechArtifactSchema.safeParse({
        ...readyArtifact,
        originalTranscript: null,
      }).success,
    ).toBe(false);
    expect(
      inboundSpeechArtifactSchema.safeParse({
        ...readyArtifact,
        error: "Ready artifacts cannot have errors.",
      }).success,
    ).toBe(false);
    expect(
      inboundSpeechArtifactSchema.safeParse({
        ...readyArtifact,
        englishGloss: null,
      }).success,
    ).toBe(false);
    expect(
      inboundSpeechArtifactSchema.safeParse({
        ...readyArtifact,
        detectedLanguage: "English",
        originalTranscript: "Can I make an appointment?",
        englishGloss: null,
      }).success,
    ).toBe(true);
    expect(
      inboundSpeechArtifactSchema.safeParse({
        ...pendingArtifact,
        status: "failed",
      }).success,
    ).toBe(false);
  });

  it("validates revisioned transcription requests and ready results", () => {
    const request = {
      expectedWorkspaceRevision: 3,
    };
    const result = {
      messageId: pendingArtifact.messageId,
      workspaceRevision: 4,
      conversationRevision: 2,
      artifact: readyArtifact,
    };

    expect(
      inboundTranscriptionRequestSchema.parse(request),
    ).toEqual(request);
    expect(
      inboundTranscriptionResultSchema.parse(result),
    ).toEqual(result);
    expect(
      inboundTranscriptionRequestSchema.safeParse({
        expectedWorkspaceRevision: 0,
      }).success,
    ).toBe(false);
    expect(
      inboundTranscriptionResultSchema.safeParse({
        ...result,
        artifact: pendingArtifact,
      }).success,
    ).toBe(false);
    expect(
      inboundTranscriptionResultSchema.safeParse({
        ...result,
        messageId: "different-message",
      }).success,
    ).toBe(false);
    expect(
      inboundTranscriptionRequestSchema.safeParse({
        ...request,
        telegramFileId: "browser-controlled-file-id",
      }).success,
    ).toBe(false);
  });
});
