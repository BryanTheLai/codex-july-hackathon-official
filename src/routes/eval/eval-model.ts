import {
  summarizeEvalDataset,
  type EvalCase,
  type EvalCaseType,
  type EvalDataset,
  type EvalGrade,
  type EvalSplit,
} from "../../domain";

export const EVAL_GLOSSARY = {
  actualSynthetic: "Agent-generated reply produced without reading expected output.",
  booking: "Appointment scheduling and confirmation requests.",
  emergencyTriage: "Case type for urgent escalation language and routing.",
  expectedHitl: "Human-approved reply used only as the grading reference.",
  improveWith: "Examples the improvement step may use while proposing a better playbook.",
  verifyOnly: "Examples kept out while improving and used only afterward to check the change.",
  input: "Ordered conversation context supplied to the synthetic agent for replay.",
  labFollowUp: "Laboratory result availability and clinician follow-up questions.",
  prescription: "Medication renewal and approval checks.",
  scoringRules:
    "Plain-language requirements an LLM judge applies after the synthetic reply is generated.",
  typeColumn:
    "Case intent: emergency triage, booking, prescription, lab follow up, and general.",
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
  overallPassPercent: number;
  trainPassPercent: number;
  holdoutPassPercent: number;
  meanJudgeScore: number | null;
  lastRunDelta: number | null;
  overallCount: string;
  trainCount: string;
  holdoutCount: string;
};

export function metricsForDataset(dataset: EvalDataset): EvalMetrics {
  const summary = summarizeEvalDataset(dataset);
  const snapshots = dataset.suiteSnapshots;
  const lastRunDelta =
    snapshots.length < 2
      ? null
      : snapshots.at(-1)!.overallPassPercent - snapshots.at(-2)!.overallPassPercent;

  return {
    overallPassPercent: summary.overall.passPercent,
    trainPassPercent: summary.train.passPercent,
    holdoutPassPercent: summary.holdout.passPercent,
    meanJudgeScore: summary.meanJudgeScore,
    lastRunDelta,
    overallCount: `${summary.overall.passed}/${summary.overall.total}`,
    trainCount: `${summary.train.passed}/${summary.train.total}`,
    holdoutCount: `${summary.holdout.passed}/${summary.holdout.total}`,
  };
}

export function inputText(evalCase: EvalCase): string {
  return evalCase.inputConversation.messages
    .map((message) => `${message.role.replace("_", " ")}: ${message.text}`)
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

export function formatCaseType(type: EvalCaseType): string {
  return type.replaceAll("_", " ");
}
