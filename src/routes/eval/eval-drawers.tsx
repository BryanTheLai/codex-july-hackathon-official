import { Search, X } from "lucide-react";
import { useState } from "react";

import {
  committedFailedTrainCases,
  type Correction,
  type EvalDataset,
  type MutationResult,
} from "../../domain";
import { SuiteHistory } from "./eval-support";

export function AnalyzeFailuresDrawer({
  corrections,
  dataset,
  onAnalyze,
  onClose,
  onOpenDream,
  operationBlocked,
}: {
  corrections: Correction[];
  dataset: EvalDataset;
  onAnalyze: () => MutationResult | Promise<MutationResult>;
  onClose: () => void;
  onOpenDream: (correction: Correction) => void;
  operationBlocked: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "running" | "complete" | "error">("idle");
  const [error, setError] = useState("");
  const failedCases = committedFailedTrainCases(dataset);
  const failedCaseIds = new Set(failedCases.map((evalCase) => evalCase.id));
  const failedCaseById = new Map(failedCases.map((evalCase) => [evalCase.id, evalCase]));
  const proposedCorrections = corrections.filter(
    (correction) =>
      correction.status === "pending" &&
      correction.sourceCaseId !== undefined &&
      failedCaseIds.has(correction.sourceCaseId),
  );
  const criterionById = new Map(dataset.criteria.map((criterion) => [criterion.id, criterion]));

  return (
    <aside aria-label="Analyze failures" className="eval-bottom-sheet analyze-drawer">
      <header className="eval-drawer__header">
        <div>
          <strong>Analyze failures</strong>
          <span>
            A configured LLM proposes one reviewable SOP diff from committed train failures. It
            never reruns, activates, or improves the agent on its own.
          </span>
        </div>
        <button
          aria-label="Close analysis"
          className="eval-icon-button"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={17} />
        </button>
      </header>
      <div className="eval-drawer__scroll analyze-drawer__content" tabIndex={0}>
        <section>
          <h2>Failed train cases</h2>
          {failedCases.length === 0 ? (
            <p>The selected suite has no failed train cases.</p>
          ) : (
            <ol className="analyze-failure-list">
              {failedCases.map((evalCase) => (
                <li key={evalCase.id}>
                  <h3>{evalCase.title}</h3>
                  <p>{evalCase.grade?.rationale}</p>
                  <ul className="eval-criterion-results">
                    {evalCase.grade?.criterionResults
                      .filter((result) => result.verdict !== "pass")
                      .map((result) => (
                        <li key={result.criterionId}>
                          <div>
                            <strong>
                              {criterionById.get(result.criterionId)?.label ?? result.criterionId}
                            </strong>
                            <span
                              className={`eval-status eval-status--${result.verdict.replace("_", "-")}`}
                            >
                              {result.verdict.replace("_", " ")}
                            </span>
                          </div>
                          <p>{result.reason}</p>
                          {result.evidence ? <blockquote>{result.evidence}</blockquote> : null}
                        </li>
                      ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section>
          <h2>Proposed Dream corrections</h2>
          {proposedCorrections.length === 0 ? (
            <p>No proposed Dream corrections.</p>
          ) : (
            proposedCorrections.map((correction) => {
              const sourceTitle =
                failedCaseById.get(correction.sourceCaseId ?? "")?.title ?? "failed case";
              return (
                <button
                  aria-label={`Open ${correction.status} correction for ${sourceTitle} in Dream`}
                  className="eval-linked-correction"
                  key={correction.id}
                  onClick={() => onOpenDream(correction)}
                  type="button"
                >
                  <strong>{correction.status}</strong>
                  <span>{correction.evidence}</span>
                </button>
              );
            })
          )}
        </section>
      </div>
      <footer className="eval-drawer__footer analyze-drawer__footer">
        <span aria-live="polite" role="status">
          {status === "running"
            ? "Asking the SOP proposer..."
            : status === "complete"
              ? "Analysis complete."
              : status === "error"
                ? error
                : ""}
        </span>
        <button
          className="eval-button eval-button--primary"
          disabled={failedCases.length === 0 || operationBlocked || status === "running"}
          onClick={() => {
            void (async () => {
              setStatus("running");
              const result = await onAnalyze();
              if (result.ok) {
                setError("");
                setStatus("complete");
                return;
              }
              setError(result.error);
              setStatus("error");
            })();
          }}
          type="button"
        >
          <Search aria-hidden="true" size={14} />
          {status === "running" ? "Analyzing..." : "Start analysis"}
        </button>
      </footer>
    </aside>
  );
}

export function HistoryDrawer({
  dataset,
  onClose,
}: {
  dataset: EvalDataset;
  onClose: () => void;
}) {
  return (
    <aside aria-label="Evaluation history" className="eval-drawer eval-history-drawer">
      <header className="eval-drawer__header">
        <div>
          <strong>History</strong>
          <span>Committed suite snapshots</span>
        </div>
        <button aria-label="Close history" className="eval-icon-button" onClick={onClose} type="button">
          <X aria-hidden="true" size={17} />
        </button>
      </header>
      <div className="eval-drawer__scroll">
        <SuiteHistory dataset={dataset} />
      </div>
    </aside>
  );
}
