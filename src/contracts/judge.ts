import { z } from "zod";

import {
  CRITERION_VERDICTS,
  EVAL_CASE_TYPES,
  EVAL_VERDICTS,
  MESSAGE_ROLES,
} from "./constants";

const idSchema = z.string().min(1).max(200);
const textSchema = z.string().min(1).max(8_000);

export const judgeRequestSchema = z
  .object({
    runId: idSchema,
    datasetId: idSchema,
    caseId: idSchema,
    caseType: z.enum(EVAL_CASE_TYPES),
    language: z.string().min(1).max(100),
    candidateVersion: z.number().int().positive(),
    conversation: z
      .array(
        z
          .object({
            role: z.enum(MESSAGE_ROLES),
            text: textSchema,
            gloss: z.string().max(8_000).optional(),
            language: z.string().max(100).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    candidateResponse: textSchema,
    expectedResponse: textSchema,
    rubrics: z
      .array(
        z
          .object({
            id: idSchema,
            label: z.string().min(1).max(200),
            instruction: textSchema,
            required: z.boolean(),
            examples: z
              .object({
                good: z.string().max(8_000).optional(),
                bad: z.string().max(8_000).optional(),
              })
              .strict()
              .optional(),
            version: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((request, context) => {
    const ids = request.rubrics.map((rubric) => rubric.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Rubric identifiers must be unique",
        path: ["rubrics"],
      });
    }
  });

export const judgeCriterionResultSchema = z
  .object({
    criterionId: idSchema,
    verdict: z.enum(CRITERION_VERDICTS),
    reason: z.string().min(1).max(1_000),
    evidence: z.string().min(1).max(2_000).nullable(),
  })
  .strict();

export const judgeMetadataSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    promptVersion: z.string().min(1),
    rubricVersions: z.record(z.string(), z.number().int().positive()),
    runId: idSchema,
    latencyMs: z.number().nonnegative(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
    costUsd: z.number().nonnegative().optional(),
    simulated: z.boolean(),
  })
  .strict();

export const judgeScoreSchema = z.number().min(0).max(1);
export const judgeRationaleSchema = z.string().min(1).max(2_000);

export const providerJudgeResultSchema = z
  .object({
    score: judgeScoreSchema,
    rationale: judgeRationaleSchema,
    criterionResults: z.array(judgeCriterionResultSchema).min(1).max(20),
  })
  .strict();

export const judgeResponseSchema = providerJudgeResultSchema
  .omit({ score: true })
  .extend({
    overallVerdict: z.enum(EVAL_VERDICTS),
    judgeScore: judgeScoreSchema,
    metadata: judgeMetadataSchema,
  })
  .strict();

export type JudgeRequest = z.infer<typeof judgeRequestSchema>;
export type ProviderJudgeResult = z.infer<typeof providerJudgeResultSchema>;
export type JudgeResponse = z.infer<typeof judgeResponseSchema>;

export interface JudgeClient {
  judge(request: JudgeRequest, signal?: AbortSignal): Promise<JudgeResponse>;
}
