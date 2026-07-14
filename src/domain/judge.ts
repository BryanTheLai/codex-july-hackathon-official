import type { JudgeRequest, JudgeResponse } from "../contracts/judge";
import type { AppState, EvalCaseId, EvalGrade } from "./types";
import { applicableCriteria } from "./eval-support";
import { findCaseInState, trimOrEmpty } from "./shared";

export type BuildJudgeRequestResult =
  | { ok: true; request: JudgeRequest }
  | { ok: false; error: string };

export function buildJudgeRequest(
  state: AppState,
  caseId: EvalCaseId,
  candidateResponse: string,
  runId: string,
): BuildJudgeRequestResult {
  const located = findCaseInState(state, caseId);
  if (!located) {
    return { ok: false, error: "Case not found" };
  }
  const candidate = trimOrEmpty(candidateResponse);
  if (!candidate) {
    return { ok: false, error: "Candidate response is empty" };
  }
  const criteria = applicableCriteria(located.dataset, located.evalCase);
  if (criteria.length === 0) {
    return { ok: false, error: "Add at least one scoring rule before running this case" };
  }

  return {
    ok: true,
    request: {
      runId,
      datasetId: located.dataset.id,
      caseId: located.evalCase.id,
      caseType: located.evalCase.type,
      language: located.evalCase.language,
      candidateVersion: located.dataset.candidateVersion,
      conversation: located.evalCase.inputConversation.messages.map((message) => ({
        role: message.role,
        text: message.text,
        gloss: message.gloss,
        language: message.language,
      })),
      candidateResponse: candidate,
      expectedResponse: located.evalCase.expectedHumanOutput,
      rubrics: criteria.map((criterion) => ({
        id: criterion.id,
        label: criterion.label,
        instruction: criterion.instruction,
        required: criterion.required,
        examples: criterion.examples,
        version: criterion.version,
      })),
    },
  };
}

export function gradeFromJudgeResponse(response: JudgeResponse): EvalGrade {
  return {
    pass: response.overallVerdict === "pass",
    verdict: response.overallVerdict,
    judgeScore: response.judgeScore,
    rationale: response.rationale,
    criterionResults: response.criterionResults,
    metadata: response.metadata,
  };
}
