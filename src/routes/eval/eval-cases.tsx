import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { Copy, Edit3, Play, Square, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { GlossaryTerm } from "../../components/glossary-term";
import type { EvalCase, EvalCaseId, EvalCaseType, EvalDataset } from "../../domain";
import {
  criteriaText,
  EVAL_GLOSSARY,
  formatCaseType,
  gradeLabel,
  inputText,
  type EvalSort,
} from "./eval-model";

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
  const verifyOnly = split === "holdout";
  return (
    <GlossaryTerm
      className="eval-split"
      definition={verifyOnly ? EVAL_GLOSSARY.verifyOnly : EVAL_GLOSSARY.improveWith}
    >
      {verifyOnly ? "Verify only" : "Improve with"}
    </GlossaryTerm>
  );
}

function PreviewField({
  label,
  text,
  compact = false,
  glossary,
}: {
  label: string;
  text: string;
  compact?: boolean;
  glossary?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const labelNode = glossary ? (
    <GlossaryTerm definition={glossary}>{label}</GlossaryTerm>
  ) : (
    label
  );
  return (
    <div className={`eval-preview${compact ? " eval-preview--compact" : ""}`}>
      <strong>{labelNode}</strong>
      <span className={expanded ? "eval-preview__text--expanded" : "eval-preview__text"}>
        {text || "Not run"}
      </span>
      {text.length > 72 ? (
        <button
          aria-expanded={expanded}
          className="eval-preview__toggle"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((current) => !current);
          }}
          type="button"
        >
          {expanded ? "Show less" : `Show full ${label.toLocaleLowerCase()}`}
        </button>
      ) : null}
    </div>
  );
}

function Grade({
  evalCase,
}: {
  evalCase: EvalCase;
}) {
  const label = gradeLabel(evalCase.grade);
  return (
    <div className="eval-grade">
      <span className={`eval-status eval-status--${label.toLocaleLowerCase().replace(" ", "-")}`}>
        {label}
      </span>
      <strong>{evalCase.grade ? evalCase.grade.judgeScore.toFixed(2) : "--"}</strong>
      <span>{evalCase.grade?.rationale ?? "Run this case to create a rationale."}</span>
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
  return (
    <div aria-label="Case actions" className="eval-case-actions" role="group">
      {running ? (
        <button aria-label="Cancel run" onClick={() => onCancel(evalCase.id)} type="button">
          <Square aria-hidden="true" size={14} />
          Cancel
        </button>
      ) : (
        <button
          aria-label={`Run ${evalCase.title}`}
          disabled={runBlocked}
          onClick={() => onRun(evalCase.id)}
          type="button"
        >
          <Play aria-hidden="true" size={14} />
          Run
        </button>
      )}
      <button
        aria-label={`Edit ${evalCase.title}`}
        onClick={() => onEdit(evalCase)}
        type="button"
      >
        <Edit3 aria-hidden="true" size={14} />
        Edit
      </button>
      <button
        aria-label={`Duplicate ${evalCase.title}`}
        onClick={() => onDuplicate(evalCase.id)}
        type="button"
      >
        <Copy aria-hidden="true" size={14} />
        Duplicate
      </button>
      <button
        aria-label={`Delete ${evalCase.title}`}
        onClick={() => onDelete(evalCase)}
        type="button"
      >
        <Trash2 aria-hidden="true" size={14} />
        Delete
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
  const columns = useMemo<ColumnDef<EvalCase>[]>(
    () => [
      { id: "item", accessorKey: "title" },
      { id: "type", accessorKey: "type" },
      { id: "language", accessorKey: "language" },
      { id: "input", accessorFn: inputText },
      { id: "expected", accessorKey: "expectedHumanOutput" },
      { id: "actual", accessorKey: "actualSyntheticOutput" },
      { id: "criteria", accessorFn: (evalCase) => criteriaText(props.dataset, evalCase) },
      { id: "grade", accessorFn: (evalCase) => evalCase.grade?.judgeScore },
      { id: "actions" },
    ],
    [props.dataset],
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
        <span>Add a case, import HITL evidence, or clear filters.</span>
      </div>
    );
  }

  if (props.mobile) {
    return (
      <div aria-label="Evaluation case cards" className="eval-card-list">
        {table.getRowModel().rows.map((row) => {
          const evalCase = row.original;
          return (
            <article
              aria-label={evalCase.title}
              className={[
                "eval-card",
                props.selectedCaseId === evalCase.id ? "eval-card--selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={evalCase.id}
            >
              <header>
                <div>
                  <button
                    className="eval-card__title"
                    disabled={props.runBlocked}
                    onClick={() => props.onOpen(evalCase.id)}
                    type="button"
                  >
                    {evalCase.title}
                  </button>
                  <span>
                    <SplitLabel split={evalCase.split} /> | <CaseTypeLabel type={evalCase.type} /> |{" "}
                    {evalCase.language}
                  </span>
                </div>
                <Grade evalCase={evalCase} />
              </header>
              <div
                aria-disabled={props.runBlocked}
                className="eval-card__body"
                onClick={() => {
                  if (!props.runBlocked) {
                    props.onOpen(evalCase.id);
                  }
                }}
              >
                <PreviewField compact label="Input" text={inputText(evalCase)} />
                <PreviewField
                  compact
                  glossary={EVAL_GLOSSARY.expectedHitl}
                  label="Expected human HITL"
                  text={evalCase.expectedHumanOutput}
                />
                <PreviewField
                  compact
                  glossary={EVAL_GLOSSARY.actualSynthetic}
                  label="Actual synthetic agent"
                  text={evalCase.actualSyntheticOutput ?? "Not run"}
                />
                <div className="eval-card__support-fields">
                  <PreviewField
                    compact
                    glossary={EVAL_GLOSSARY.scoringRules}
                    label="Checks"
                    text={criteriaText(props.dataset, evalCase)}
                  />
                  <PreviewField
                    compact
                    label="Rationale"
                    text={evalCase.grade?.rationale ?? "Not run"}
                  />
                </div>
              </div>
              <CaseActions
                evalCase={evalCase}
                onCancel={props.onCancel}
                onDelete={props.onDelete}
                onDuplicate={props.onDuplicate}
                onEdit={props.onEdit}
                onRun={props.onRun}
                runBlocked={props.runBlocked}
                running={props.runningCaseId === evalCase.id}
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
          <col className="eval-col-type" />
          <col className="eval-col-language" />
          <col className="eval-col-input" />
          <col className="eval-col-expected" />
          <col className="eval-col-actual" />
          <col className="eval-col-criteria" />
          <col className="eval-col-grade" />
          <col className="eval-col-actions" />
        </colgroup>
        <thead>
          <tr className="eval-table__groups">
            <th colSpan={3}>Item metadata</th>
            <th colSpan={3}>Sample</th>
            <th colSpan={2}>Testing</th>
            <th rowSpan={2}>Actions</th>
          </tr>
          <tr>
            <th aria-sort={ariaSort("item")}>
              <button onClick={() => props.onSort("item")} type="button">
                Item
              </button>
            </th>
            <th>
              <GlossaryTerm definition={EVAL_GLOSSARY.typeColumn}>Type</GlossaryTerm>
            </th>
            <th>Language</th>
            <th>
              <GlossaryTerm definition={EVAL_GLOSSARY.input}>Input</GlossaryTerm>
            </th>
            <th>
              <GlossaryTerm definition={EVAL_GLOSSARY.expectedHitl}>Expected HITL</GlossaryTerm>
            </th>
            <th>
              <GlossaryTerm definition={EVAL_GLOSSARY.actualSynthetic}>Actual synthetic</GlossaryTerm>
            </th>
            <th>
              <GlossaryTerm definition={EVAL_GLOSSARY.scoringRules}>Checks</GlossaryTerm>
            </th>
            <th aria-sort={ariaSort("grade")}>
              <button onClick={() => props.onSort("grade")} type="button">
                Grade
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => {
            const evalCase = row.original;
            return (
              <tr
                className={props.selectedCaseId === evalCase.id ? "eval-table__row--selected" : ""}
                key={evalCase.id}
              >
                <td>
                  <button
                    className="eval-table__title"
                    disabled={props.runBlocked}
                    onClick={() => props.onOpen(evalCase.id)}
                    type="button"
                  >
                    {evalCase.title}
                  </button>
                  <SplitLabel split={evalCase.split} />
                </td>
                <td>
                  <CaseTypeLabel type={evalCase.type} />
                </td>
                <td>{evalCase.language}</td>
                <td>
                  <PreviewField label="Input" text={inputText(evalCase)} />
                </td>
                <td>
                  <PreviewField
                    glossary={EVAL_GLOSSARY.expectedHitl}
                    label="Expected human HITL"
                    text={evalCase.expectedHumanOutput}
                  />
                </td>
                <td>
                  <PreviewField
                    glossary={EVAL_GLOSSARY.actualSynthetic}
                    label="Actual synthetic"
                    text={evalCase.actualSyntheticOutput ?? "Not run"}
                  />
                </td>
                <td>{criteriaText(props.dataset, evalCase)}</td>
                <td>
                  <Grade evalCase={evalCase} />
                </td>
                <td>
                  <CaseActions
                    evalCase={evalCase}
                    onCancel={props.onCancel}
                    onDelete={props.onDelete}
                    onDuplicate={props.onDuplicate}
                    onEdit={props.onEdit}
                    onRun={props.onRun}
                    runBlocked={props.runBlocked}
                    running={props.runningCaseId === evalCase.id}
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
