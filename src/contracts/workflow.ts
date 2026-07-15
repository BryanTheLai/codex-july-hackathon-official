import { z } from "zod";

import { datasetSchema, revisionSchema } from "./app-state";
import { workspaceEnvelopeSchema } from "./api";

const idSchema = z.string().trim().min(1).max(200);
// Express caps JSON bodies at 64 KiB. Keep this well below that limit even for
// four-byte UTF-8 characters and the surrounding JSON envelope.
const markdownSchema = z.string().min(1).max(12_000);
const editorFileSchema = z.object({
  id: idSchema,
  path: z.string().trim().min(1).max(512),
  title: z.string().trim().min(1).max(300),
  content: z.string().max(12_000),
}).strict();

const commandBase = {
  expectedWorkspaceRevision: revisionSchema,
};

export const workspaceCommandRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    ...commandBase,
    kind: z.literal("create_candidate_from_correction"),
    correctionId: idSchema,
  }).strict(),
  z.object({
    ...commandBase,
    kind: z.literal("create_candidate_from_draft"),
    fileId: idSchema,
    content: markdownSchema,
  }).strict(),
  z.object({
    ...commandBase,
    kind: z.literal("create_candidate_from_file"),
    file: editorFileSchema,
  }).strict(),
  z.object({
    ...commandBase,
    kind: z.literal("create_candidate_from_file_deletion"),
    fileId: idSchema,
  }).strict(),
  z.object({
    ...commandBase,
    kind: z.literal("import_markdown"),
    path: z.string().trim().min(1).max(512),
    title: z.string().trim().min(1).max(300),
    content: markdownSchema,
  }).strict(),
  z.object({
    ...commandBase,
    kind: z.literal("sync_eval_dataset"),
    dataset: datasetSchema,
  }).strict(),
  z.object({
    ...commandBase,
    kind: z.literal("propose_correction"),
    datasetId: idSchema,
  }).strict(),
  z.object({
    ...commandBase,
    kind: z.literal("replay_candidate"),
    candidateVersionId: idSchema,
    datasetId: idSchema,
    scope: z.enum(["affected", "full"]),
  }).strict(),
  z.object({
    ...commandBase,
    kind: z.literal("activate_candidate"),
    candidateVersionId: idSchema,
  }).strict(),
  z.object({
    ...commandBase,
    kind: z.literal("discard_candidate"),
    candidateVersionId: idSchema,
  }).strict(),
  z.object({
    ...commandBase,
    kind: z.literal("rollback_playbook"),
  }).strict(),
]);

export const workspaceCommandResultSchema = z.object({
  workspace: workspaceEnvelopeSchema,
  replay: z.object({
    suiteId: idSchema,
    scope: z.enum(["affected", "full"]),
    beforeFailedCases: z.number().int().nonnegative(),
    passedCases: z.number().int().nonnegative(),
    totalCases: z.number().int().positive(),
    passed: z.boolean(),
    ready: z.boolean(),
  }).strict().nullable(),
}).strict();

export type WorkspaceCommandRequest = z.infer<typeof workspaceCommandRequestSchema>;
export type WorkspaceCommandResult = z.infer<typeof workspaceCommandResultSchema>;
