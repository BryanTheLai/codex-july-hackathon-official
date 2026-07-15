import { History } from "lucide-react";
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

import { GlossaryTerm } from "../../components/glossary-term";
import type { EvalDataset } from "../../domain";
import { EVAL_GLOSSARY, metricsForDataset } from "./eval-model";

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
  mobile,
  onHistory,
}: {
  dataset: EvalDataset;
  mobile: boolean;
  onHistory: () => void;
}) {
  const metrics = metricsForDataset(dataset);
  const delta =
    metrics.lastRunDelta === null
      ? "N/A"
      : `${metrics.lastRunDelta >= 0 ? "+" : ""}${metrics.lastRunDelta}pp`;

  return (
    <section
      aria-label="Score summary"
      className={`eval-summary${mobile ? " eval-summary--mobile" : ""}`}
      role="region"
    >
      <Metric
        count={metrics.overallCount}
        label="Overall"
        value={`${metrics.overallPassPercent}%`}
      />
      <Metric
        count={metrics.trainCount}
        label={<GlossaryTerm definition={EVAL_GLOSSARY.improveWith}>Improve with</GlossaryTerm>}
        value={`${metrics.trainPassPercent}%`}
      />
      <Metric
        count={metrics.holdoutCount}
        label={<GlossaryTerm definition={EVAL_GLOSSARY.verifyOnly}>Verify only</GlossaryTerm>}
        value={`${metrics.holdoutPassPercent}%`}
      />
      <Metric
        className="eval-metric--supporting"
        label="Mean judge"
        value={metrics.meanJudgeScore === null ? "N/A" : metrics.meanJudgeScore.toFixed(2)}
      />
      <Metric className="eval-metric--supporting" label="Last delta" value={delta} />
      {mobile ? (
        <button className="eval-summary__history" onClick={onHistory} type="button">
          <History aria-hidden="true" size={15} />
          History
        </button>
      ) : null}
    </section>
  );
}

export function SuiteHistory({ dataset }: { dataset: EvalDataset }) {
  const data = dataset.suiteSnapshots.map((snapshot, index) => ({
    label: `R${index + 1}`,
    overall: snapshot.overallPassPercent,
    train: snapshot.trainPassPercent,
    holdout: snapshot.holdoutPassPercent,
  }));

  return (
    <section aria-label="Suite history" className="eval-history" role="region">
      <header>
        <strong>Suite history</strong>
        <span>Pass rate, 0-100%</span>
      </header>
      {data.length === 0 ? (
        <div className="eval-history__empty">Run the suite to create history.</div>
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
              <Line
                dataKey="train"
                dot={{ r: 2 }}
                isAnimationActive={false}
                stroke="#285d85"
                strokeWidth={1.5}
                type="linear"
                name="Improve with"
              />
              <Line
                dataKey="holdout"
                dot={{ r: 2 }}
                isAnimationActive={false}
                stroke="#7a5111"
                strokeWidth={1.5}
                type="linear"
                name="Verify only"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
