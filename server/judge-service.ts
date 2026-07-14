import type { JudgeRequest, JudgeResponse } from "./judge-contract";
import {
  judgeRequestSchema,
  judgeResponseSchema,
  providerJudgeResultSchema,
} from "./judge-contract";
import {
  buildJudgeData,
  JUDGE_INSTRUCTIONS,
  JUDGE_JSON_SCHEMA,
  JUDGE_PROMPT_VERSION,
} from "./judge-prompt";

export type JudgeProviderCreateInput = {
  model: string;
  instructions: string;
  input: string;
  text: {
    format: {
      type: "json_schema";
      name: string;
      strict: true;
      schema: typeof JUDGE_JSON_SCHEMA;
    };
  };
};

export type JudgeProviderCreateOutput = {
  model?: string;
  output_text: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

export type CreateProviderResponse = (
  input: JudgeProviderCreateInput,
  signal?: AbortSignal,
) => Promise<JudgeProviderCreateOutput>;

type JudgeServiceOptions = {
  createResponse: CreateProviderResponse;
  model: string;
  now?: () => number;
};

function overallVerdict(
  request: JudgeRequest,
  criterionResults: JudgeResponse["criterionResults"],
): JudgeResponse["overallVerdict"] {
  const resultById = new Map(
    criterionResults.map((criterionResult) => [
      criterionResult.criterionId,
      criterionResult.verdict,
    ]),
  );
  if (
    request.rubrics.some(
      (rubric) => rubric.required && resultById.get(rubric.id) === "fail",
    )
  ) {
    return "fail";
  }
  if (
    request.rubrics.some(
      (rubric) => rubric.required && resultById.get(rubric.id) === "uncertain",
    )
  ) {
    return "needs_review";
  }
  return "pass";
}

function validateCriterionCoverage(
  request: JudgeRequest,
  criterionResults: JudgeResponse["criterionResults"],
): void {
  const expectedIds = request.rubrics.map((rubric) => rubric.id).sort();
  const resultIds = criterionResults.map((result) => result.criterionId).sort();
  if (
    expectedIds.length !== resultIds.length ||
    expectedIds.some((criterionId, index) => criterionId !== resultIds[index])
  ) {
    throw new Error("Judge must return exactly one result per rubric");
  }
}

function validateEvidenceQuotes(
  request: JudgeRequest,
  criterionResults: JudgeResponse["criterionResults"],
): void {
  for (const result of criterionResults) {
    if (result.evidence && !request.candidateResponse.includes(result.evidence)) {
      throw new Error(
        `Judge evidence quote is not present in candidate response: ${result.criterionId}`,
      );
    }
  }
}

export function createJudgeService({
  createResponse,
  model,
  now = Date.now,
}: JudgeServiceOptions) {
  return async (input: JudgeRequest, signal?: AbortSignal): Promise<JudgeResponse> => {
    const request = judgeRequestSchema.parse(input);
    const startedAt = now();
    const response = await createResponse(
      {
        model,
        instructions: JUDGE_INSTRUCTIONS,
        input: buildJudgeData(request),
        text: {
          format: {
            type: "json_schema",
            name: "kaunter_judge_result",
            strict: true,
            schema: JUDGE_JSON_SCHEMA,
          },
        },
      },
      signal,
    );
    const providerResult = providerJudgeResultSchema.parse(JSON.parse(response.output_text));
    validateCriterionCoverage(request, providerResult.criterionResults);
    validateEvidenceQuotes(request, providerResult.criterionResults);

    return judgeResponseSchema.parse({
      overallVerdict: overallVerdict(request, providerResult.criterionResults),
      judgeScore: providerResult.score,
      rationale: providerResult.rationale,
      criterionResults: providerResult.criterionResults,
      metadata: {
        provider: "openai",
        model: response.model ?? model,
        promptVersion: JUDGE_PROMPT_VERSION,
        rubricVersions: Object.fromEntries(
          request.rubrics.map((rubric) => [rubric.id, rubric.version]),
        ),
        runId: request.runId,
        latencyMs: Math.max(0, now() - startedAt),
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
        totalTokens: response.usage?.total_tokens,
        simulated: false,
      },
    });
  };
}
