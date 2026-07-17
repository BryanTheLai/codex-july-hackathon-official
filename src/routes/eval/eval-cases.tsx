import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { Copy, Edit3, LoaderCircle, Play, Square, Trash2 } from "lucide-react";
import { useMemo, type KeyboardEvent, type MouseEvent } from "react";

import { GlossaryTerm } from "../../components/glossary-term";
import type { EvalCase, EvalCaseId, EvalCaseType, EvalDataset } from "../../domain";
import { EVAL_GLOSSARY, formatCaseType, gradeLabel, type EvalSort } from "./eval-model";

function CaseTypeLabel({ type }: { type: EvalCaseType }) {
  const label = formatCaseType(type);
  const definition: Record<EvalCaseType, string> = {
    booking: EVAL_GLOSSARY.booking,
    emergency_triage: EVAL_GLOSSARY.emergencyTriage,
    general: "General patient questions outside the specialized case types.",
    lab_follow_up: EVAL_GLOSSARY.labFollowUp,
    prescription: EVAL_GLOSSARY.prescription,
  };
  return <GlossaryTerm definition={definition[type]}>{label}</GlossaryTerm>;
}

function SplitLabel({ split }: { split: EvalCase["split"] }) {
  const regressionGuard = split === "holdout";
  return (
    <GlossaryTerm
      className="eval-split"
      definition={regressionGuard ? EVAL_GLOSSARY.regressionGuard : EVAL_GLOSSARY.improveSop}
    >
      {regressionGuard ? "Regression guard" : "Improve SOP"}
    </GlossaryTerm>
  );
}

function SourceLabel({ evalCase }: { evalCase: EvalCase }) {
  if (evalCase.source.kind === "autonomous_feedback") {
    return "Patient feedback";
  }
  if (evalCase.source.kind === "hitl") {
    return "Resolved staff chat";
  }
  if (evalCase.source.kind === "manual") {
    return "Manual test";
  }
  return "Synthetic scenario";
}

function Result({ evalCase, running }: { evalCase: EvalCase; running: boolean }) {
  if (running) {
    return (
      <span aria-live="polite" className="eval-result eval-result--running">
        <LoaderCircle aria-hidden="true" size={14} /> Replaying...
      </span>
    );
  }

  if (!evalCase.expectedHumanOutput.trim()) {
    return (
      <div className="eval-result">
        <span className="eval-status eval-status--needs-review">Needs correction</span>
        <small>Add the human correction before running</small>
      </div>
    );
  }

  const label = gradeLabel(evalCase.grade);
  const results = evalCase.grade?.criterionResults ?? [];
  const passed = results.filter((result) => result.verdict === "pass").length;
  const isFailed = evalCase.grade?.verdict === "fail";
  return (
    <div className="eval-result">
      <span className={`eval-status eval-status--${label.toLocaleLowerCase().replace(" ", "-")}`}>
        {label}
      </span>
      <small>{evalCase.grade ? `${passed}/${results.length} rules passed` : "Run to evaluate"}</small>
      {isFailed && evalCase.grade?.rationale ? (
        <span className="eval-result__rationale" style={{ display: "block", marginTop: "4px", fontSize: "0.8rem", color: "#ef4444", maxWidth: "250px", whiteSpace: "normal", wordBreak: "break-word" }}>
          {evalCase.grade.rationale}
        </span>
      ) : null}
    </div>
  );
}

function CaseActions({
  evalCase,
  running,
  onCancel,
  onDelete,
  onDuplicate,
  onEdit,
  onRun,
  runBlocked,
}: {
  evalCase: EvalCase;
  running: boolean;
  onCancel: (caseId: EvalCaseId) => void;
  onDelete: (evalCase: EvalCase) => void;
  onDuplicate: (caseId: EvalCaseId) => void;
  onEdit: (evalCase: EvalCase) => void;
  onRun: (caseId: EvalCaseId) => void;
  runBlocked: boolean;
}) {
  const stop = (callback: () => void) => (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    callback();
  };
  const needsHumanCorrection = !evalCase.expectedHumanOutput.trim();

  return (
    <div aria-label="Case actions" className="eval-case-actions" role="group">
      {running ? (
        <button aria-label={`Cancel ${evalCase.title} run`} onClick={stop(() => onCancel(evalCase.id))} title="Cancel run" type="button">
          <Square aria-hidden="true" size={14} />
        </button>
      ) : (
        <button
          aria-label={`Run ${evalCase.title}`}
          disabled={runBlocked || needsHumanCorrection}
          onClick={stop(() => onRun(evalCase.id))}
          title={needsHumanCorrection ? "Add a human correction before running" : "Run case"}
          type="button"
        >
          <Play aria-hidden="true" size={14} />
        </button>
      )}
      <button aria-label={`Edit ${evalCase.title}`} disabled={runBlocked} onClick={stop(() => onEdit(evalCase))} title="Edit case" type="button">
        <Edit3 aria-hidden="true" size={14} />
      </button>
      <button aria-label={`Duplicate ${evalCase.title}`} disabled={runBlocked} onClick={stop(() => onDuplicate(evalCase.id))} title="Duplicate case" type="button">
        <Copy aria-hidden="true" size={14} />
      </button>
      <button aria-label={`Delete ${evalCase.title}`} disabled={runBlocked} onClick={stop(() => onDelete(evalCase))} title="Delete case" type="button">
        <Trash2 aria-hidden="true" size={14} />
      </button>
    </div>
  );
}

export type EvalCasesProps = {
  cases: EvalCase[];
  dataset: EvalDataset;
  mobile: boolean;
  runBlocked: boolean;
  runningCaseId: EvalCaseId | null;
  selectedCaseId: EvalCaseId | null;
  sort: EvalSort;
  onCancel: (caseId: EvalCaseId) => void;
  onDelete: (evalCase: EvalCase) => void;
  onDuplicate: (caseId: EvalCaseId) => void;
  onEdit: (evalCase: EvalCase) => void;
  onOpen: (caseId: EvalCaseId) => void;
  onRun: (caseId: EvalCaseId) => void;
  onSort: (column: "item" | "grade") => void;
};

export function EvalCases(props: EvalCasesProps) {
  const openOnKeyboard = (
    event: KeyboardEvent<HTMLTableRowElement | HTMLElement>,
    caseId: EvalCaseId,
  ) => {
    if (event.target !== event.currentTarget || props.runBlocked) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      props.onOpen(caseId);
    }
  };

  const columns = useMemo<ColumnDef<EvalCase>[]>(
    () => [
      { id: "item", accessorKey: "title" },
      { id: "context", accessorKey: "type" },
      { id: "grade", accessorFn: (evalCase) => evalCase.grade?.judgeScore },
      { id: "actions" },
    ],
    [],
  );
  const table = useReactTable({
    columns,
    data: props.cases,
    getCoreRowModel: getCoreRowModel(),
  });

  if (props.cases.length === 0) {
    return (
      <div className="eval-empty">
        <strong>No evaluation cases match this dataset or filter.</strong>
        <span>Import a resolved staff chat, add a test, or clear filters.</span>
      </div>
    );
  }

  if (props.mobile) {
    return (
      <div aria-label="Evaluation case cards" className="eval-card-list">
        {table.getRowModel().rows.map((row) => {
          const evalCase = row.original;
          const running = props.runningCaseId === evalCase.id;
          return (
            <article
              aria-label={evalCase.title}
              className={[
                "eval-card",
                props.selectedCaseId === evalCase.id ? "eval-card--selected" : "",
                running ? "eval-card--running" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={evalCase.id}
              onClick={() => !props.runBlocked && props.onOpen(evalCase.id)}
              onKeyDown={(event) => openOnKeyboard(event, evalCase.id)}
              tabIndex={props.runBlocked ? -1 : 0}
            >
              <header>
                <div>
                  <strong>{evalCase.title}</strong>
                  <span>
                    <SourceLabel evalCase={evalCase} /> · <SplitLabel split={evalCase.split} />
                  </span>
                </div>
                <Result evalCase={evalCase} running={running} />
              </header>
              <div className="eval-card__context">
                <CaseTypeLabel type={evalCase.type} /> · {evalCase.language}
              </div>
              <CaseActions
                evalCase={evalCase}
                onCancel={props.onCancel}
                onDelete={props.onDelete}
                onDuplicate={props.onDuplicate}
                onEdit={props.onEdit}
                onRun={props.onRun}
                runBlocked={props.runBlocked}
                running={running}
              />
            </article>
          );
        })}
      </div>
    );
  }

  const ariaSort = (column: "item" | "grade") =>
    props.sort.column === column ? `${props.sort.direction}ending` as const : "none";

  return (
    <div className="eval-table-scroll" tabIndex={0}>
      <table aria-label="Evaluation cases" className="eval-table">
        <colgroup>
          <col className="eval-col-item" />
          <col className="eval-col-context" />
          <col className="eval-col-result" />
          <col className="eval-col-actions" />
        </colgroup>
        <thead>
          <tr>
            <th aria-sort={ariaSort("item")}>
              <button onClick={() => props.onSort("item")} type="button">Case</button>
            </th>
            <th>Patient context</th>
            <th aria-sort={ariaSort("grade")}>
              <button onClick={() => props.onSort("grade")} type="button">Result</button>
            </th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => {
            const evalCase = row.original;
            const running = props.runningCaseId === evalCase.id;
            return (
              <tr
                className={[
                  props.selectedCaseId === evalCase.id ? "eval-table__row--selected" : "",
                  running ? "eval-table__row--running" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={evalCase.id}
                onClick={() => !props.runBlocked && props.onOpen(evalCase.id)}
                onKeyDown={(event) => openOnKeyboard(event, evalCase.id)}
                tabIndex={props.runBlocked ? -1 : 0}
              >
                <td>
                  <strong className="eval-table__title">{evalCase.title}</strong>
                  <span className="eval-table__meta">
                    <SourceLabel evalCase={evalCase} /> · <SplitLabel split={evalCase.split} />
                  </span>
                </td>
                <td>
                  <CaseTypeLabel type={evalCase.type} />
                  <span className="eval-table__meta">{evalCase.language}</span>
                </td>
                <td><Result evalCase={evalCase} running={running} /></td>
                <td>
                  <CaseActions
                    evalCase={evalCase}
                    onCancel={props.onCancel}
                    onDelete={props.onDelete}
                    onDuplicate={props.onDuplicate}
                    onEdit={props.onEdit}
                    onRun={props.onRun}
                    runBlocked={props.runBlocked}
                    running={running}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
