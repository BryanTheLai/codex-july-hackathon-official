import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useNavigate, useSearchParams } from "react-router";

import { useMediaQuery } from "../../app/use-media-query";
import type { Correction, MutationResult } from "../../domain";
import { useAppStore } from "../../store/app-store-context";
import { ChangesPane } from "./changes-pane";
import {
  DeleteFileDialog,
  DiscardDraftDialog,
  FileDialog,
  FolderDialog,
} from "./dream-dialogs";
import {
  fileCorrections,
  pendingCount,
  type DreamPane,
  type TestDockState,
} from "./dream-model";
import { DreamToolbar } from "./dream-toolbar";
import { FileListPane } from "./file-list-pane";
import { TestDock } from "./test-dock";
import "./dream.css";

const PANES: DreamPane[] = ["files", "editor", "changes"];
const fileParentPath = (path: string) => path.split("/").slice(0, -1).join("/");
const EditorPane = lazy(async () => {
  const module = await import("./editor-pane");
  return { default: module.EditorPane };
});

export default function DreamRoute() {
  const store = useAppStore((value) => value);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const mobile = useMediaQuery("(max-width: 999px)");
  const narrowMobile = useMediaQuery("(max-width: 339px)");
  const [pane, setPane] = useState<DreamPane>(store.routeUi.dreamPane);
  const [focusedCorrectionId, setFocusedCorrectionId] = useState<string | null>(
    store.routeUi.dreamCorrectionId,
  );
  const [focusLine, setFocusLine] = useState<number | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [fileDialog, setFileDialog] = useState<"create" | "rename" | null>(null);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [selectedFolderPath, setSelectedFolderPath] = useState(() => {
    const selected = store.state.playbookFiles.find(
      (file) => file.id === store.state.selections.playbookFileId,
    );
    return selected ? fileParentPath(selected.path) : "playbooks";
  });
  const [revealPath, setRevealPath] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [testDock, setTestDock] = useState<TestDockState>({ status: "closed" });
  const testToken = useRef(0);
  const testTimer = useRef<number | null>(null);
  const progressTimer = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);

  const selectedFile =
    store.state.playbookFiles.find(
      (file) => file.id === store.state.selections.playbookFileId,
    ) ?? null;
  const corrections = useMemo(
    () =>
      selectedFile
        ? fileCorrections(store.state.corrections, selectedFile.id)
        : [],
    [selectedFile, store.state.corrections],
  );
  const linkedDatasetId =
    store.state.evalDatasets.find((dataset) =>
      dataset.cases.some((evalCase) =>
        corrections.some((correction) => correction.sourceCaseId === evalCase.id),
      ),
    )?.id ?? null;
  const query = searchParams.toString();

  const clearTestTimers = () => {
    if (testTimer.current !== null) {
      window.clearTimeout(testTimer.current);
      testTimer.current = null;
    }
    if (progressTimer.current !== null) {
      window.clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
  };

  useEffect(() => {
    store.updateRouteUi({
      dreamCorrectionId: focusedCorrectionId,
      dreamPane: pane,
    });
  }, [focusedCorrectionId, pane, store.updateRouteUi]);

  useEffect(() => {
    if (store.resetVersion === 0) {
      return;
    }
    testToken.current += 1;
    clearTestTimers();
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setPane("files");
    setFocusedCorrectionId(null);
    setFocusLine(null);
    setTestDock({ status: "closed" });
    setFileDialog(null);
    setFolderDialogOpen(false);
    setSelectedFolderPath("playbooks");
    setRevealPath(null);
    setDeleteOpen(false);
    setDiscardOpen(false);
    setSaving(false);
    setFeedback("");
  }, [store.resetVersion]);

  useEffect(() => {
    if (!query) {
      return;
    }
    const correctionId = searchParams.get("correction");
    const fileId = searchParams.get("file");
    const correction = store.state.corrections.find(
      (candidate) => candidate.id === correctionId,
    );
    const file = correction
      ? store.state.playbookFiles.find((candidate) => candidate.id === correction.fileId)
      : store.state.playbookFiles.find((candidate) => candidate.id === fileId);
    if (file) {
      store.selectPlaybookFile(file.id);
      setSelectedFolderPath(fileParentPath(file.path));
      setPane(correction ? "changes" : "editor");
    }
    if (correction) {
      setFocusedCorrectionId(correction.id);
    }
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [query]);

  useEffect(
    () => () => {
      testToken.current += 1;
      clearTestTimers();
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
      }
    },
    [],
  );

  const report = (result: MutationResult) => {
    setFeedback(result.ok ? "" : result.error);
    return result;
  };

  const cancelTest = () => {
    testToken.current += 1;
    clearTestTimers();
  };

  const closeTest = () => {
    cancelTest();
    setTestDock({ status: "closed" });
  };

  const runTest = () => {
    if (!selectedFile) {
      return;
    }
    cancelTest();
    const token = testToken.current;
    const total = Math.max(corrections.length, 1);
    setPane("editor");
    setTestDock({ completed: 0, status: "preparing", total });
    let completed = 0;
    progressTimer.current = window.setInterval(() => {
      completed = Math.min(completed + 1, total);
      setTestDock({ completed, status: "running", total });
    }, 70);
    testTimer.current = window.setTimeout(() => {
      if (token !== testToken.current) {
        return;
      }
      clearTestTimers();
      const result = store.runTestChanges(selectedFile.id);
      if (!result.ok) {
        setTestDock({ message: result.error, status: "error" });
        return;
      }
      setTestDock({ result: result.result, stale: false, status: "complete" });
    }, 220 + total * 70);
  };

  const save = () => {
    if (!selectedFile?.draft || saving) {
      if (selectedFile?.draft === "") {
        report(store.savePlaybookDraft(selectedFile.id));
      }
      return;
    }
    setSaving(true);
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
    }
    const fileId = selectedFile.id;
    saveTimer.current = window.setTimeout(() => {
      const result = report(store.savePlaybookDraft(fileId));
      setSaving(false);
      if (result.ok) {
        cancelTest();
        setTestDock((current) =>
          current.status === "complete"
            ? { ...current, stale: true }
            : current.status === "closed"
              ? current
              : { message: "Saved text changed. Run Test Changes again.", status: "error" },
        );
      }
    }, 140);
  };

  const chooseFile = (fileId: string) => {
    cancelTest();
    setTestDock({ status: "closed" });
    store.selectPlaybookFile(fileId);
    const file = store.state.playbookFiles.find((candidate) => candidate.id === fileId);
    if (file) {
      setSelectedFolderPath(fileParentPath(file.path));
    }
    setFocusedCorrectionId(null);
    if (mobile) {
      setPane("editor");
    }
  };

  const focusCorrection = (correction: Correction, line: number) => {
    setFocusedCorrectionId(correction.id);
    setFocusLine(line);
    setFocusRequest((current) => current + 1);
    if (mobile) {
      setPane("editor");
    }
  };

  const decideCorrection = (
    correction: Correction,
    decide: (correctionId: string) => MutationResult,
  ) => {
    const result = report(decide(correction.id));
    if (!result.ok || testDock.status === "closed") {
      return;
    }
    cancelTest();
    setTestDock((current) =>
      current.status === "complete"
        ? { ...current, stale: true }
        : { message: "Correction state changed. Run Test Changes again.", status: "error" },
    );
  };

  const tabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: DreamPane) => {
    const currentIndex = PANES.indexOf(current);
    const target =
      event.key === "Home"
        ? PANES[0]
        : event.key === "End"
          ? PANES[PANES.length - 1]
          : event.key === "ArrowRight"
            ? PANES[(currentIndex + 1) % PANES.length]
            : event.key === "ArrowLeft"
              ? PANES[(currentIndex - 1 + PANES.length) % PANES.length]
              : null;
    if (!target) {
      return;
    }
    event.preventDefault();
    setPane(target);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`[data-pane="${target}"]`)
      ?.focus();
  };

  const dock =
    testDock.status === "closed" ? null : (
      <TestDock
        corrections={corrections}
        datasetId={linkedDatasetId}
        file={selectedFile}
        onClose={closeTest}
        onOpenEval={(caseId) => navigate(`/eval?case=${caseId}`)}
        onOpenDataset={(datasetId) => navigate(`/eval?dataset=${datasetId}`)}
        onRun={runTest}
        state={testDock}
      />
    );

  const filesPane = (
    <FileListPane
      corrections={store.state.corrections}
      files={store.state.playbookFiles}
      folders={store.state.playbookFolders}
      onCreateFile={() => setFileDialog("create")}
      onCreateFolder={() => setFolderDialogOpen(true)}
      onSelect={chooseFile}
      onSelectFolder={setSelectedFolderPath}
      revealPath={revealPath}
      selectedFolderPath={selectedFolderPath}
      selectedId={selectedFile?.id ?? null}
    />
  );
  const editorPane = (
    <Suspense fallback={<div className="dream-editor-loading" role="status">Loading Markdown editor</div>}>
      <EditorPane
        corrections={corrections}
        dock={dock}
        file={selectedFile}
        focusedCorrectionId={focusedCorrectionId}
        focusLine={focusLine}
        focusRequest={focusRequest}
        onChange={(value) => {
          if (selectedFile) {
            report(store.setPlaybookDraft(selectedFile.id, value));
          }
        }}
        onSave={save}
      />
    </Suspense>
  );
  const changesPane = (
    <ChangesPane
      corrections={corrections}
      file={selectedFile}
      focusedCorrectionId={focusedCorrectionId}
      onApprove={(correction) =>
        decideCorrection(correction, store.approveCorrection)
      }
      onFocus={focusCorrection}
      onOpenEval={(caseId) => navigate(`/eval?case=${caseId}`)}
      onReject={(correction) =>
        decideCorrection(correction, store.rejectCorrection)
      }
    />
  );

  return (
    <section aria-labelledby="dream-route-title" className="route-root dream-route">
      <DreamToolbar
        file={selectedFile}
        onDelete={() => setDeleteOpen(true)}
        onDiscard={() => setDiscardOpen(true)}
        onNew={() => setFileDialog("create")}
        onRename={() => setFileDialog("rename")}
        onSave={save}
        onTest={runTest}
        pending={pendingCount(store.state.corrections, selectedFile?.id)}
        saving={saving}
      />
      {feedback ? <p className="dream-feedback" role="alert">{feedback}</p> : null}
      {mobile ? (
        <div aria-label="Dream panes" className="dream-tabs" role="tablist">
          {PANES.map((item) => (
            <button
              aria-label={item === "files" ? "Files" : item === "editor" ? "Editor" : "Changes"}
              aria-controls={`dream-panel-${item}`}
              aria-selected={pane === item}
              data-pane={item}
              id={`dream-tab-${item}`}
              key={item}
              onClick={() => setPane(item)}
              onKeyDown={(event) => tabKeyDown(event, item)}
              role="tab"
              tabIndex={pane === item ? 0 : -1}
              type="button"
            >
              {item === "files" ? "Files" : item === "editor" ? "Editor" : "Changes"}
              {item === "changes" && pendingCount(corrections) > 0 ? (
                <b>{pendingCount(corrections)}</b>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      <div
        aria-label="Dream workbench"
        className={`route-workbench dream-workbench${mobile ? " dream-workbench--mobile" : ""}`}
      >
        {mobile ? (
          <div
            aria-labelledby={`dream-tab-${pane}`}
            className="dream-mobile-panel"
            id={`dream-panel-${pane}`}
            role="tabpanel"
          >
            {pane === "files" ? filesPane : pane === "editor" ? editorPane : changesPane}
          </div>
        ) : (
          <>
            {filesPane}
            {editorPane}
            {changesPane}
          </>
        )}
      </div>
      <FileDialog
        file={selectedFile}
        initialPath={`${selectedFolderPath}/`}
        mode={fileDialog ?? "create"}
        onCreate={(path, title) => {
          const result = report(store.createPlaybookFile({ path, title }));
          if (result.ok) {
            setSelectedFolderPath(fileParentPath(path));
            setRevealPath(path);
          }
          if (result.ok && mobile) {
            setPane("editor");
          }
          return result;
        }}
        onOpenChange={(open) => !open && setFileDialog(null)}
        onRename={(path, title) =>
          selectedFile
            ? report(store.renamePlaybookFile({ fileId: selectedFile.id, path, title }))
            : ({ error: "No file selected", ok: false, state: store.state })
        }
        open={fileDialog !== null}
      />
      <FolderDialog
        onCreate={(path) => {
          const result = report(store.createPlaybookFolder(path));
          if (result.ok) {
            setSelectedFolderPath(path);
            setRevealPath(path);
          }
          return result;
        }}
        onOpenChange={setFolderDialogOpen}
        open={folderDialogOpen}
        parentPath={selectedFolderPath}
      />
      <DeleteFileDialog
        file={selectedFile}
        onDelete={() =>
          selectedFile
            ? report(store.deletePlaybookFile({ confirmed: true, fileId: selectedFile.id }))
            : ({ error: "No file selected", ok: false, state: store.state })
        }
        onOpenChange={setDeleteOpen}
        open={deleteOpen}
      />
      <DiscardDraftDialog
        file={selectedFile}
        onDiscard={() => {
          if (selectedFile) {
            report(store.discardPlaybookDraft(selectedFile.id));
          }
        }}
        onOpenChange={setDiscardOpen}
        open={discardOpen}
      />
      {narrowMobile ? <span className="visually-hidden">Narrow mobile Dream layout</span> : null}
    </section>
  );
}
