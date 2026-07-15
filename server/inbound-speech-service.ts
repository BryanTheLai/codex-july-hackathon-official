import type {
  InboundTranscriptionResult,
} from "../src/contracts/speech";
import type { ServerDomainStatePayload } from "../src/contracts/app-state";
import {
  TelegramSpeechDomainError,
  beginTelegramSpeechTranscription,
  completeTelegramSpeechManualTranscription,
  completeTelegramSpeechTranscription,
  failTelegramSpeechTranscription,
} from "../src/domain";
import type { WorkspaceRepository } from "./workspace-repository";
import type { SpeechProvider } from "./openai-speech-provider";
import type { TelegramVoiceDownloader } from "./telegram-adapter";
import type { VoiceConverter } from "./voice-converter";

export type InboundSpeechAttempt =
  | { status: "idle" }
  | { status: "ready"; result: InboundTranscriptionResult }
  | { status: "failed" };

export interface InboundSpeechService {
  transcribeNext(signal?: AbortSignal): Promise<InboundSpeechAttempt>;
  retry(messageId: string, signal?: AbortSignal): Promise<InboundSpeechAttempt>;
  saveManualTranscript(
    messageId: string,
    input: {
      detectedLanguage: string;
      originalTranscript: string;
      englishGloss: string | null;
    },
  ): Promise<InboundTranscriptionResult>;
  downloadAudio(messageId: string, signal?: AbortSignal): Promise<Uint8Array>;
}

export class InboundSpeechServiceError extends Error {
  readonly code: "not_found" | "provider_failed" | "revision_conflict";

  constructor(code: InboundSpeechServiceError["code"], message: string) {
    super(message);
    this.name = "InboundSpeechServiceError";
    this.code = code;
  }
}

type InboundSpeechServiceOptions = {
  workspaceId: string;
  workspaceRepository: WorkspaceRepository;
  voiceDownloader: TelegramVoiceDownloader;
  converter: VoiceConverter;
  speechProvider: SpeechProvider;
  maxCasAttempts?: number;
};

type ClaimedSpeech = {
  messageId: string;
  model: string;
  telegramFileId: string;
};

function pendingArtifact(
  state: Parameters<typeof beginTelegramSpeechTranscription>[0]["state"],
) {
  return state.speechArtifacts.find((artifact) => artifact.status === "pending");
}

function genericFailureMessage(): string {
  return "Speech transcription failed. Refresh the Telegram inbox and retry the voice note.";
}

export function createInboundSpeechService({
  workspaceId,
  workspaceRepository,
  voiceDownloader,
  converter,
  speechProvider,
  maxCasAttempts = 3,
}: InboundSpeechServiceOptions): InboundSpeechService {
  const attempts = Math.max(1, Math.min(10, Math.floor(maxCasAttempts)));

  async function claim(
    messageId?: string,
  ): Promise<ClaimedSpeech | null> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const workspace = await workspaceRepository.load(workspaceId);
      if (!workspace) {
        throw new InboundSpeechServiceError("not_found", "Workspace not found");
      }
      const artifact = messageId
        ? workspace.state.speechArtifacts.find(
            (candidate) => candidate.messageId === messageId,
          )
        : pendingArtifact(workspace.state);
      if (!artifact) {
        return null;
      }
      if (messageId && artifact.status === "ready") {
        throw new InboundSpeechServiceError(
          "revision_conflict",
          "Speech artifact already has a transcript",
        );
      }
      const model = "whisper-1";
      let next;
      try {
        next = beginTelegramSpeechTranscription({
          state: workspace.state,
          messageId: artifact.messageId,
          model,
        });
      } catch (error) {
        if (error instanceof TelegramSpeechDomainError) {
          continue;
        }
        throw error;
      }
      const saved = await workspaceRepository.save(
        workspaceId,
        workspace.revision,
        next,
      );
      if (saved.ok) {
        return {
          messageId: artifact.messageId,
          model,
          telegramFileId: artifact.telegramFileId,
        };
      }
    }
    throw new InboundSpeechServiceError(
      "revision_conflict",
      "Workspace changed while claiming speech transcription",
    );
  }

  async function persist(
    messageId: string,
    mutator: (state: ServerDomainStatePayload) => ServerDomainStatePayload,
  ) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const workspace = await workspaceRepository.load(workspaceId);
      if (!workspace) {
        throw new InboundSpeechServiceError("not_found", "Workspace not found");
      }
      const artifact = workspace.state.speechArtifacts.find(
        (candidate) => candidate.messageId === messageId,
      );
      if (!artifact) {
        throw new InboundSpeechServiceError("not_found", "Speech artifact not found");
      }
      if (artifact.status !== "transcribing") {
        throw new InboundSpeechServiceError(
          "revision_conflict",
          "Speech artifact changed during transcription",
        );
      }
      try {
        const state = mutator(workspace.state);
        const saved = await workspaceRepository.save(
          workspaceId,
          workspace.revision,
          state,
        );
        if (saved.ok) {
          return saved.workspace;
        }
      } catch (error) {
        if (!(error instanceof TelegramSpeechDomainError)) {
          throw error;
        }
      }
    }
    throw new InboundSpeechServiceError(
      "revision_conflict",
      "Workspace changed while saving speech transcription",
    );
  }

  async function transcribe(
    messageId?: string,
    signal?: AbortSignal,
  ): Promise<InboundSpeechAttempt> {
    const claimed = await claim(messageId);
    if (!claimed) {
      return { status: "idle" };
    }
    let converted: Awaited<ReturnType<VoiceConverter["convertToWebm"]>> | null = null;
    try {
      const input = await voiceDownloader.downloadVoice(
        claimed.telegramFileId,
        signal,
      );
      converted = await converter.convertToWebm(input, signal);
      const result = await speechProvider.transcribe(converted.filePath, signal);
      const workspace = await persist(
        claimed.messageId,
        (state) => completeTelegramSpeechTranscription({
          state,
          messageId: claimed.messageId,
          model: result.model,
          detectedLanguage: result.detectedLanguage,
          originalTranscript: result.originalTranscript,
          englishGloss: result.englishGloss,
        }),
      );
      const artifact = workspace.state.speechArtifacts.find(
        (candidate) => candidate.messageId === claimed.messageId,
      );
      const conversation = workspace.state.conversations.find((candidate) =>
        candidate.messages.some((message) => message.id === claimed.messageId),
      );
      if (!artifact || artifact.status !== "ready" || !conversation) {
        throw new InboundSpeechServiceError(
          "provider_failed",
          "Speech result did not persist",
        );
      }
      return {
        status: "ready",
        result: {
          messageId: claimed.messageId,
          workspaceRevision: workspace.revision,
          conversationRevision: conversation.revision,
          artifact,
        },
      };
    } catch (error) {
      try {
        await persist(
          claimed.messageId,
          (state) => failTelegramSpeechTranscription({
            state,
            messageId: claimed.messageId,
            model: claimed.model,
            error: genericFailureMessage(),
          }),
        );
      } catch {
        // The original error is more useful to callers and the persisted retry state may be stale.
      }
      if (error instanceof InboundSpeechServiceError) {
        throw error;
      }
      return { status: "failed" };
    } finally {
      await converted?.cleanup();
    }
  }

  return {
    async transcribeNext(signal) {
      return transcribe(undefined, signal);
    },

    async retry(messageId, signal) {
      return transcribe(messageId, signal);
    },

    async saveManualTranscript(messageId, input) {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const workspace = await workspaceRepository.load(workspaceId);
        if (!workspace) {
          throw new InboundSpeechServiceError("not_found", "Workspace not found");
        }
        const artifact = workspace.state.speechArtifacts.find(
          (candidate) => candidate.messageId === messageId,
        );
        if (!artifact) {
          throw new InboundSpeechServiceError("not_found", "Speech artifact not found");
        }
        let state: ServerDomainStatePayload;
        try {
          state = completeTelegramSpeechManualTranscription({
            state: workspace.state,
            messageId,
            ...input,
          });
        } catch (error) {
          if (error instanceof TelegramSpeechDomainError) {
            throw new InboundSpeechServiceError("revision_conflict", error.message);
          }
          throw error;
        }
        const saved = await workspaceRepository.save(
          workspaceId,
          workspace.revision,
          state,
        );
        if (saved.ok) {
          const ready = saved.workspace.state.speechArtifacts.find(
            (candidate) => candidate.messageId === messageId,
          );
          const conversation = saved.workspace.state.conversations.find((candidate) =>
            candidate.messages.some((message) => message.id === messageId),
          );
          if (ready?.status === "ready" && conversation) {
            return {
              messageId,
              workspaceRevision: saved.workspace.revision,
              conversationRevision: conversation.revision,
              artifact: ready,
            };
          }
        }
      }
      throw new InboundSpeechServiceError(
        "revision_conflict",
        "Workspace changed while saving manual transcript",
      );
    },

    async downloadAudio(messageId, signal) {
      const workspace = await workspaceRepository.load(workspaceId);
      const artifact = workspace?.state.speechArtifacts.find(
        (candidate) => candidate.messageId === messageId,
      );
      if (!artifact) {
        throw new InboundSpeechServiceError("not_found", "Speech artifact not found");
      }
      return voiceDownloader.downloadVoice(artifact.telegramFileId, signal);
    },
  };
}
