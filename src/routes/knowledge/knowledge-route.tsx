import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useNavigate, useSearchParams } from "react-router";

import { useMediaQuery } from "../../app/use-media-query";
import {
  createPlaybookFile,
  deletePlaybookFile,
  renamePlaybookFile,
  type Correction,
  type MutationResult,
} from "../../domain";
import { useAppStore } from "../../store/app-store-context";
import { ChangesPane } from "./changes-pane";
import {
  DeleteFileDialog,
  DiscardDraftDialog,
  FileDialog,
  FolderDialog,
} from "./knowledge-dialogs";
import {
  fileCorrections,
  pendingCount,
  type KnowledgePane,
  type TestDockState,
} from "./knowledge-model";
import { KnowledgeToolbar } from "./knowledge-toolbar";
import { OperationStatusBanner } from "../../components/operation-status";
import type { OperationStatus } from "../../contracts/workflow";
import { FileListPane } from "./file-list-pane";
import { TestDock } from "./test-dock";
import "./knowledge.css";

const PANES: KnowledgePane[] = ["files", "editor", "changes"];
type KnowledgeFeedback = {
  message: string;
  state: "succeeded" | "failed";
};
const fileParentPath = (path: string) => path.split("/").slice(0, -1).join("/");
const EditorPane = lazy(async () => {
  const module = await import("./editor-pane");
  return { default: module.EditorPane };
});

export default function KnowledgeRoute() {
  const store = useAppStore((value) => value);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const mobile = useMediaQuery("(max-width: 999px)");
  const narrowMobile = useMediaQuery("(max-width: 339px)");
  const [pane, setPane] = useState<KnowledgePane>(store.routeUi.knowledgePane);
  const [focusedCorrectionId, setFocusedCorrectionId] = useState<string | null>(
    store.routeUi.knowledgeCorrectionId,
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
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [feedback, setFeedback] = useState<KnowledgeFeedback | null>(null);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [testDock, setTestDock] = useState<TestDockState>({ status: "closed" });
  const testToken = useRef(0);
  const testTimer = useRef<number | null>(null);
  const progressTimer = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);
  const markdownImportRef = useRef<HTMLInputElement | null>(null);

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
  const query = searchParams.toString();
  const release = store.knowledgeRelease;
  const linkedDatasetId =
    store.state.evalDatasets.find((dataset) =>
      dataset.cases.some((evalCase) =>
        store.state.corrections.some(
          (correction) =>
            correction.status === "approved" &&
            correction.sourceCaseId === evalCase.id,
        ),
      ),
    )?.id ??
    store.state.selections.evalDatasetId ??
    store.state.evalDatasets[0]?.id ??
    null;
  const localVersion = store.state.evalDatasets[0]?.candidateVersion ?? 1;
  const operationStatus: OperationStatus | null = feedback
    ? {
        scope: "knowledge",
        state: feedback.state,
        message: feedback.message,
        action: null,
        actionLabel: null,
      }
    : null;

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
      knowledgeCorrectionId: focusedCorrectionId,
      knowledgePane: pane,
    });
  }, [focusedCorrectionId, pane, store.updateRouteUi]);

  useEffect(() => {
    let active = true;
    void store.refreshKnowledgeWorkspace().finally(() => {
      if (active) {
        setWorkspaceReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, [store.refreshKnowledgeWorkspace]);

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
    setFeedback(null);
  }, [store.resetVersion]);

  useEffect(() => {
    if (!query || !workspaceReady) {
      return;
    }
    const correctionId = searchParams.get("correction");
    const fileId = searchParams.get("file");
    const correction = store.state.corrections.find(
      (candidate) => candidate.id === correctionId,
    );
    if (correctionId && !correction) {
      return;
    }
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
      setFeedback({
        message:
          "Correction opened from Eval evidence. Review the diff, replay affected cases, then activate only if the full suite passes.",
        state: "succeeded",
      });
    }
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [query, store.state.corrections, store.state.playbookFiles, workspaceReady]);

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

  const showFeedback = (message: string, state: KnowledgeFeedback["state"] = "succeeded") => {
    setFeedback({ message, state });
  };

  const report = (result: MutationResult) => {
    if (!result.ok) {
      showFeedback(result.error, "failed");
    }
    return result;
  };

  const releaseFallback = (message: string) =>
    /not configured|could not be reached|request failed/i.test(message);

  const stageKnowledgeFile = async (
    local: MutationResult,
    fileId: string,
    applyLocal: () => MutationResult,
  ): Promise<MutationResult> => {
    if (!local.ok) return local;
    const file = local.state.playbookFiles.find((candidate) => candidate.id === fileId);
    if (!file) return { ok: false, state: store.state, error: "Knowledge file was not found" };
    const remote = await store.stageKnowledgeFile(file);
    if (remote.ok) return remote;
    return releaseFallback(remote.error) ? report(applyLocal()) : remote;
  };

  const stageKnowledgeFileDeletion = async (
    local: MutationResult,
    fileId: string,
    applyLocal: () => MutationResult,
  ): Promise<MutationResult> => {
    if (!local.ok) return local;
    const remote = await store.stageKnowledgeFileDeletion(fileId);
    if (remote.ok) return remote;
    return releaseFallback(remote.error) ? report(applyLocal()) : remote;
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
    }, 500);
    testTimer.current = window.setTimeout(() => {
      if (token !== testToken.current) {
        return;
      }
      clearTestTimers();
      const result = store.runSavedTextCheck(selectedFile.id);
      if (!result.ok) {
        setTestDock({ message: result.error, status: "error" });
        return;
      }
      setTestDock({ result: result.result, stale: false, status: "complete" });
    }, 520 + total * 200);
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
      void (async () => {
        const draft = selectedFile.draft;
        if (draft === undefined) {
          setSaving(false);
          return;
        }
        const remote = await store.createKnowledgeCandidateFromDraft(fileId, draft);
        const fallback = releaseFallback(remote.ok ? "" : remote.error);
        const result = remote.ok
          ? remote
          : fallback
            ? report(store.savePlaybookDraft(fileId))
            : remote;
        setSaving(false);
        if (result.ok) {
        showFeedback(
          remote.ok
            ? "Inactive candidate created. Replay affected Eval cases next."
            : "Draft saved locally; configure the release server to create a candidate.",
        );
        cancelTest();
        setTestDock((current) =>
          current.status === "complete"
            ? { ...current, stale: true }
            : current.status === "closed"
              ? current
              : { message: "Saved text changed. Check the saved text again.", status: "error" },
        );
        } else {
          showFeedback(result.error, "failed");
        }
      })();
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
        : { message: "Correction state changed. Check the saved text again.", status: "error" },
    );
  };

  const approveCorrection = (correction: Correction) => {
    void (async () => {
      const remote = await store.acceptKnowledgeCorrection(correction.id);
      const fallback = releaseFallback(remote.ok ? "" : remote.error);
      if (remote.ok) {
        showFeedback("Inactive candidate created from the approved correction.");
        cancelTest();
        return;
      }
      if (fallback) {
        decideCorrection(correction, store.approveCorrection);
        return;
      }
      showFeedback(remote.error, "failed");
    })();
  };

  const runReleaseReplay = (scope: "affected" | "full") => {
    if (!release?.candidateVersionId || !linkedDatasetId) {
      showFeedback("Link a Knowledge correction to an Eval dataset before replaying it.", "failed");
      return;
    }
    const candidateVersionId = release.candidateVersionId;
    const datasetId = linkedDatasetId;
    void (async () => {
      setReleaseBusy(true);
      try {
        const replayScopes = scope === "full"
          ? (["affected", "full"] as const)
          : (["affected"] as const);
        for (const replayScope of replayScopes) {
          const result = await store.replayKnowledgeCandidate(
            candidateVersionId,
            datasetId,
            replayScope,
          );
          if (!result.ok) {
            showFeedback(result.error, "failed");
            return;
          }
          if (!result.replay) {
            showFeedback("Eval replay completed without evidence.", "failed");
            return;
          }
          if (!result.replay.passed) {
            showFeedback(
              `${replayScope === "affected" ? "Affected train cases" : "All eval cases"}: ${result.replay.passedCases}/${result.replay.totalCases} passed.`,
              "failed",
            );
            return;
          }
          if (replayScope === "affected" && scope === "full") {
            showFeedback(
              `Affected train cases: ${result.replay.passedCases}/${result.replay.totalCases} passed. Replaying all eval cases.`,
            );
            continue;
          }
          showFeedback(
            result.replay.ready
              ? `All eval cases: ${result.replay.passedCases}/${result.replay.totalCases} passed${
                  result.replay.beforeFailedCases > 0
                    ? `; ${result.replay.beforeFailedCases} previously failed active SOP.`
                    : "."
                } Candidate is Ready.`
              : `${replayScope === "affected" ? "Affected train cases" : "All eval cases"}: ${result.replay.passedCases}/${result.replay.totalCases} passed${
                  result.replay.beforeFailedCases > 0
                    ? `; ${result.replay.beforeFailedCases} previously failed active SOP.`
                    : "."
                }`,
          );
        }
      } finally {
        setReleaseBusy(false);
      }
    })();
  };

  const activateRelease = () => {
    if (!release?.candidateVersionId) return;
    const candidateVersionId = release.candidateVersionId;
    void (async () => {
      setReleaseBusy(true);
      try {
        const result = await store.activateKnowledgeCandidate(candidateVersionId);
        showFeedback(
          result.ok ? "Candidate activated. New Chat drafts use this SOP." : result.error,
          result.ok ? "succeeded" : "failed",
        );
      } finally {
        setReleaseBusy(false);
      }
    })();
  };

  const discardRelease = () => {
    if (!release?.candidateVersionId) return;
    const candidateVersionId = release.candidateVersionId;
    void (async () => {
      setReleaseBusy(true);
      try {
        const result = await store.discardKnowledgeCandidate(candidateVersionId);
        showFeedback(
          result.ok ? "Candidate discarded. Active SOP remains unchanged." : result.error,
          result.ok ? "succeeded" : "failed",
        );
      } finally {
        setReleaseBusy(false);
      }
    })();
  };

  const rollbackRelease = () => {
    void (async () => {
      setReleaseBusy(true);
      try {
        const result = await store.rollbackKnowledgePlaybook();
        showFeedback(
          result.ok ? "Prior SOP restored as a new immutable version." : result.error,
          result.ok ? "succeeded" : "failed",
        );
      } finally {
        setReleaseBusy(false);
      }
    })();
  };

  const importMarkdown = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".md")) {
      showFeedback("Choose a Markdown (.md) SOP file.", "failed");
      return;
    }
    void (async () => {
      const base = file.name
        .replace(/\.md$/i, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "imported-sop";
      const result = await store.importKnowledgeMarkdown(
        `playbooks/imported/${base}.md`,
        file.name.replace(/\.md$/i, ""),
        await file.text(),
      );
      showFeedback(
        result.ok
          ? "Markdown imported as an inactive candidate. Replay affected Eval cases next."
          : result.error,
        result.ok ? "succeeded" : "failed",
      );
    })();
  };

  const tabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: KnowledgePane) => {
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
    <Suspense fallback={<div className="knowledge-editor-loading" role="status">Loading Markdown editor</div>}>
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
        approveCorrection(correction)
      }
      onFocus={focusCorrection}
      onOpenEval={(caseId) => navigate(`/eval?case=${caseId}`)}
      onReject={(correction) =>
        decideCorrection(correction, store.rejectCorrection)
      }
    />
  );

  return (
    <section aria-labelledby="knowledge-route-title" className="route-root knowledge-route">
      <input
        accept=".md,text/markdown"
        aria-label="Import Markdown SOP"
        hidden
        onChange={importMarkdown}
        ref={markdownImportRef}
        type="file"
      />
      <KnowledgeToolbar
        file={selectedFile}
        onDelete={() => setDeleteOpen(true)}
        onDiscard={() => setDiscardOpen(true)}
        onImport={() => markdownImportRef.current?.click()}
        onNew={() => setFileDialog("create")}
        onRename={() => setFileDialog("rename")}
        onReplayAffected={() => runReleaseReplay("affected")}
        onReplayFull={() => runReleaseReplay("full")}
        onActivate={activateRelease}
        onDiscardCandidate={discardRelease}
        onRollback={rollbackRelease}
        onSave={save}
        onTest={runTest}
        pending={pendingCount(store.state.corrections, selectedFile?.id)}
        release={release}
        releaseBusy={releaseBusy}
        saving={saving}
      />
      <section aria-label="Knowledge release gate" className="knowledge-release-gate">
        <div>
          <span>Active SOP</span>
          <strong>v{release?.activeVersionSequence ?? localVersion}</strong>
          <small>{release ? "immutable server release" : "local demo baseline"}</small>
        </div>
        <div>
          <span>Candidate</span>
          <strong>
            {release?.candidateVersionId
              ? release.candidateReady
                ? `v${release.candidateVersionSequence} ready`
                : `v${release.candidateVersionSequence} inactive`
              : "None"}
          </strong>
          <small>
            {release?.candidateVersionId
              ? "Replay all eval cases runs affected train cases first, then all train and holdout cases."
              : "Edit -> Replay all eval cases (affected train first) -> Activate. Approve a correction or save a draft to create a candidate."}
          </small>
        </div>
        <div>
          <span>Prior version</span>
          <strong>
            {release?.rollbackTargetVersionSequence
              ? `v${release.rollbackTargetVersionSequence} available`
              : "None until first activation"}
          </strong>
          <small>Rollback restores the prior SOP as a new immutable version.</small>
        </div>
      </section>
      <OperationStatusBanner status={operationStatus} />
      {mobile ? (
        <div aria-label="Knowledge panes" className="knowledge-tabs" role="tablist">
          {PANES.map((item) => (
            <button
              aria-label={item === "files" ? "Files" : item === "editor" ? "Editor" : "Changes"}
              aria-controls={`knowledge-panel-${item}`}
              aria-selected={pane === item}
              data-pane={item}
              id={`knowledge-tab-${item}`}
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
        aria-label="Knowledge workbench"
        className={`route-workbench knowledge-workbench${mobile ? " knowledge-workbench--mobile" : ""}`}
      >
        {mobile ? (
          <div
            aria-labelledby={`knowledge-tab-${pane}`}
            className="knowledge-mobile-panel"
            id={`knowledge-panel-${pane}`}
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
        onCreate={async (path, title) => {
          const local = createPlaybookFile(store.state, { path, title });
          const fileId = local.ok ? local.state.selections.playbookFileId : null;
          const result = fileId
            ? await stageKnowledgeFile(local, fileId, () => store.createPlaybookFile({ path, title }))
            : local;
          if (result.ok) {
            if (fileId) store.selectPlaybookFile(fileId);
            setSelectedFolderPath(fileParentPath(path));
            setRevealPath(path);
          }
          if (result.ok && mobile) {
            setPane("editor");
          }
          return result;
        }}
        onOpenChange={(open) => !open && setFileDialog(null)}
        onRename={async (path, title) => {
          if (!selectedFile) return { error: "No file selected", ok: false, state: store.state };
          return stageKnowledgeFile(
            renamePlaybookFile(store.state, { fileId: selectedFile.id, path, title }),
            selectedFile.id,
            () => store.renamePlaybookFile({ fileId: selectedFile.id, path, title }),
          );
        }}
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
        onDelete={async () => {
          if (!selectedFile) return { error: "No file selected", ok: false, state: store.state };
          return stageKnowledgeFileDeletion(
            deletePlaybookFile(store.state, { confirmed: true, fileId: selectedFile.id }),
            selectedFile.id,
            () => store.deletePlaybookFile({ confirmed: true, fileId: selectedFile.id }),
          );
        }}
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
      {narrowMobile ? <span className="visually-hidden">Narrow mobile Knowledge layout</span> : null}
    </section>
  );
}
