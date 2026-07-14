import { round2 } from "./shared";
import type { EvalCase, EvalDataset, EvalSplit } from "./types";

export type EvalPassMetric = {
  passed: number;
  total: number;
  passPercent: number;
};

export type EvalDatasetSummary = {
  overall: EvalPassMetric;
  train: EvalPassMetric;
  holdout: EvalPassMetric;
  meanJudgeScore: number | null;
};

function passMetric(cases: EvalCase[]): EvalPassMetric {
  const passed = cases.filter((evalCase) => evalCase.grade?.pass).length;
  return {
    passed,
    total: cases.length,
    passPercent: cases.length === 0 ? 0 : Math.round((passed / cases.length) * 100),
  };
}

function casesForSplit(dataset: EvalDataset, split: EvalSplit): EvalCase[] {
  return dataset.cases.filter((evalCase) => evalCase.split === split);
}

export function summarizeEvalDataset(dataset: EvalDataset): EvalDatasetSummary {
  const graded = dataset.cases.filter((evalCase) => evalCase.grade);
  const meanJudgeScore =
    graded.length === 0
      ? null
      : round2(
          graded.reduce((sum, evalCase) => sum + (evalCase.grade?.judgeScore ?? 0), 0) /
            graded.length,
        );

  return {
    overall: passMetric(dataset.cases),
    train: passMetric(casesForSplit(dataset, "train")),
    holdout: passMetric(casesForSplit(dataset, "holdout")),
    meanJudgeScore,
  };
}
