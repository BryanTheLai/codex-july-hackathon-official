import {
  type EvalCase,
  type EvalCaseType,
  type EvalDataset,
  type EvalGrade,
  type EvalSplit,
} from "../../domain";

export const EVAL_GLOSSARY = {
  actualSynthetic: "Agent-generated reply produced without reading the staff-approved reply.",
  booking: "Service visit scheduling and confirmation requests.",
  emergencyTriage: "Urgent customer requests that need owner escalation.",
  expectedHitl: "Staff-approved reply used only as grading reference evidence. The agent never sees it during replay.",
  improveSop: "A failure here can produce a reviewable Knowledge SOP proposal. It does not train or condition the agent.",
  regressionGuard: "Held out from SOP improvement and used afterward to check that a proposed change did not cause a regression.",
  input: "Ordered conversation context supplied to the synthetic agent for replay.",
  labFollowUp: "Legacy case type retained for compatibility; not used in the aircon demo seed.",
  prescription: "Legacy case type retained for compatibility; not used in the aircon demo seed.",
  scoringRules: "Plain-language requirements the judge applies after the agent reply is generated.",
  typeColumn:
    "Case intent: booking, general service selection, and other aircon desk scenarios.",
} as const;

export type EvalResultFilter = "all" | "pass" | "fail" | "needs_review" | "not_run";
export type EvalSort = { column: "fixture" | "item" | "grade"; direction: "asc" | "desc" };

export type EvalFilters = {
  query: string;
  split: "all" | EvalSplit;
  language: string;
  result: EvalResultFilter;
};

export type EvalMetrics = {
  openFailures: number;
  regressionGuard: { evaluated: number; passed: number; percent: number | null; total: number };
};

export function metricsForDataset(dataset: EvalDataset): EvalMetrics {
  const metric = (cases: EvalCase[]) => {
    const evaluated = cases.filter((evalCase) => evalCase.grade !== undefined);
    const passed = evaluated.filter((evalCase) => evalCase.grade?.pass).length;
    return {
      evaluated: evaluated.length,
      passed,
      percent: evaluated.length === 0 ? null : Math.round((passed / evaluated.length) * 100),
      total: cases.length,
    };
  };

  return {
    openFailures: dataset.cases.filter(
      (evalCase) => evalCase.grade !== undefined && evalCase.grade.pass === false,
    ).length,
    regressionGuard: metric(dataset.cases.filter((evalCase) => evalCase.split === "holdout")),
  };
}

function formatMessageRole(role: string): string {
  if (role === "patient") {
    return "customer";
  }
  return role.replace("_", " ");
}

export function inputText(evalCase: EvalCase): string {
  return evalCase.inputConversation.messages
    .map((message) => `${formatMessageRole(message.role)}: ${message.text}`)
    .join("\n");
}

export function criteriaText(dataset: EvalDataset, evalCase: EvalCase): string {
  const criteria =
    evalCase.criterionIds.length > 0
      ? dataset.criteria.filter((criterion) => evalCase.criterionIds.includes(criterion.id))
      : dataset.criteria;
  return criteria.length > 0
    ? criteria.map((criterion) => criterion.label).join(", ")
    : "No criteria";
}

export function gradeLabel(grade?: EvalGrade): "Pass" | "Fail" | "Needs review" | "Not run" {
  if (!grade) {
    return "Not run";
  }
  if (grade.verdict === "needs_review") {
    return "Needs review";
  }
  return grade.verdict === "pass" ? "Pass" : "Fail";
}

function matchesResult(evalCase: EvalCase, result: EvalResultFilter): boolean {
  if (result === "pass") {
    return evalCase.grade?.pass === true;
  }
  if (result === "fail") {
    return evalCase.grade?.verdict === "fail";
  }
  if (result === "needs_review") {
    return evalCase.grade?.verdict === "needs_review";
  }
  if (result === "not_run") {
    return !evalCase.grade;
  }
  return true;
}

export function visibleEvalCases(
  dataset: EvalDataset,
  filters: EvalFilters,
  sort: EvalSort,
): EvalCase[] {
  const query = filters.query.trim().toLocaleLowerCase();
  const fixtureOrder = new Map(dataset.cases.map((evalCase, index) => [evalCase.id, index]));
  const visible = dataset.cases.filter((evalCase) => {
    const searchText = [
      evalCase.title,
      evalCase.type,
      evalCase.language,
      inputText(evalCase),
      evalCase.expectedHumanOutput,
      evalCase.actualSyntheticOutput ?? "",
      criteriaText(dataset, evalCase),
      evalCase.grade?.rationale ?? "",
    ]
      .join(" ")
      .toLocaleLowerCase();
    return (
      (!query || searchText.includes(query)) &&
      (filters.split === "all" || evalCase.split === filters.split) &&
      (filters.language === "all" || evalCase.language === filters.language) &&
      matchesResult(evalCase, filters.result)
    );
  });

  if (sort.column === "fixture") {
    return visible;
  }

  return [...visible].sort((left, right) => {
    const direction = sort.direction === "asc" ? 1 : -1;
    if (sort.column === "item") {
      return left.title.localeCompare(right.title) * direction;
    }
    const leftScore = left.grade?.judgeScore ?? -1;
    const rightScore = right.grade?.judgeScore ?? -1;
    if (leftScore === rightScore) {
      return (fixtureOrder.get(left.id)! - fixtureOrder.get(right.id)!) * direction;
    }
    return (leftScore - rightScore) * direction;
  });
}

export function nextSort(current: EvalSort, column: "item" | "grade"): EvalSort {
  if (current.column !== column) {
    return { column, direction: "asc" };
  }
  if (current.direction === "asc") {
    return { column, direction: "desc" };
  }
  return { column: "fixture", direction: "asc" };
}

const CASE_TYPE_LABELS: Record<EvalCaseType, string> = {
  booking: "Booking",
  emergency_triage: "Urgent escalation",
  general: "General",
  lab_follow_up: "Follow-up",
  prescription: "Legacy",
};

export function formatCaseType(type: EvalCaseType): string {
  return CASE_TYPE_LABELS[type];
}
