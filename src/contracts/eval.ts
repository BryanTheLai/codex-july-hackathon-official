import { z } from "zod";

import {
  DEMO_TOOL_POLICY_VERSION,
  agentRunResultSchema,
} from "./agent";
import { EVAL_SPLITS } from "./constants";
import {
  bookingSchema,
  evalCaseSourceSchema,
  evalCaseTypeSchema,
  messageSchema,
  revisionSchema,
} from "./domain-primitives";
import { judgeResponseSchema } from "./judge";

const idSchema = z.string().trim().min(1).max(200);
const textSchema = z.string().trim().min(1).max(8_000);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const timestampSchema = z.iso.datetime({ offset: true });

export const evalPlaybookVersionRefSchema = z
  .object({
    fileId: idSchema,
    versionId: idSchema,
    contentHash: hashSchema,
  })
  .strict();

function requireUniqueIds(
  values: string[],
  path: PropertyKey[],
  context: z.RefinementCtx,
  message: string,
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({
      code: "custom",
      message,
      path,
    });
  }
}

const playbookVersionRefsSchema = z
  .array(evalPlaybookVersionRefSchema)
  .min(1)
  .max(50)
  .superRefine((versions, context) => {
    requireUniqueIds(
      versions.map((version) => version.fileId),
      [],
      context,
      "Playbook file identifiers must be unique",
    );
  });

export const evalGenerationCaseSchema = z
  .object({
    messages: z
      .array(
        messageSchema
          .extend({
            id: idSchema,
            text: textSchema,
          })
          .strict(),
      )
      .min(1)
      .max(50),
    patientContext: z
      .object({
        preferredLanguage: z.string().trim().min(1).max(100),
      })
      .strict(),
    bookingContext: bookingSchema.strict().nullable(),
    playbookVersions: playbookVersionRefsSchema,
    agentConfigVersion: idSchema,
    promptVersion: idSchema,
    toolPolicyVersion: z.literal(DEMO_TOOL_POLICY_VERSION),
  })
  .strict();

export const evalJudgeBundleSchema = z
  .object({
    expectedStaffResponse: textSchema,
    rubricRefs: z
      .array(
        z
          .object({
            id: idSchema,
            version: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((bundle, context) => {
    requireUniqueIds(
      bundle.rubricRefs.map((rubric) => rubric.id),
      ["rubricRefs"],
      context,
      "Rubric identifiers must be unique",
    );
  });

export const demoEvalCaseSchema = z
  .object({
    id: idSchema,
    title: z.string().trim().min(1).max(300),
    split: z.enum(EVAL_SPLITS),
    type: evalCaseTypeSchema,
    language: z.string().trim().min(1).max(100),
    generationCase: evalGenerationCaseSchema,
    judgeBundle: evalJudgeBundleSchema,
    source: evalCaseSourceSchema,
  })
  .strict();

export const evalRubricSnapshotSchema = z
  .object({
    id: idSchema,
    label: z.string().trim().min(1).max(200),
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
  .strict();

export const evalPlaybookBundleSnapshotSchema = z
  .object({
    versionId: idSchema,
    bundleHash: hashSchema,
    versions: playbookVersionRefsSchema,
  })
  .strict();

export const evalAgentConfigSnapshotSchema = z
  .object({
    modelId: idSchema,
    apiMode: z.enum(["responses", "chat_completions"]),
    agentConfigVersion: idSchema,
    promptVersion: idSchema,
    toolPolicyVersion: z.literal(DEMO_TOOL_POLICY_VERSION),
  })
  .strict();

export const evalJudgeConfigSnapshotSchema = z
  .object({
    modelId: idSchema,
    promptVersion: idSchema,
  })
  .strict();

export const evalSuiteSnapshotSchema = z
  .object({
    id: idSchema,
    datasetId: idSchema,
    cases: z.array(demoEvalCaseSchema).min(1).max(100),
    rubrics: z.array(evalRubricSnapshotSchema).min(1).max(50),
    playbookBundle: evalPlaybookBundleSnapshotSchema,
    agentConfig: evalAgentConfigSnapshotSchema,
    judgeConfig: evalJudgeConfigSnapshotSchema,
    manifestHash: hashSchema,
    baselineSuiteId: idSchema.nullable(),
    createdAt: timestampSchema,
  })
  .strict()
  .superRefine((suite, context) => {
    requireUniqueIds(
      suite.cases.map((evalCase) => evalCase.id),
      ["cases"],
      context,
      "Eval case identifiers must be unique",
    );
    requireUniqueIds(
      suite.rubrics.map((rubric) => rubric.id),
      ["rubrics"],
      context,
      "Rubric identifiers must be unique",
    );

    const rubricVersions = new Map(
      suite.rubrics.map((rubric) => [
        rubric.id,
        rubric.version,
      ]),
    );
    const playbookVersions = new Map(
      suite.playbookBundle.versions.map((version) => [
        version.fileId,
        version,
      ]),
    );
    suite.cases.forEach((evalCase, caseIndex) => {
      evalCase.judgeBundle.rubricRefs.forEach((rubric, index) => {
        if (rubricVersions.get(rubric.id) !== rubric.version) {
          context.addIssue({
            code: "custom",
            message:
              "Eval case rubric reference is not frozen in the suite",
            path: [
              "cases",
              caseIndex,
              "judgeBundle",
              "rubricRefs",
              index,
            ],
          });
        }
      });
      evalCase.generationCase.playbookVersions.forEach(
        (version, index) => {
          const frozen = playbookVersions.get(version.fileId);
          if (
            !frozen ||
            frozen.versionId !== version.versionId ||
            frozen.contentHash !== version.contentHash
          ) {
            context.addIssue({
              code: "custom",
              message:
                "Eval case playbook reference is not frozen in the suite",
              path: [
                "cases",
                caseIndex,
                "generationCase",
                "playbookVersions",
                index,
              ],
            });
          }
        },
      );
      if (
        evalCase.generationCase.agentConfigVersion !==
          suite.agentConfig.agentConfigVersion ||
        evalCase.generationCase.promptVersion !==
          suite.agentConfig.promptVersion ||
        evalCase.generationCase.toolPolicyVersion !==
          suite.agentConfig.toolPolicyVersion
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Eval case agent pins do not match the suite snapshot",
          path: ["cases", caseIndex, "generationCase"],
        });
      }
    });
  });

export const evalRunArtifactSchema = z
  .object({
    id: idSchema,
    suiteId: idSchema,
    caseId: idSchema,
    attempt: z.number().int().positive(),
    candidateResponse: textSchema,
    agentResult: agentRunResultSchema,
    judgeResult: judgeResponseSchema,
    ranAt: timestampSchema,
  })
  .strict();

export const reviewResolutionSchema = z
  .object({
    evalRunId: idSchema,
    verdict: z.enum(["pass", "fail"]),
    note: z.string().trim().min(1).max(2_000),
    resolvedAt: timestampSchema,
  })
  .strict();

export const evalSuiteCreateRequestSchema = z
  .object({
    datasetId: idSchema,
    caseIds: z.array(idSchema).min(1).max(100),
    playbookVersionId: idSchema,
    expectedWorkspaceRevision: revisionSchema,
  })
  .strict()
  .superRefine((request, context) => {
    requireUniqueIds(
      request.caseIds,
      ["caseIds"],
      context,
      "Eval case identifiers must be unique",
    );
  });

export const evalSuiteCreateResultSchema = z
  .object({
    suiteId: idSchema,
    manifestHash: hashSchema,
    workspaceRevision: revisionSchema,
  })
  .strict();

export const evalCaseRunRequestSchema = z
  .object({
    suiteId: idSchema,
    caseId: idSchema,
    expectedWorkspaceRevision: revisionSchema,
  })
  .strict();

export const evalCaseRunResultSchema = z
  .object({
    suiteId: idSchema,
    caseId: idSchema,
    attempt: z.number().int().positive(),
    status: z.enum(["committed", "failed"]),
    evalRunId: idSchema,
    workspaceRevision: revisionSchema,
  })
  .strict();

export const reviewResolutionRequestSchema =
  reviewResolutionSchema.pick({
    verdict: true,
    note: true,
  });

export const evalArtifactStateSchema = z
  .object({
    suites: z.array(evalSuiteSnapshotSchema),
    runs: z.array(evalRunArtifactSchema),
    resolutions: z.array(reviewResolutionSchema),
  })
  .strict()
  .superRefine((state, context) => {
    requireUniqueIds(
      state.suites.map((suite) => suite.id),
      ["suites"],
      context,
      "Suite identifiers must be unique",
    );
    requireUniqueIds(
      state.runs.map((run) => run.id),
      ["runs"],
      context,
      "Eval run identifiers must be unique",
    );
    requireUniqueIds(
      state.resolutions.map((resolution) => resolution.evalRunId),
      ["resolutions"],
      context,
      "Eval runs can have at most one review resolution",
    );
    const suites = new Map(
      state.suites.map((suite) => [suite.id, suite]),
    );
    const runs = new Set(state.runs.map((run) => run.id));
    const attemptKeys = new Set<string>();
    state.runs.forEach((run, index) => {
      const suite = suites.get(run.suiteId);
      if (
        !suite ||
        !suite.cases.some(
          (evalCase) => evalCase.id === run.caseId,
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Eval run does not reference a frozen suite case",
          path: ["runs", index],
        });
      }
      const attemptKey = `${run.suiteId}\u0000${run.caseId}\u0000${run.attempt}`;
      if (attemptKeys.has(attemptKey)) {
        context.addIssue({
          code: "custom",
          message:
            "Eval run attempt must be unique per suite case",
          path: ["runs", index, "attempt"],
        });
      }
      attemptKeys.add(attemptKey);
    });
    state.resolutions.forEach((resolution, index) => {
      if (!runs.has(resolution.evalRunId)) {
        context.addIssue({
          code: "custom",
          message:
            "Review resolution does not reference an Eval run",
          path: ["resolutions", index, "evalRunId"],
        });
      }
    });
  });

export type DemoEvalCase = z.infer<typeof demoEvalCaseSchema>;
export type EvalSuiteSnapshot = z.infer<
  typeof evalSuiteSnapshotSchema
>;
export type EvalRunArtifact = z.infer<
  typeof evalRunArtifactSchema
>;
export type EvalArtifactState = z.infer<
  typeof evalArtifactStateSchema
>;
export type EvalSuiteCreateRequest = z.infer<
  typeof evalSuiteCreateRequestSchema
>;
export type EvalCaseRunRequest = z.infer<
  typeof evalCaseRunRequestSchema
>;
export type EvalSuiteCreateResult = z.infer<
  typeof evalSuiteCreateResultSchema
>;
export type EvalCaseRunResult = z.infer<
  typeof evalCaseRunResultSchema
>;
