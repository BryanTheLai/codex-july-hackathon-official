import { Check, ExternalLink, X } from "lucide-react";

import type { Correction, PlaybookFile } from "../../domain";
import { correctionLine } from "./knowledge-model";

export function ChangesPane({
  corrections,
  file,
  focusedCorrectionId,
  onApprove,
  onFocus,
  onOpenEval,
  onReject,
}: {
  corrections: Correction[];
  file: PlaybookFile | null;
  focusedCorrectionId: string | null;
  onApprove: (correction: Correction) => void;
  onFocus: (correction: Correction, line: number) => void;
  onOpenEval: (caseId: string) => void;
  onReject: (correction: Correction) => void;
}) {
  const pending = corrections.filter((correction) => correction.status === "pending").length;

  return (
    <aside aria-label="Proposed changes" className="knowledge-changes">
      <header className="knowledge-changes__heading">
        <div>
          <strong>Proposed changes</strong>
          <span>{file?.path ?? "No file selected"}</span>
        </div>
        <div>
          <b>{pending}</b> pending
          <span>{corrections.length - pending} decided</span>
        </div>
      </header>
      {file?.draft !== undefined ? (
        <p className="knowledge-review-blocked" role="status">
          Save or discard the draft before reviewing corrections.
        </p>
      ) : null}
      <div className="knowledge-changes__list">
        {!file ? <div className="knowledge-empty">Select a file to review its changes.</div> : null}
        {file && corrections.length === 0 ? (
          <div className="knowledge-empty">No corrections for this file.</div>
        ) : null}
        {file
          ? corrections.map((correction) => {
              const line = correctionLine(file.savedContent, correction);
              const stale = line === null;
              const blocked = file.draft !== undefined;
              const pendingCorrection = correction.status === "pending";
              return (
                <article
                  className={`knowledge-correction knowledge-correction--${correction.status}${
                    focusedCorrectionId === correction.id ? " knowledge-correction--focused" : ""
                  }`}
                  key={correction.id}
                >
                  {pendingCorrection ? (
                    <>
                      <button
                        aria-label={`Focus correction at line ${line ?? correction.lineHint ?? "unknown"}`}
                        className="knowledge-correction__focus-surface"
                        disabled={blocked || stale}
                        onClick={() => line && onFocus(correction, line)}
                        type="button"
                      >
                        <header>
                          <div>
                            <span className={`knowledge-status knowledge-status--${correction.status}`}>
                              {correction.status}
                            </span>
                            <strong>Line {line ?? correction.lineHint ?? "?"}</strong>
                          </div>
                        </header>
                        <p className="knowledge-correction__evidence">{correction.evidence}</p>
                        <div className="knowledge-diff knowledge-diff--old">
                          <code>- {correction.oldText}</code>
                        </div>
                        <div className="knowledge-diff knowledge-diff--new">
                          <code>+ {correction.newText}</code>
                        </div>
                      </button>
                      {correction.sourceCaseId ? (
                        <button
                          className="knowledge-source-link"
                          onClick={() => onOpenEval(correction.sourceCaseId!)}
                          type="button"
                        >
                          Eval case {correction.sourceCaseId}
                          <ExternalLink aria-hidden="true" size={13} />
                        </button>
                      ) : (
                        <span className="knowledge-correction__manual">Manual correction</span>
                      )}
                      {stale ? (
                        <p className="knowledge-stale" role="status">
                          Saved text no longer contains the proposed line. Re-run analysis to create a
                          fresh proposal; approval is intentionally disabled.
                        </p>
                      ) : null}
                      <div className="knowledge-correction__actions">
                        <button
                          aria-label={stale ? "Dismiss stale proposal" : "Reject correction"}
                          className="knowledge-button"
                          disabled={blocked}
                          onClick={() => onReject(correction)}
                          type="button"
                        >
                          <X aria-hidden="true" size={14} />
                          {stale ? "Dismiss stale proposal" : "Reject"}
                        </button>
                        <button
                          aria-label="Approve correction"
                          className="knowledge-button knowledge-button--primary"
                          disabled={blocked || stale}
                          onClick={() => onApprove(correction)}
                          type="button"
                        >
                          <Check aria-hidden="true" size={14} />
                          Approve
                        </button>
                      </div>
                    </>
                  ) : (
                    <button
                      aria-label={`Focus correction at line ${line ?? correction.lineHint ?? "unknown"}`}
                      className="knowledge-correction__focus-surface"
                      disabled={line === null}
                      onClick={() => line && onFocus(correction, line)}
                      type="button"
                    >
                      <header>
                        <div>
                          <span className={`knowledge-status knowledge-status--${correction.status}`}>
                            {correction.status}
                          </span>
                          <strong>Line {line ?? correction.lineHint ?? "?"}</strong>
                        </div>
                      </header>
                      <p className="knowledge-correction__decision">
                        <span>- {correction.oldText}</span>
                        <span>+ {correction.newText}</span>
                      </p>
                    </button>
                  )}
                </article>
              );
            })
          : null}
      </div>
    </aside>
  );
}
