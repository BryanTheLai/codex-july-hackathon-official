import type { ReactNode } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { EvalDataset } from "../../domain";
import { metricsForDataset } from "./eval-model";

function Metric({
  count,
  label,
  value,
  className,
}: {
  count?: string;
  label: ReactNode;
  value: string;
  className?: string;
}) {
  return (
    <div className={`eval-metric${className ? ` ${className}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{count ?? "No prior run"}</small>
    </div>
  );
}

export function ScoreSummary({
  dataset,
}: {
  dataset: EvalDataset;
}) {
  const metrics = metricsForDataset(dataset);
  const guard = metrics.regressionGuard;

  return (
    <section aria-label="Evaluation summary" className="eval-summary" role="region">
      <Metric
        count={
          guard.evaluated === 0
            ? `${guard.total} regression guards waiting`
            : `${guard.passed}/${guard.evaluated} passed · ${guard.total} total`
        }
        label="Regression guard"
        value={guard.percent === null ? "Not run" : `${guard.percent}%`}
      />
      <Metric
        count={metrics.openFailures === 1 ? "1 case needs attention" : `${metrics.openFailures} cases need attention`}
        label="Open failures"
        value={String(metrics.openFailures)}
      />
    </section>
  );
}

export function SuiteHistory({ dataset }: { dataset: EvalDataset }) {
  const data = dataset.suiteSnapshots.map((snapshot, index) => ({
    label: `R${index + 1}`,
    overall: snapshot.overallPassPercent,
  }));

  return (
    <section aria-label="Suite history" className="eval-history" role="region">
      <header>
        <strong>Suite history</strong>
        <span>All-case pass rate, 0-100%</span>
      </header>
      {data.length === 0 ? (
        <div className="eval-history__empty">Run all cases to create history.</div>
      ) : (
        <div
          aria-label={`${data.length} suite history snapshots`}
          className="eval-history__chart"
          role="img"
        >
          <ResponsiveContainer height="100%" width="100%">
            <LineChart data={data} margin={{ bottom: 2, left: -24, right: 10, top: 8 }}>
              <CartesianGrid stroke="#d8ddd8" strokeDasharray="2 2" vertical={false} />
              <XAxis dataKey="label" fontSize={10} tickLine={false} />
              <YAxis domain={[0, 100]} fontSize={10} tickLine={false} ticks={[0, 50, 100]} />
              <Tooltip isAnimationActive={false} />
              <Line
                dataKey="overall"
                dot={{ r: 2 }}
                isAnimationActive={false}
                stroke="#0b6b5f"
                strokeWidth={2}
                type="linear"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
