import { ExternalLink, Play, RotateCcw, X } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import type { Correction, PlaybookFile } from "../../domain";
import { correctionLine, type TestDockState } from "./knowledge-model";

const DEFAULT_DOCK_HEIGHT = 210;
const MIN_DOCK_HEIGHT = 120;
const KEYBOARD_RESIZE_STEP = 20;

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
  const dockRef = useRef<HTMLElement | null>(null);
  const [height, setHeight] = useState(DEFAULT_DOCK_HEIGHT);
  const result = state.status === "complete" ? state.result : null;
  const stale = state.status === "complete" ? state.stale : false;
  const maximumHeight = () => {
    const parentHeight = dockRef.current?.parentElement?.clientHeight ?? 0;
    return Math.max(MIN_DOCK_HEIGHT, parentHeight > 0 ? Math.floor(parentHeight * 0.7) : 560);
  };
  const resize = (nextHeight: number) => {
    setHeight(Math.min(maximumHeight(), Math.max(MIN_DOCK_HEIGHT, Math.round(nextHeight))));
  };
  const resizeFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const parentBottom =
      dockRef.current?.parentElement?.getBoundingClientRect().bottom ??
      window.innerHeight;
    resize(parentBottom - event.clientY);
  };
  const resizeFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    let nextHeight: number | null = null;
    switch (event.key) {
      case "ArrowUp":
        nextHeight = height + KEYBOARD_RESIZE_STEP;
        break;
      case "ArrowDown":
        nextHeight = height - KEYBOARD_RESIZE_STEP;
        break;
      case "Home":
        nextHeight = MIN_DOCK_HEIGHT;
        break;
      case "End":
        nextHeight = maximumHeight();
        break;
      case "Enter":
        nextHeight = DEFAULT_DOCK_HEIGHT;
        break;
      default:
        return;
    }
    event.preventDefault();
    resize(nextHeight);
  };
  return (
    <section
      aria-label="Saved text check results"
      className="knowledge-test-dock"
      ref={dockRef}
      style={{ flexBasis: height }}
    >
      <div
        aria-label="Resize saved text check"
        aria-orientation="horizontal"
        aria-valuemax={maximumHeight()}
        aria-valuemin={MIN_DOCK_HEIGHT}
        aria-valuenow={height}
        className="knowledge-test-dock__resize-handle"
        onDoubleClick={() => resize(DEFAULT_DOCK_HEIGHT)}
        onKeyDown={resizeFromKeyboard}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={resizeFromPointer}
        role="separator"
        tabIndex={0}
      >
        <span aria-hidden="true" />
      </div>
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
