import { z } from "zod";

import { revisionSchema } from "./domain-primitives";

const speechIdSchema = z.string().trim().min(1).max(512);
const speechTextSchema = z.string().trim().min(1).max(4096);
const languageSchema = z.string().trim().min(1).max(64);
const modelSchema = z.string().trim().min(1).max(256);

const speechArtifactIdentitySchema = z.object({
  messageId: speechIdSchema,
  telegramFileId: speechIdSchema,
});

export const pendingInboundSpeechArtifactSchema =
  speechArtifactIdentitySchema
    .extend({
      status: z.literal("pending"),
      detectedLanguage: z.null(),
      originalTranscript: z.null(),
      englishGloss: z.null(),
      model: z.null(),
      error: z.null(),
    })
    .strict();

export const transcribingInboundSpeechArtifactSchema =
  speechArtifactIdentitySchema
    .extend({
      status: z.literal("transcribing"),
      detectedLanguage: z.null(),
      originalTranscript: z.null(),
      englishGloss: z.null(),
      model: modelSchema,
      error: z.null(),
    })
    .strict();

export const readyInboundSpeechArtifactSchema =
  speechArtifactIdentitySchema
    .extend({
      status: z.literal("ready"),
      detectedLanguage: languageSchema,
      originalTranscript: speechTextSchema,
      englishGloss: speechTextSchema.nullable(),
      model: modelSchema,
      error: z.null(),
    })
    .strict()
    .superRefine((artifact, context) => {
      const language = artifact.detectedLanguage
        .trim()
        .toLowerCase();
      if (
        language !== "english" &&
        language !== "en" &&
        artifact.englishGloss === null
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Non-English speech requires a separate English gloss",
          path: ["englishGloss"],
        });
      }
    });

export const failedInboundSpeechArtifactSchema =
  speechArtifactIdentitySchema
    .extend({
      status: z.literal("failed"),
      detectedLanguage: languageSchema.nullable(),
      originalTranscript: speechTextSchema.nullable(),
      englishGloss: speechTextSchema.nullable(),
      model: modelSchema.nullable(),
      error: z.string().trim().min(1).max(1000),
    })
    .strict();

export const inboundSpeechArtifactSchema = z.discriminatedUnion(
  "status",
  [
    pendingInboundSpeechArtifactSchema,
    transcribingInboundSpeechArtifactSchema,
    readyInboundSpeechArtifactSchema,
    failedInboundSpeechArtifactSchema,
  ],
);

export const inboundTranscriptionRequestSchema = z
  .object({
    expectedWorkspaceRevision: revisionSchema,
  })
  .strict();

export const inboundTranscriptionResultSchema = z
  .object({
    messageId: speechIdSchema,
    workspaceRevision: revisionSchema,
    conversationRevision: revisionSchema,
    artifact: readyInboundSpeechArtifactSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (result.messageId !== result.artifact.messageId) {
      context.addIssue({
        code: "custom",
        message:
          "Transcription result must reference the returned speech artifact",
        path: ["artifact", "messageId"],
      });
    }
  });

export type InboundSpeechArtifact = z.infer<
  typeof inboundSpeechArtifactSchema
>;
export type ReadyInboundSpeechArtifact = z.infer<
  typeof readyInboundSpeechArtifactSchema
>;
export type InboundTranscriptionRequest = z.infer<
  typeof inboundTranscriptionRequestSchema
>;
export type InboundTranscriptionResult = z.infer<
  typeof inboundTranscriptionResultSchema
>;
