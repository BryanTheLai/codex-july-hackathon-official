import { Check, ExternalLink, X } from "lucide-react";

import type { Correction, PlaybookFile } from "../../domain";
import { correctionLine } from "./dream-model";

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
    <aside aria-label="Proposed changes" className="dream-changes">
      <header className="dream-changes__heading">
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
        <p className="dream-review-blocked" role="status">
          Save or discard the draft before reviewing corrections.
        </p>
      ) : null}
      <div className="dream-changes__list">
        {!file ? <div className="dream-empty">Select a file to review its changes.</div> : null}
        {file && corrections.length === 0 ? (
          <div className="dream-empty">No corrections for this file.</div>
        ) : null}
        {file
          ? corrections.map((correction) => {
              const line = correctionLine(file.savedContent, correction);
              const stale = line === null;
              const blocked = file.draft !== undefined;
              const pendingCorrection = correction.status === "pending";
              return (
                <article
                  className={`dream-correction dream-correction--${correction.status}${
                    focusedCorrectionId === correction.id ? " dream-correction--focused" : ""
                  }`}
                  key={correction.id}
                >
                  {pendingCorrection ? (
                    <>
                      <button
                        aria-label={`Focus correction at line ${line ?? correction.lineHint ?? "unknown"}`}
                        className="dream-correction__focus-surface"
                        disabled={blocked || stale}
                        onClick={() => line && onFocus(correction, line)}
                        type="button"
                      >
                        <header>
                          <div>
                            <span className={`dream-status dream-status--${correction.status}`}>
                              {correction.status}
                            </span>
                            <strong>Line {line ?? correction.lineHint ?? "?"}</strong>
                          </div>
                        </header>
                        <p className="dream-correction__evidence">{correction.evidence}</p>
                        <div className="dream-diff dream-diff--old">
                          <code>- {correction.oldText}</code>
                        </div>
                        <div className="dream-diff dream-diff--new">
                          <code>+ {correction.newText}</code>
                        </div>
                      </button>
                      {correction.sourceCaseId ? (
                        <button
                          className="dream-source-link"
                          onClick={() => onOpenEval(correction.sourceCaseId!)}
                          type="button"
                        >
                          Eval case {correction.sourceCaseId}
                          <ExternalLink aria-hidden="true" size={13} />
                        </button>
                      ) : (
                        <span className="dream-correction__manual">Manual correction</span>
                      )}
                      {stale ? (
                        <p className="dream-stale" role="alert">
                          Saved text no longer contains this line.
                        </p>
                      ) : null}
                      <div className="dream-correction__actions">
                        <button
                          aria-label="Reject correction"
                          className="dream-button"
                          disabled={blocked}
                          onClick={() => onReject(correction)}
                          type="button"
                        >
                          <X aria-hidden="true" size={14} />
                          Reject
                        </button>
                        <button
                          aria-label="Approve correction"
                          className="dream-button dream-button--primary"
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
                      className="dream-correction__focus-surface"
                      disabled={line === null}
                      onClick={() => line && onFocus(correction, line)}
                      type="button"
                    >
                      <header>
                        <div>
                          <span className={`dream-status dream-status--${correction.status}`}>
                            {correction.status}
                          </span>
                          <strong>Line {line ?? correction.lineHint ?? "?"}</strong>
                        </div>
                      </header>
                      <p className="dream-correction__decision">
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
