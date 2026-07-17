import { ExternalLink, Play, RotateCcw, X } from "lucide-react";

import type { Correction, PlaybookFile } from "../../domain";
import { correctionLine, type TestDockState } from "./knowledge-model";

export function TestDock({
  corrections,
  datasetId,
  file,
  onClose,
  onOpenEval,
  onOpenDataset,
  onRun,
  state,
}: {
  corrections: Correction[];
  datasetId: string | null;
  file: PlaybookFile | null;
  onClose: () => void;
  onOpenEval: (caseId: string) => void;
  onOpenDataset: (datasetId: string) => void;
  onRun: () => void;
  state: Exclude<TestDockState, { status: "closed" }>;
}) {
  const result = state.status === "complete" ? state.result : null;
  const stale = state.status === "complete" ? state.stale : false;
  return (
    <section aria-label="Saved text check results" className="knowledge-test-dock">
      <header>
        <div>
          <Play aria-hidden="true" size={15} />
          <strong>Check saved text</strong>
          <span>Saved-text verification</span>
        </div>
        <div>
          {datasetId ? (
            <button
              className="knowledge-source-link"
              onClick={() => onOpenDataset(datasetId)}
              type="button"
            >
              Eval dataset
              <ExternalLink aria-hidden="true" size={12} />
            </button>
          ) : null}
          {state.status === "complete" || state.status === "error" ? (
            <button className="knowledge-button" onClick={onRun} type="button">
              <RotateCcw aria-hidden="true" size={14} />
              Run Again
            </button>
          ) : null}
          <button aria-label="Close saved text check" className="knowledge-icon-button" onClick={onClose} type="button">
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      </header>
      <div className="knowledge-test-dock__body">
        {state.status === "preparing" || state.status === "running" ? (
          <div className="knowledge-test-progress" role="status">
            <strong>
              {state.status === "preparing"
                ? "Preparing saved-text verification"
                : "Running saved-text verification"}
            </strong>
            <span>{state.completed} of {state.total} corrections checked</span>
            <progress max={state.total || 1} value={state.completed} />
          </div>
        ) : null}
        {state.status === "error" ? (
          <p className="knowledge-inline-error" role="alert">{state.message}</p>
        ) : null}
        {result ? (
          <>
            <div className="knowledge-test-summary">
              <strong>{result.passed} passed</strong>
              <span>{result.evaluated} evaluated</span>
              <span>{result.pending} pending</span>
              <span>{result.rejected} rejected</span>
              {stale ? <b>Stale after save. Run again.</b> : null}
            </div>
            <ul className="knowledge-test-results">
              {result.details.map((detail) => {
                const correction = corrections.find(
                  (candidate) => candidate.id === detail.correctionId,
                );
                const line = correction && file
                  ? correctionLine(file.savedContent, correction) ?? correction.lineHint
                  : correction?.lineHint;
                const lineLabel = line ? `line ${line}` : "saved text";
                const explanation =
                  detail.result === "pass"
                    ? `Saved ${lineLabel} matches the approved text.`
                    : detail.result === "fail"
                      ? `Saved ${lineLabel} no longer matches the approved text.`
                      : detail.result === "pending"
                        ? "Human review is pending, so the proposed text is not applied."
                        : "Rejected text was not applied; saved text stays unchanged.";
                return (
                  <li key={detail.correctionId}>
                    <header>
                      <strong>{line ? `Line ${line}` : detail.correctionId}</strong>
                      <span>
                        <b className={`knowledge-result knowledge-result--${detail.result}`}>
                          {detail.result}
                        </b>
                        {correction?.sourceCaseId ? (
                          <button
                            aria-label={`Open Eval case ${correction.sourceCaseId}`}
                            className="knowledge-source-link"
                            onClick={() => onOpenEval(correction.sourceCaseId!)}
                            type="button"
                          >
                            Eval
                            <ExternalLink aria-hidden="true" size={12} />
                          </button>
                        ) : null}
                      </span>
                    </header>
                    {correction ? (
                      <div className="knowledge-test-result__comparison">
                        <span>
                          <small>Before</small>
                          <code>{correction.oldText}</code>
                        </span>
                        <span>
                          <small>After</small>
                          <code>{correction.newText}</code>
                        </span>
                      </div>
                    ) : null}
                    <p>
                      <strong>Why</strong>
                      {explanation}
                    </p>
                  </li>
                );
              })}
            </ul>
            <p className="knowledge-test-boundary">{result.boundaryNote}</p>
          </>
        ) : null}
      </div>
    </section>
  );
}
