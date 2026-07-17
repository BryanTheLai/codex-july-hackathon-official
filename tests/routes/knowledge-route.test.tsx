import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef } from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCanonicalSeed, createCanonicalServerState, type Correction } from "../../src/domain";
import KnowledgeRoute from "../../src/routes/knowledge/knowledge-route";
import { AppStoreProvider } from "../../src/store/app-store-context";
import { saveAppState } from "../../src/store/repository";
import { createAppStore, type AppStore } from "../../src/store/use-app-store";

vi.mock("@uiw/react-codemirror", () => ({
  default: forwardRef<
    HTMLTextAreaElement,
    {
      onChange?: (value: string) => void;
      value?: string;
    }
  >(({ onChange, value }, ref) => (
    <textarea
      aria-label="Playbook Markdown editor"
      onChange={(event) => onChange?.(event.target.value)}
      ref={ref}
      value={value}
    />
  )),
}));

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

const selectionOldLine = "For poor cooling and a musty smell, quote the RM99 general service.";
const selectionNewLine =
  "If a wall-mounted 1.0-1.5 HP unit has both poor cooling and a musty smell, recommend the RM160 chemical wash. Do not quote the RM99 general service.";

const selectionCorrection: Correction = {
  id: "corr-aircon-selection",
  fileId: "file-aircon-service-selection",
  oldText: selectionOldLine,
  newText: selectionNewLine,
  evidence: "Combined symptoms need chemical wash.",
  status: "pending",
  sourceCaseId: "case-aircon-selection-train",
  lineHint: 3,
};

const bookingCorrection: Correction = {
  id: "corr-aircon-booking",
  fileId: "file-aircon-booking",
  oldText: "customer explicitly confirms one slot and the address.",
  newText: "customer explicitly confirms one slot, the address, and SMS confirmation.",
  evidence: "Explicit booking confirmation train case.",
  status: "pending",
  sourceCaseId: "case-aircon-confirm-train",
  lineHint: 4,
};

function installMatchMedia(width: number) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches:
        (query.includes("999px") && width <= 999) ||
        (query.includes("1199px") && width <= 1199) ||
        (query.includes("1200px") && width >= 1200) ||
        (query.includes("339px") && width <= 339),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

function createKnowledgeStore(options?: {
  corrections?: Correction[];
  playbookFileId?: string;
}): AppStore {
  const storage = new MemoryStorage();
  const state = createCanonicalSeed();
  if (options?.corrections) {
    state.corrections = options.corrections;
  }
  if (options?.playbookFileId) {
    state.selections.playbookFileId = options.playbookFileId;
  }
  saveAppState(storage, state);
  return createAppStore(storage);
}

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="Current location">{`${location.pathname}${location.search}`}</output>
      <button
        onClick={() => navigate("/knowledge?file=file-aircon-rate-card")}
        type="button"
      >
        Test file deep link
      </button>
    </>
  );
}

function renderKnowledge(options: {
  width?: number;
  store?: AppStore;
  entry?: string;
} = {}) {
  installMatchMedia(options.width ?? 1440);
  const store = options.store ?? createKnowledgeStore();
  const result = render(
    <AppStoreProvider store={store}>
      <MemoryRouter initialEntries={[options.entry ?? "/knowledge"]}>
        <Routes>
          <Route path="/knowledge" element={<><KnowledgeRoute /><LocationProbe /></>} />
          <Route path="/eval" element={<div>Evaluation destination</div>} />
        </Routes>
      </MemoryRouter>
    </AppStoreProvider>,
  );
  return { ...result, store };
}

describe("Knowledge route", () => {
  beforeEach(() => installMatchMedia(1440));
  afterEach(cleanup);

  it("keeps the editable playbook dominant and hides an empty proposal pane", async () => {
    renderKnowledge();

    expect(screen.getByRole("heading", { name: "Knowledge" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Knowledge release gate" })).toHaveTextContent(
      "Active SOPv1",
    );
    expect(screen.getByRole("region", { name: "Knowledge release gate" })).toHaveTextContent(
      "Prior version",
    );
    expect(screen.getByRole("region", { name: "Knowledge release gate" })).toHaveTextContent(
      "None until first activation",
    );
    expect(screen.getByRole("navigation", { name: "Playbook files" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Playbook editor" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Proposed changes" })).not.toBeInTheDocument();
    expect(screen.queryByText("- remove", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("+ add", { exact: true })).not.toBeInTheDocument();
    expect(
      (await screen.findByRole("textbox", { name: "Playbook Markdown editor" }) as HTMLTextAreaElement)
        .value,
    ).toContain("General service: RM99 per unit.");
    expect(screen.getAllByText("Saved")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Check saved text" })).toBeEnabled();
    expect(
      screen.getByRole("button", {
        name: "Roll back: Available after the first candidate is activated",
      }),
    ).toBeDisabled();
    expect(screen.queryByText(/dashboard|overview|knowledge cycle/i)).not.toBeInTheDocument();
  });

  it("uses an IDE tree and scopes new files and folders to the selected folder", async () => {
    const user = userEvent.setup();
    renderKnowledge();

    expect(screen.getByRole("tree", { name: "Playbook explorer" })).toBeInTheDocument();
    const dataFolder = screen.getByRole("treeitem", { name: "data" });
    await user.click(dataFolder);
    expect(dataFolder).toHaveAttribute("aria-selected", "true");
    expect(dataFolder).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("button", { name: "New playbook file" }));
    const fileDialog = screen.getByRole("dialog", { name: "New playbook file" });
    expect(fileDialog).toHaveTextContent("Create in playbooks/data/");
    expect(within(fileDialog).getByLabelText("File name")).toHaveValue("");
    await user.type(within(fileDialog).getByLabelText("File title"), "Follow Up Guide");
    expect(within(fileDialog).getByLabelText("File name")).toHaveValue("follow-up-guide.md");
    await user.click(within(fileDialog).getByRole("button", { name: "Create file" }));
    expect(await screen.findByRole("treeitem", { name: /follow up guide/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.click(dataFolder);
    expect(dataFolder).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: "New playbook folder" }));
    const folderDialog = screen.getByRole("dialog", { name: "New playbook folder" });
    expect(folderDialog).toHaveTextContent("playbooks/data/");
    await user.type(within(folderDialog).getByLabelText("Folder name"), "follow-up");
    await user.click(within(folderDialog).getByRole("button", { name: "Create folder" }));
    expect(screen.getByRole("treeitem", { name: "data" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("treeitem", { name: "follow-up" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("restores a selected nested file with its folder expanded", async () => {
    const user = userEvent.setup();
    const store = createKnowledgeStore();
    expect(
      store.getState().createPlaybookFile({
        path: "playbooks/data/service-area.md",
        title: "Service area",
      }).ok,
    ).toBe(true);

    renderKnowledge({ store });

    expect(screen.getByRole("treeitem", { name: "data" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("treeitem", { name: /service area/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "New playbook file" }));
    const dialog = screen.getByRole("dialog", { name: "New playbook file" });
    expect(dialog).toHaveTextContent("Create in playbooks/data/");
    expect(within(dialog).getByLabelText("File name")).toHaveValue("");
  });

  it("reveals playbook definitions on hover without adding visible helper copy", async () => {
    const user = userEvent.setup();
    renderKnowledge();

    await user.hover(screen.getByRole("term", { name: "Aircon rate card" }));
    expect(
      screen.getByRole("tooltip", { name: /fixed rm99 general service/i }),
    ).toBeInTheDocument();
    await user.unhover(screen.getByRole("term", { name: "Aircon rate card" }));
    await user.hover(screen.getByRole("term", { name: "Aircon booking" }));
    expect(
      screen.getByRole("tooltip", { name: /collects symptoms, slots, and address/i }),
    ).toBeInTheDocument();
  });

  it("blocks review while dirty, saves, approves, and verifies saved text", async () => {
    const user = userEvent.setup();
    renderKnowledge({
      store: createKnowledgeStore({
        corrections: [selectionCorrection],
        playbookFileId: "file-aircon-service-selection",
      }),
    });
    const editor = await screen.findByRole("textbox", { name: "Playbook Markdown editor" });

    await user.type(editor, "\nDocument escalation context.");
    expect(screen.getAllByText("Unsaved")).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Approve correction" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getAllByText("Saved")).not.toHaveLength(0));
    await user.click(screen.getByRole("button", { name: "Approve correction" }));
    expect((editor as HTMLTextAreaElement).value).toContain(selectionNewLine);
    expect(screen.queryByRole("complementary", { name: "Proposed changes" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Check saved text" }));
    expect(screen.getByRole("region", { name: "Saved text check results" })).toHaveTextContent(
      "Preparing saved-text verification",
    );
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Saved text check results" })).toHaveTextContent(
        "1 passed",
      ),
    );
    expect(screen.getByRole("region", { name: "Saved text check results" })).toHaveTextContent(
      "Evaluation Lab scores stay separate",
    );
    const results = screen.getByRole("region", { name: "Saved text check results" });
    expect(results).toHaveTextContent("Line 4");
    expect(results).toHaveTextContent("Before");
    expect(results).toHaveTextContent(selectionOldLine);
    expect(results).toHaveTextContent("After");
    expect(results).toHaveTextContent(selectionNewLine);
    expect(results).toHaveTextContent("Saved line 4 matches the approved text.");
    const resizeHandle = screen.getByRole("separator", {
      name: "Resize saved text check",
    });
    expect(resizeHandle).toHaveAttribute("aria-valuenow", "210");
    resizeHandle.focus();
    await user.keyboard("{ArrowUp}");
    expect(resizeHandle).toHaveAttribute("aria-valuenow", "230");
  });

  it("does not claim an approved correction caused a stale proposal after an ordinary save", async () => {
    const user = userEvent.setup();
    renderKnowledge({
      store: createKnowledgeStore({
        corrections: [selectionCorrection],
        playbookFileId: "file-aircon-service-selection",
      }),
    });
    const editor = await screen.findByRole("textbox", { name: "Playbook Markdown editor" });

    await user.clear(editor);
    await user.type(
      editor,
      `# Aircon service selection\n\nRoutine cleaning uses the RM99 general service.\n${selectionNewLine}\nDo not diagnose parts or promise a repair outcome.\n`,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    const stale = await screen.findByText(/Saved text no longer contains the proposed line/i);
    expect(stale).toHaveTextContent("Re-run analysis");
    expect(stale).not.toHaveTextContent("approved correction changed");
    expect(screen.getByRole("button", { name: "Approve correction" })).toBeDisabled();
  });

  it("renders every server command failure as a failed operation", async () => {
    const user = userEvent.setup();
    const state = await createCanonicalServerState();
    const storage = new MemoryStorage();
    const local = createCanonicalSeed();
    local.corrections = [selectionCorrection];
    local.selections.playbookFileId = "file-aircon-service-selection";
    saveAppState(storage, local);
    const execute = vi.fn(async () => {
      throw new Error("Workspace revision is stale.");
    });
    const store = createAppStore(storage, {
      workspaceClient: {
        async load() {
          return {
            revision: 1,
            state: {
              ...state,
              corrections: local.corrections,
              selections: local.selections,
            },
            workspaceId: "demo",
          };
        },
      },
      workspaceCommandClient: {
        execute,
      },
    });
    renderKnowledge({ store });

    await user.click(await screen.findByRole("button", { name: "Approve correction" }));
    await waitFor(() => expect(execute).toHaveBeenCalledOnce());
    await waitFor(() => {
      const banner = screen.getByText("Workspace revision is stale.");
      expect(banner.closest(".operation-status")).toHaveClass("operation-status--failed");
    });
  });

  it("renders one pane on mobile and follows file, changes, then Focus Line choreography", async () => {
    const user = userEvent.setup();
    renderKnowledge({
      width: 390,
      store: createKnowledgeStore({
        corrections: [selectionCorrection],
        playbookFileId: "file-aircon-service-selection",
      }),
    });

    expect(screen.getByRole("tablist", { name: "Knowledge panes" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Playbook files" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Playbook editor" })).not.toBeInTheDocument();
    screen.getByRole("tab", { name: "Files" }).focus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("treeitem", { name: /aircon service selection/i }));
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Playbook editor" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("navigation", { name: "Playbook files" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Changes" }));
    expect(screen.getByRole("complementary", { name: "Proposed changes" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Focus Line" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Focus correction at line 4" }));
    expect(screen.getByRole("region", { name: "Playbook editor" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Playbook Markdown editor" })).toHaveFocus();
  });

  it("opens a correction deep link in its owning file and consumes the query", async () => {
    const storage = new MemoryStorage();
    const state = createCanonicalSeed();
    state.corrections = [bookingCorrection];
    saveAppState(storage, state);
    renderKnowledge({
      entry: "/knowledge?correction=corr-aircon-booking",
      store: createAppStore(storage),
      width: 390,
    });

    await waitFor(() =>
      expect(screen.getAllByText("playbooks/aircon-booking.md")).not.toHaveLength(0),
    );
    expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/Explicit booking confirmation train case/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        /Correction opened from Eval evidence. Review the diff, validate the candidate, then activate only if the full suite passes./i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Current location" })).toHaveTextContent("/knowledge");
  });

  it("reprocesses a new same-route file deep link", async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    const state = createCanonicalSeed();
    state.corrections = [bookingCorrection];
    saveAppState(storage, state);
    renderKnowledge({
      entry: "/knowledge?correction=corr-aircon-booking",
      store: createAppStore(storage),
      width: 390,
    });
    await user.click(screen.getByRole("button", { name: "Test file deep link" }));

    expect(screen.getAllByText("playbooks/aircon-rate-card.md")).not.toHaveLength(0);
    expect(screen.getByRole("tab", { name: "Editor" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("status", { name: "Current location" })).toHaveTextContent("/knowledge");
  });

  it("rejects without changing saved text and removes the completed proposal pane", async () => {
    const user = userEvent.setup();
    renderKnowledge({
      store: createKnowledgeStore({
        corrections: [selectionCorrection],
        playbookFileId: "file-aircon-service-selection",
      }),
    });
    const editor = await screen.findByRole("textbox", { name: "Playbook Markdown editor" });
    const before = (editor as HTMLTextAreaElement).value;
    await user.click(screen.getByRole("button", { name: "Reject correction" }));

    expect((editor as HTMLTextAreaElement).value).toBe(before);
    expect(screen.queryByRole("complementary", { name: "Proposed changes" })).not.toBeInTheDocument();
  });

  it("creates a file through maintenance controls and surfaces path validation inline", async () => {
    const user = userEvent.setup();
    renderKnowledge();

    await user.click(screen.getByRole("button", { name: "More file actions" }));
    await user.click(screen.getByRole("menuitem", { name: "New File" }));
    const dialog = screen.getByRole("dialog", { name: "New playbook file" });
    await user.type(within(dialog).getByLabelText("File title"), "Notes");
    await user.clear(within(dialog).getByLabelText("File name"));
    await user.type(within(dialog).getByLabelText("File name"), "notes.txt");
    await user.click(within(dialog).getByRole("button", { name: "Create file" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("end with .md");

    await user.clear(within(dialog).getByLabelText("File name"));
    await user.type(within(dialog).getByLabelText("File name"), "follow-up.md");
    await user.click(within(dialog).getByRole("button", { name: "Create file" }));
    expect(await screen.findAllByText("playbooks/follow-up.md")).not.toHaveLength(0);
  });
});
