import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { useMediaQuery } from "../../app/use-media-query";
import {
  committedFailedTrainCases,
  type EvalCase,
  type EvalCaseId,
  type MutationResult,
} from "../../domain";
import { useAppStore } from "../../store/app-store-context";
import { OperationStatusBanner } from "../../components/operation-status";
import type { OperationStatus } from "../../contracts/workflow";
import { CaseDialog } from "./case-dialog";
import { CaseEvidence } from "./case-evidence";
import { CriteriaDialog } from "./criteria-dialog";
import { DatasetDialog, DeleteDatasetDialog } from "./dataset-dialogs";
import { DeleteCaseDialog } from "./delete-case-dialog";
import { EvalCases } from "./eval-cases";
import { AnalyzeFailuresDrawer, HistoryDrawer } from "./eval-drawers";
import { EvalFilterDrawer, EvalFiltersBar } from "./eval-filters";
import {
  nextSort,
  visibleEvalCases,
  type EvalFilters,
  type EvalSort,
} from "./eval-model";
import { ScoreSummary, SuiteHistory } from "./eval-support";
import { EvalToolbar } from "./eval-toolbar";
import { ImportHitlDialog } from "./import-hitl-dialog";
import "./eval.css";

const CLEAR_FILTERS: EvalFilters = {
  language: "all",
  query: "",
  result: "all",
  split: "all",
};

type ActiveOperation =
  | { kind: "case"; caseId: EvalCaseId; completed: number; total: number }
  | { kind: "suite"; completed: number; runningCaseId: EvalCaseId | null; total: number }
  | null;

type RetryOperation =
  | { kind: "case"; caseId: EvalCaseId }
  | { kind: "suite" }
  | null;

type Drawer = "analyze" | "evidence" | "filters" | "history" | null;

export default function EvalRoute() {
  const store = useAppStore((value) => value);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const mobile = useMediaQuery("(max-width: 899px)");
  const middle = useMediaQuery("(min-width: 900px) and (max-width: 1199px)");
  const narrowMobile = useMediaQuery("(max-width: 339px)");
  const [filters, setFilters] = useState<EvalFilters>(CLEAR_FILTERS);
  const [sort, setSort] = useState<EvalSort>({ column: "item", direction: "asc" });
  const [drawer, setDrawer] = useState<Drawer>(store.routeUi.evalDrawer);
  const [selectedCaseId, setSelectedCaseId] = useState<EvalCaseId | null>(
    store.routeUi.evalCaseId as EvalCaseId | null,
  );
  const [caseDialogOpen, setCaseDialogOpen] = useState(false);
  const [editingCase, setEditingCase] = useState<EvalCase | null>(null);
  const [deleteCase, setDeleteCase] = useState<EvalCase | null>(null);
  const [datasetDialog, setDatasetDialog] = useState<"create" | "rename" | null>(null);
  const [deleteDatasetOpen, setDeleteDatasetOpen] = useState(false);
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [preferredImportId, setPreferredImportId] = useState<string | null>(null);
  const [operation, setOperation] = useState<ActiveOperation>(null);
  const [retryOperation, setRetryOperation] = useState<RetryOperation>(null);
  const [feedback, setFeedback] = useState("");
  const [proposalCorrectionId, setProposalCorrectionId] = useState<string | null>(null);
  const [executionCapability, setExecutionCapability] = useState({
    enabled: true,
    reason: null as string | null,
  });
  const operationToken = useRef(0);
  const operationController = useRef<AbortController | null>(null);
  const activeOperation = useRef<ActiveOperation>(null);

  const dataset =
    store.state.evalDatasets.find(
      (candidate) => candidate.id === store.state.selections.evalDatasetId,
    ) ?? store.state.evalDatasets[0];

  const cases = useMemo(
    () => (dataset ? visibleEvalCases(dataset, filters, sort) : []),
    [dataset, filters, sort],
  );
  const selectedCase = dataset?.cases.find((evalCase) => evalCase.id === selectedCaseId) ?? null;
  const canAnalyze = dataset ? committedFailedTrainCases(dataset).length > 0 : false;
  const languages = useMemo(
    () => [...new Set((dataset?.cases ?? []).map((evalCase) => evalCase.language))].sort(),
    [dataset],
  );

  useEffect(() => {
    const controller = new AbortController();
    void store.refreshEvalWorkspace(controller.signal);
    void store.getEvalExecutionCapability(controller.signal).then((capability) => {
      if (!controller.signal.aborted) {
        setExecutionCapability(capability);
        if (!capability.enabled) {
          setFeedback(capability.reason ?? "Eval execution is unavailable.");
        }
      }
    });
    return () => controller.abort();
  }, [store.getEvalExecutionCapability, store.refreshEvalWorkspace]);

  useEffect(() => {
    if (selectedCaseId && !dataset?.cases.some((evalCase) => evalCase.id === selectedCaseId)) {
      setSelectedCaseId(null);
      setDrawer(null);
    }
  }, [dataset, selectedCaseId]);

  useEffect(() => {
    const datasetId = searchParams.get("dataset");
    const caseId = searchParams.get("case");
    const importId = searchParams.get("import");
    if (!datasetId && !caseId && !importId) {
      return;
    }

    const caseOwner = caseId
      ? store.state.evalDatasets.find((candidate) =>
          candidate.cases.some((evalCase) => evalCase.id === caseId),
        )
      : undefined;
    const targetDataset =
      caseOwner ??
      store.state.evalDatasets.find((candidate) => candidate.id === datasetId) ??
      dataset;
    if (targetDataset && targetDataset.id !== dataset?.id) {
      store.selectEvalDataset(targetDataset.id);
    }
    if (caseId && targetDataset?.cases.some((evalCase) => evalCase.id === caseId)) {
      setSelectedCaseId(caseId);
      setDrawer("evidence");
    }
    if (importId) {
      setPreferredImportId(importId);
      setImportOpen(true);
    }
    setSearchParams({}, { replace: true });
  }, [dataset, searchParams, setSearchParams, store]);

  useEffect(() => {
    store.updateRouteUi({
      evalCaseId: selectedCaseId,
      evalDrawer: drawer === "evidence" ? "evidence" : null,
    });
  }, [drawer, selectedCaseId, store.updateRouteUi]);

  useEffect(() => {
    if (store.resetVersion === 0) {
      return;
    }
    operationToken.current += 1;
    operationController.current?.abort();
    operationController.current = null;
    activeOperation.current = null;
    setOperation(null);
    setFilters(CLEAR_FILTERS);
    setSort({ column: "item", direction: "asc" });
    setSelectedCaseId(null);
    setDrawer(null);
    setCaseDialogOpen(false);
    setEditingCase(null);
    setDeleteCase(null);
    setDatasetDialog(null);
    setDeleteDatasetOpen(false);
    setCriteriaOpen(false);
    setImportOpen(false);
    setPreferredImportId(null);
    setRetryOperation(null);
    setFeedback("");
    setProposalCorrectionId(null);
  }, [store.resetVersion]);

  useEffect(
    () => () => {
      operationToken.current += 1;
      operationController.current?.abort();
    },
    [],
  );

  if (!dataset) {
    return (
      <section aria-labelledby="eval-route-title" className="eval-route">
        <h1 id="eval-route-title">Evaluation Lab</h1>
        <p role="alert">No synthetic dataset is available. Reset the demo from Chat Control.</p>
      </section>
    );
  }

  const report = (result: MutationResult) => {
    setFeedback(result.ok ? "" : result.error);
    return result;
  };

  const schedule = (
    active: Exclude<ActiveOperation, null>,
    execute: (
      signal: AbortSignal,
      onCaseStart: (caseId: EvalCaseId, completed: number, total: number) => void,
      onProgress: (completed: number, total: number) => void,
    ) => Promise<MutationResult>,
  ) => {
    if (!executionCapability.enabled) {
      setFeedback(executionCapability.reason ?? "Eval execution is unavailable.");
      return;
    }
    if (activeOperation.current) {
      setFeedback("Finish or cancel the active evaluation operation first.");
      return;
    }
    const token = operationToken.current + 1;
    const controller = new AbortController();
    operationToken.current = token;
    operationController.current = controller;
    activeOperation.current = active;
    setOperation(active);
    setRetryOperation(
      active.kind === "case"
        ? { kind: "case", caseId: active.caseId }
        : { kind: "suite" },
    );
    setFeedback("");

    const updateProgress = (completed: number, total: number) => {
      const current = activeOperation.current;
      if (!current) {
        return;
      }
      const next = { ...current, completed, total };
      activeOperation.current = next;
      setOperation(next);
    };

    const updateCaseStart = (caseId: EvalCaseId, completed: number, total: number) => {
      const current = activeOperation.current;
      if (!current || current.kind !== "suite") {
        return;
      }
      const next = { ...current, completed, runningCaseId: caseId, total };
      activeOperation.current = next;
      setOperation(next);
    };

    void new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      .then(() => execute(controller.signal, updateCaseStart, updateProgress))
      .then((result) => {
        if (operationToken.current !== token) {
          return;
        }
        report(result);
        operationController.current = null;
        activeOperation.current = null;
        setOperation(null);
      });
  };

  const cancelOperation = () => {
    const current = activeOperation.current;
    if (!current) {
      return;
    }
    operationToken.current += 1;
    operationController.current?.abort();
    operationController.current = null;
    activeOperation.current = null;
    setOperation(null);
    setFeedback("Evaluation canceled.");
  };

  const openCase = (caseId: EvalCaseId) => {
    if (activeOperation.current) {
      setFeedback("Finish or cancel the active evaluation operation before opening case evidence.");
      return;
    }
    setSelectedCaseId(caseId);
    setDrawer("evidence");
  };

  const duplicateEvalCase = (caseId: EvalCaseId) => {
    const beforeIds = new Set(dataset.cases.map((evalCase) => evalCase.id));
    const result = store.duplicateCase(caseId);
    report(result);
    if (!result.ok) {
      return;
    }
    const added = result.state.evalDatasets
      .find((candidate) => candidate.id === dataset.id)
      ?.cases.find((evalCase) => !beforeIds.has(evalCase.id));
    if (added) {
      report(store.editCase(added.id, { title: `${added.title} copy` }));
      setSelectedCaseId(added.id);
    }
  };

  const runCase = (caseId: EvalCaseId) => {
    schedule(
      { caseId, completed: 0, kind: "case", total: 1 },
      async (signal, _onCaseStart, onProgress) => {
        const result = await store.runEvalCase(caseId, { signal });
        if (result.ok) {
          onProgress(1, 1);
        }
        return result;
      },
    );
  };

  const runSuite = () => {
    schedule(
      { completed: 0, kind: "suite", runningCaseId: null, total: dataset.cases.length },
      (signal, onCaseStart, onProgress) =>
        store.runEvalSuite(dataset.id, { onCaseStart, onProgress, signal }),
    );
  };

  const retryLastOperation = () => {
    if (retryOperation?.kind === "case") {
      runCase(retryOperation.caseId);
    } else if (retryOperation?.kind === "suite") {
      runSuite();
    }
  };

  const runningCaseId = operation?.kind === "case"
    ? operation.caseId
    : operation?.kind === "suite"
      ? operation.runningCaseId
      : null;
  const runningCase = runningCaseId
    ? dataset.cases.find((evalCase) => evalCase.id === runningCaseId)
    : null;
  const operationStatus: OperationStatus | null = operation
    ? {
        scope: "eval",
        state: "running",
        message:
          operation.kind === "case"
            ? "Running case judge"
            : runningCase
              ? `Replaying ${runningCase.title} / ${operation.completed + 1} of ${operation.total}`
              : `Preparing suite replay / ${operation.completed} of ${operation.total}`,
        action: "cancel",
        actionLabel: "Cancel",
      }
    : proposalCorrectionId
      ? {
          scope: "eval",
          state: "succeeded",
          message:
            "SOP correction proposed. Nothing is active yet. Review the exact diff in Knowledge.",
          action: null,
          actionLabel: null,
          knowledgeCorrectionId: proposalCorrectionId,
          linkActionLabel: "Open Knowledge correction",
        }
    : feedback
      ? {
          scope: "eval",
          state: feedback === "Evaluation canceled." ? "canceled" : "failed",
          message: feedback,
          action:
            feedback !== "Evaluation canceled." && retryOperation !== null
              ? "retry"
              : null,
          actionLabel:
            feedback !== "Evaluation canceled." && retryOperation !== null
              ? "Retry"
              : null,
        }
      : null;

  return (
    <section aria-labelledby="eval-route-title" className="eval-route">
      <EvalToolbar
        canAnalyze={canAnalyze}
        caseSelected={selectedCaseId !== null || drawer === "analyze"}
        datasets={store.state.evalDatasets}
        operationBlocked={operation !== null}
        onAddCase={() => {
          setEditingCase(null);
          setCaseDialogOpen(true);
        }}
        onCancelSuite={cancelOperation}
        onDeleteDataset={() => setDeleteDatasetOpen(true)}
        onEditCriteria={() => setCriteriaOpen(true)}
        onHistory={() => setDrawer("history")}
        onImport={() => {
          setPreferredImportId(null);
          setImportOpen(true);
        }}
        onAnalyze={() => setDrawer("analyze")}
        onNewDataset={() => setDatasetDialog("create")}
        onRenameDataset={() => setDatasetDialog("rename")}
        onRunSuite={runSuite}
        onSelectDataset={(datasetId) => {
          cancelOperation();
          store.selectEvalDataset(datasetId);
          setSelectedCaseId(null);
          setDrawer(null);
          setFilters(CLEAR_FILTERS);
        }}
        selectedId={dataset.id}
        showHistory={mobile}
        suiteBlocked={
          dataset.cases.length === 0 || operation !== null || !executionCapability.enabled
        }
        suiteBlockedReason={
          !executionCapability.enabled
            ? executionCapability.reason ?? "Eval execution is unavailable."
            : undefined
        }
        suiteRunning={operation?.kind === "suite"}
      />

      {mobile ? (
        <section aria-label="Eval overview" className="eval-overview">
          <ScoreSummary dataset={dataset} />
        </section>
      ) : null}

      <EvalFiltersBar
        filters={filters}
        languages={languages}
        onChange={setFilters}
        onOpenDrawer={() => setDrawer("filters")}
      />

      <OperationStatusBanner
        actionAriaLabel={
          operation
            ? `Cancel active ${operation.kind} operation`
            : retryOperation
              ? "Retry last evaluation run"
              : undefined
        }
        onAction={operation ? cancelOperation : retryOperation ? retryLastOperation : undefined}
        status={operationStatus}
      />

      <div className={`eval-workbench${middle ? " eval-workbench--middle" : ""}`}>
        {middle ? (
          <section aria-label="Evaluation support" className="eval-middle-support">
            <ScoreSummary dataset={dataset} />
            <SuiteHistory dataset={dataset} />
          </section>
        ) : null}
        <section aria-label="Raw evaluation cases" className="eval-case-surface">
          <div className="eval-case-surface__heading">
            <div>
              <strong>Cases</strong>
              <span>
                {cases.length} of {dataset.cases.length} visible
              </span>
            </div>
            <span>Open a case for its latest run and evidence.</span>
          </div>
          <EvalCases
            cases={cases}
            dataset={dataset}
            mobile={mobile}
            onCancel={cancelOperation}
            onDelete={setDeleteCase}
            onDuplicate={duplicateEvalCase}
            onEdit={(evalCase) => {
              setEditingCase(evalCase);
              setCaseDialogOpen(true);
            }}
            onOpen={openCase}
            onRun={runCase}
            onSort={(column) => setSort((current) => nextSort(current, column))}
            runningCaseId={runningCaseId}
            runBlocked={operation !== null || !executionCapability.enabled}
            selectedCaseId={selectedCaseId}
            sort={sort}
          />
        </section>
        {!mobile && !middle ? (
          <aside aria-label="Evaluation support" className="eval-support-rail">
            <ScoreSummary dataset={dataset} />
            <SuiteHistory dataset={dataset} />
          </aside>
        ) : null}
      </div>

      {drawer === "filters" && narrowMobile ? (
        <EvalFilterDrawer
          filters={filters}
          languages={languages}
          onChange={setFilters}
          onClear={() => setFilters(CLEAR_FILTERS)}
          onClose={() => setDrawer(null)}
        />
      ) : null}
      {drawer === "history" ? (
        <HistoryDrawer dataset={dataset} onClose={() => setDrawer(null)} />
      ) : null}
      {drawer === "analyze" ? (
        <AnalyzeFailuresDrawer
          corrections={store.state.corrections}
          dataset={dataset}
          key={dataset.id}
          onAnalyze={async () => {
            const result = await store.proposeCorrections(dataset.id);
            if (result.ok && typeof result.correctionId === "string") {
              setProposalCorrectionId(result.correctionId);
            }
            return result;
          }}
          onClose={() => setDrawer(null)}
          onOpenKnowledge={(correction) => navigate(`/knowledge?correction=${correction.id}`)}
          operationBlocked={operation !== null}
        />
      ) : null}
      {drawer === "evidence" && selectedCase ? (
        <CaseEvidence
          corrections={store.state.corrections}
          dataset={dataset}
          evalCase={selectedCase}
          operationBlocked={operation !== null || !executionCapability.enabled}
          onCancel={cancelOperation}
          onClose={() => setDrawer(null)}
          onDelete={setDeleteCase}
          onDuplicate={duplicateEvalCase}
          onEdit={(evalCase) => {
            setEditingCase(evalCase);
            setCaseDialogOpen(true);
          }}
          onOpenKnowledge={(correction) => navigate(`/knowledge?correction=${correction.id}`)}
          onRun={(caseId) =>
            schedule(
              { caseId, completed: 0, kind: "case", total: 1 },
                async (signal, _onCaseStart, onProgress) => {
                const result = await store.runEvalCase(caseId, { signal });
                if (result.ok) {
                  onProgress(1, 1);
                }
                return result;
              },
            )
          }
          running={operation?.kind === "case" && operation.caseId === selectedCase.id}
        />
      ) : null}

      <CaseDialog
        dataset={dataset}
        editing={editingCase}
        onAdd={(input) => {
          const beforeIds = new Set(dataset.cases.map((evalCase) => evalCase.id));
          const result = store.addCase(input);
          report(result);
          if (result.ok) {
            const added = result.state.evalDatasets
              .find((candidate) => candidate.id === dataset.id)
              ?.cases.find((evalCase) => !beforeIds.has(evalCase.id));
            setSelectedCaseId(added?.id ?? null);
          }
          return result;
        }}
        onEdit={(caseId, input) => report(store.editCase(caseId, input))}
        onOpenChange={setCaseDialogOpen}
        open={caseDialogOpen}
      />
      <DeleteCaseDialog
        evalCase={deleteCase}
        onDelete={() => {
          if (!deleteCase) {
            return { error: "No case selected.", ok: false, state: store.state };
          }
          const result = report(store.deleteCase(deleteCase.id, { confirmed: true }));
          if (result.ok) {
            setDeleteCase(null);
          }
          return result;
        }}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteCase(null);
          }
        }}
      />
      <DatasetDialog
        dataset={dataset}
        mode={datasetDialog ?? "create"}
        onCreate={(name) => {
          const result = report(store.addDataset({ name }));
          return result;
        }}
        onOpenChange={(open) => setDatasetDialog(open ? datasetDialog ?? "create" : null)}
        onRename={(name) => report(store.renameDataset({ datasetId: dataset.id, name }))}
        open={datasetDialog !== null}
      />
      <DeleteDatasetDialog
        dataset={dataset}
        onDelete={() => report(store.deleteDataset({ confirmed: true, datasetId: dataset.id }))}
        onOpenChange={setDeleteDatasetOpen}
        open={deleteDatasetOpen}
      />
      <CriteriaDialog
        dataset={dataset}
        onAdd={(input) => report(store.addCriterion(dataset.id, input))}
        onDelete={(criterionId) => report(store.deleteCriterion(criterionId))}
        onEdit={(criterionId, input) =>
          report(store.editCriterion(criterionId, input))
        }
        onOpenChange={setCriteriaOpen}
        open={criteriaOpen}
      />
      <ImportHitlDialog
        conversations={store.state.conversations}
        dataset={dataset}
        onImport={(conversationIds) => {
          const beforeIds = new Set(dataset.cases.map((evalCase) => evalCase.id));
          const result = store.importHitlConversations(conversationIds);
          if (result.ok) {
            const added =
              result.state.evalDatasets
                .find((candidate) => candidate.id === dataset.id)
                ?.cases.filter((evalCase) => !beforeIds.has(evalCase.id)) ?? [];
            if (added.length === 1) {
              setSelectedCaseId(added[0]!.id);
              window.setTimeout(() => setDrawer("evidence"), 0);
              report(result);
              return result;
            }
            setSelectedCaseId(null);
            setDrawer(null);
          }
          report(result);
          return result;
        }}
        onOpenChange={setImportOpen}
        open={importOpen}
        preferredConversationId={preferredImportId}
      />
    </section>
  );
}
