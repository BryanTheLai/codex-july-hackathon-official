import { Search, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import {
  committedFailedTrainCases,
  type Correction,
  type EvalDataset,
  type MutationResult,
} from "../../domain";
import { SuiteHistory } from "./eval-support";

export function AnalyzeFailuresDrawer({
  candidateVersionId,
  corrections,
  dataset,
  onAnalyze,
  onClose,
  onOpenKnowledge,
  operationBlocked,
}: {
  candidateVersionId: string | null;
  corrections: Correction[];
  dataset: EvalDataset;
  onAnalyze: () => MutationResult & { correctionId?: string | null } | Promise<MutationResult & { correctionId?: string | null }>;
  onClose: () => void;
  onOpenKnowledge: (correction: Correction) => void;
  operationBlocked: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "running" | "complete" | "error">("idle");
  const [error, setError] = useState("");
  const [proposalCorrectionId, setProposalCorrectionId] = useState<string | null>(null);
  const failedCases = committedFailedTrainCases(dataset);
  const failedCaseIds = new Set(failedCases.map((evalCase) => evalCase.id));
  const failedCaseById = new Map(failedCases.map((evalCase) => [evalCase.id, evalCase]));
  const proposedCorrections = corrections.filter(
    (correction) =>
      correction.status === "pending" &&
      correction.sourceCaseId !== undefined &&
      failedCaseIds.has(correction.sourceCaseId),
  );
  const proposalPending = proposedCorrections.length > 0;
  const criterionById = new Map(dataset.criteria.map((criterion) => [criterion.id, criterion]));

  return (
    <aside aria-label="Analyze failures" className="eval-bottom-sheet analyze-drawer">
      <header className="eval-drawer__header">
        <div>
          <strong>Analyze failures</strong>
          <span>
            The configured correction proposer creates one reviewable SOP diff from committed train failures. It
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
      {status !== "idle" ? (
        <p aria-live="polite" className={`analyze-drawer__status analyze-drawer__status--${status}`} role="status">
          {status === "running"
            ? "Analysis is running: asking the correction proposer for one reviewable diff. It will not apply any change automatically."
            : status === "complete"
              ? proposalCorrectionId
                ? "SOP correction proposed. Nothing is active yet. Review the exact diff in Knowledge."
                : "Analysis complete. Review the proposed diff before approving it in Knowledge."
              : error}
        </p>
      ) : null}
      {status === "complete" && proposalCorrectionId ? (
        <p>
          <Link to={`/knowledge?correction=${encodeURIComponent(proposalCorrectionId)}`}>
            Open Knowledge correction
          </Link>
        </p>
      ) : null}
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
          <h2>Proposed Knowledge corrections</h2>
          {proposedCorrections.length === 0 ? (
            <p>No proposed Knowledge corrections.</p>
          ) : (
            proposedCorrections.map((correction) => {
              const sourceTitle =
                failedCaseById.get(correction.sourceCaseId ?? "")?.title ?? "failed case";
              return (
                <button
                  aria-label={`Open ${correction.status} correction for ${sourceTitle} in Knowledge`}
                  className="eval-linked-correction"
                  key={correction.id}
                  onClick={() => onOpenKnowledge(correction)}
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
        {candidateVersionId ? (
          <Link className="eval-button eval-button--primary" to="/knowledge">
            Open Knowledge candidate
          </Link>
        ) : (
          <button
            className="eval-button eval-button--primary"
            disabled={
              failedCases.length === 0 ||
              operationBlocked ||
              proposalPending ||
              status === "running"
            }
            onClick={() => {
              void (async () => {
                setStatus("running");
                setProposalCorrectionId(null);
                const result = await onAnalyze();
                if (result.ok) {
                  setError("");
                  setStatus("complete");
                  if (typeof result.correctionId === "string") {
                    setProposalCorrectionId(result.correctionId);
                  }
                  return;
                }
                setError(result.error);
                setStatus("error");
              })();
            }}
            title={proposalPending ? "Review the pending Knowledge correction first." : undefined}
            type="button"
          >
            <Search aria-hidden="true" size={14} />
            {status === "running" ? "Analyzing..." : "Start analysis"}
          </button>
        )}
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
