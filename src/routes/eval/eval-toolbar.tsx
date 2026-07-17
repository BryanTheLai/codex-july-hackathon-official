import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Beaker,
  ChevronDown,
  FlaskConical,
  MoreHorizontal,
  Plus,
  Square,
} from "lucide-react";

import type { EvalDataset, EvalDatasetId } from "../../domain";

export function EvalToolbar({
  canAnalyze,
  caseSelected,
  datasets,
  operationBlocked,
  selectedId,
  suiteRunning,
  suiteBlocked,
  suiteBlockedReason,
  showHistory,
  onAddCase,
  onCancelSuite,
  onDeleteDataset,
  onEditCriteria,
  onHistory,
  onImport,
  onAnalyze,
  onNewDataset,
  onRenameDataset,
  onRunSuite,
  onSelectDataset,
}: {
  canAnalyze: boolean;
  caseSelected: boolean;
  datasets: EvalDataset[];
  operationBlocked: boolean;
  selectedId: EvalDatasetId;
  suiteRunning: boolean;
  suiteBlocked: boolean;
  suiteBlockedReason?: string;
  showHistory: boolean;
  onAddCase: () => void;
  onCancelSuite: () => void;
  onDeleteDataset: () => void;
  onEditCriteria: () => void;
  onHistory: () => void;
  onImport: () => void;
  onAnalyze: () => void;
  onNewDataset: () => void;
  onRenameDataset: () => void;
  onRunSuite: () => void;
  onSelectDataset: (datasetId: EvalDatasetId) => void;
}) {
  return (
    <header className="eval-toolbar">
      <div className="eval-toolbar__title">
        <h1 id="eval-route-title">Evaluation Lab</h1>
      </div>
      <label className="eval-toolbar__dataset">
        <span className="visually-hidden">Dataset</span>
        <select
          aria-label="Dataset"
          onChange={(event) => onSelectDataset(event.target.value)}
          value={selectedId}
        >
          {datasets.map((dataset) => (
            <option key={dataset.id} value={dataset.id}>
              {dataset.name}
              {dataset.protected ? " - synthetic seed" : ""}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden="true" size={14} />
      </label>
      <div className="eval-toolbar__actions">
        <button
          aria-label="New manual test"
          className="eval-button"
          disabled={operationBlocked}
          onClick={onAddCase}
          type="button"
        >
          <Plus aria-hidden="true" size={15} />
          <span className="eval-label-full">New manual test</span>
          <span className="eval-label-compact">+ Test</span>
        </button>
        <button
          aria-label={canAnalyze ? "Analyze failures" : "Run a failed train case first"}
          className="eval-button"
          disabled={operationBlocked || !canAnalyze}
          onClick={onAnalyze}
          title={canAnalyze ? undefined : "Run train cases and commit at least one failure first."}
          type="button"
        >
          <Beaker aria-hidden="true" size={15} />
          <span className="eval-label-full">
            {canAnalyze ? "Analyze failures" : "Run train cases first"}
          </span>
          <span className="eval-label-compact">{canAnalyze ? "Analyze" : "Run first"}</span>
        </button>
        {suiteRunning ? (
          <button
            className="eval-button eval-button--risk"
            onClick={onCancelSuite}
            type="button"
          >
            <Square aria-hidden="true" size={14} />
            Cancel suite
          </button>
        ) : (
          <button
            aria-label="Run all cases"
            className={`eval-button${caseSelected ? "" : " eval-button--primary"}`}
            disabled={suiteBlocked}
            onClick={onRunSuite}
            title={
              suiteBlocked
                ? suiteBlockedReason ?? "Add at least one case before running the suite."
                : undefined
            }
            type="button"
          >
            <FlaskConical aria-hidden="true" size={15} />
            <span className="eval-label-full">Run all cases</span>
            <span className="eval-label-compact">Run all</span>
          </button>
        )}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              aria-label="More evaluation actions"
              className="eval-button"
              disabled={operationBlocked}
              type="button"
            >
              <MoreHorizontal aria-hidden="true" size={17} />
              <span className="eval-label-full">More</span>
              <span className="eval-label-compact">More</span>
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" className="eval-menu" sideOffset={4}>
              <DropdownMenu.Item
                className="eval-menu__item eval-menu__import"
                onSelect={onImport}
              >
                Import resolved conversations
              </DropdownMenu.Item>
              <DropdownMenu.Item className="eval-menu__item" onSelect={onNewDataset}>
                New Dataset
              </DropdownMenu.Item>
              <DropdownMenu.Item className="eval-menu__item" onSelect={onRenameDataset}>
                Rename Dataset
              </DropdownMenu.Item>
              <DropdownMenu.Item className="eval-menu__item" onSelect={onDeleteDataset}>
                Delete Dataset
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="eval-menu__separator" />
              <DropdownMenu.Item className="eval-menu__item" onSelect={onEditCriteria}>
                Scoring rules
              </DropdownMenu.Item>
              {showHistory ? (
                <DropdownMenu.Item className="eval-menu__item" onSelect={onHistory}>
                  History
                </DropdownMenu.Item>
              ) : null}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );
}
