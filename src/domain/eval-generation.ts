import type {
  AppState,
  EvalCase,
  EvalCaseId,
  ForbiddenGenerationFields,
  GenerationInputResult,
  SyntheticOutputResult,
} from "./types";
import { findCaseInState } from "./shared";
import { messageDigest, playbookIdForCaseType } from "./eval-support";

const FORBIDDEN_GENERATION_KEYS = [
  "expectedHumanOutput",
  "actualSyntheticOutput",
  "grade",
  "rationale",
] as const;

export function buildGenerationInput(
  state: AppState,
  caseId: EvalCaseId,
  forbidden?: ForbiddenGenerationFields,
): GenerationInputResult {
  if (forbidden) {
    for (const key of FORBIDDEN_GENERATION_KEYS) {
      if (forbidden[key] !== undefined) {
        return { ok: false, error: `Forbidden generation field leak: ${key}` };
      }
    }
  }

  const located = findCaseInState(state, caseId);
  if (!located) {
    return { ok: false, error: "Case not found" };
  }

  return {
    ok: true,
    input: {
      caseId: located.evalCase.id,
      title: located.evalCase.title,
      type: located.evalCase.type,
      language: located.evalCase.language,
      inputConversation: located.evalCase.inputConversation,
      criterionIds: located.evalCase.criterionIds,
      candidateVersion: located.dataset.candidateVersion,
    },
  };
}

function synthesizeFromMetadata(
  state: AppState,
  evalCase: EvalCase,
): string {
  const playbook = state.playbookFiles.find((file) => file.id === playbookIdForCaseType(evalCase.type));
  const digest = messageDigest(evalCase.inputConversation.messages);

  const lines = [
    `Synthetic demo response for ${evalCase.type} in ${evalCase.language}.`,
    digest,
    playbook?.savedContent.split("\n")[1]?.trim() ?? "",
  ];

  if (evalCase.type === "booking") {
    lines.push("We received your request.");
  }
  if (evalCase.type === "prescription") {
    lines.push("We are reviewing your refill request.");
  }
  if (evalCase.type === "emergency_triage") {
    lines.push("Monitor symptoms closely.");
  }
  if (evalCase.type === "general") {
    lines.push("Please wait for staff.");
  }

  return lines.filter(Boolean).join(" ");
}

export function generateSyntheticOutput(state: AppState, caseId: EvalCaseId): SyntheticOutputResult {
  const located = findCaseInState(state, caseId);
  if (!located) {
    return { ok: false, error: "Case not found" };
  }

  return {
    ok: true,
    output: synthesizeFromMetadata(state, located.evalCase),
  };
}
