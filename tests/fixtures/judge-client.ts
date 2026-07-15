import type { JudgeResponse } from "../../src/contracts/judge";
import type { JudgeClient } from "../../src/services/judge-client";

type FixtureJudgeOptions = {
  delayMs?: number;
  verdictByCase?: Record<string, JudgeResponse["overallVerdict"]>;
};

export function createFixtureJudgeClient(
  { delayMs = 0, verdictByCase = {} }: FixtureJudgeOptions = {},
): JudgeClient {
  return {
    async judge(request, signal) {
      if (delayMs > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(resolve, delayMs);
          signal?.addEventListener(
            "abort",
            () => {
              window.clearTimeout(timer);
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        });
      }
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const forcedVerdict = verdictByCase[request.caseId];
      const baselineRequiredFailure =
        request.caseType === "emergency_triage" && request.candidateVersion === 1;
      const overallVerdict =
        forcedVerdict ?? (baselineRequiredFailure ? "fail" : "pass");
      const requiredVerdict: JudgeResponse["criterionResults"][number]["verdict"] =
        overallVerdict === "needs_review"
          ? "uncertain"
          : overallVerdict === "fail"
            ? "fail"
            : "pass";
      const criterionResults: JudgeResponse["criterionResults"] = request.rubrics.map((rubric) => ({
        criterionId: rubric.id,
        verdict: rubric.required ? requiredVerdict : "pass",
        reason:
          overallVerdict === "needs_review"
            ? "Fixture requires human review."
            : overallVerdict === "fail" && rubric.required
              ? "Fixture required rubric failed at candidate version 1."
              : "Fixture rubric passed.",
        evidence: request.candidateResponse,
      }));
      const response: JudgeResponse = {
        overallVerdict,
        judgeScore:
          overallVerdict === "pass" ? 0.9 : overallVerdict === "needs_review" ? 0.5 : 0.2,
        rationale: `Simulated fixture verdict: ${overallVerdict}.`,
        criterionResults,
        metadata: {
          provider: "fixture",
          model: "deterministic-test-judge",
          promptVersion: "fixture-v1",
          rubricVersions: Object.fromEntries(
            request.rubrics.map((rubric) => [rubric.id, rubric.version]),
          ),
          runId: request.runId,
          latencyMs: 0,
          simulated: true,
        },
      };
      return response;
    },
  };
}
