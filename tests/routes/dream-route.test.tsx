import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef } from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCanonicalServerState } from "../../src/domain";
import DreamRoute from "../../src/routes/dream/dream-route";
import { AppStoreProvider } from "../../src/store/app-store-context";
import { createAppStore, type AppStore } from "../../src/store/use-app-store";

vi.mock("@uiw/react-codemirror", () => ({
  default: forwardRef<
    HTMLTextAreaElement,
    {
      "aria-label"?: string;
      onChange?: (value: string) => void;
      value?: string;
    }
  >(({ "aria-label": ariaLabel, onChange, value }, ref) => (
    <textarea
      aria-label={ariaLabel}
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

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="Current location">{`${location.pathname}${location.search}`}</output>
      <button
        onClick={() => navigate("/dream?file=file-mandarin-prescription")}
        type="button"
      >
        Test file deep link
      </button>
    </>
  );
}

function renderDream(options: { width?: number; store?: AppStore; entry?: string } = {}) {
  installMatchMedia(options.width ?? 1440);
  const store = options.store ?? createAppStore(new MemoryStorage());
  const result = render(
    <AppStoreProvider store={store}>
      <MemoryRouter initialEntries={[options.entry ?? "/dream"]}>
        <Routes>
          <Route path="/dream" element={<><DreamRoute /><LocationProbe /></>} />
          <Route path="/eval" element={<div>Evaluation destination</div>} />
        </Routes>
      </MemoryRouter>
    </AppStoreProvider>,
  );
  return { ...result, store };
}

describe("Dream route", () => {
  beforeEach(() => installMatchMedia(1440));
  afterEach(cleanup);

  it("keeps the editable playbook dominant with adjacent files and changes", async () => {
    renderDream();

    expect(screen.getByRole("heading", { name: "Knowledge" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Dream release gate" })).toHaveTextContent(
      "Active SOPv1",
    );
    expect(screen.getByRole("navigation", { name: "Playbook files" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Playbook editor" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Proposed changes" })).toBeInTheDocument();
    expect(screen.queryByText("- remove", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("+ add", { exact: true })).not.toBeInTheDocument();
    expect(
      (await screen.findByRole("textbox", { name: "Playbook Markdown editor" }) as HTMLTextAreaElement)
        .value,
    ).toContain("Seek urgent care for chest pain.");
    expect(screen.getAllByText("Saved")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Test Changes" })).toBeEnabled();
    expect(screen.queryByText(/dashboard|overview|dream cycle/i)).not.toBeInTheDocument();
  });

  it("uses an IDE tree and scopes new files and folders to the selected folder", async () => {
    const user = userEvent.setup();
    renderDream();

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
    const store = createAppStore(new MemoryStorage());
    expect(
      store.getState().createPlaybookFile({
        path: "playbooks/data/clinic-context.md",
        title: "Clinic context",
      }).ok,
    ).toBe(true);

    renderDream({ store });

    expect(screen.getByRole("treeitem", { name: "data" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("treeitem", { name: /clinic context/i })).toHaveAttribute(
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
    renderDream();

    await user.hover(screen.getByRole("term", { name: "Triage" }));
    expect(
      screen.getByRole("tooltip", { name: /prioritizes urgent symptoms/i }),
    ).toBeInTheDocument();
    await user.unhover(screen.getByRole("term", { name: "Triage" }));
    await user.hover(screen.getByRole("term", { name: "Malay booking" }));
    expect(
      screen.getByRole("tooltip", { name: /handles appointment requests in Malay/i }),
    ).toBeInTheDocument();
  });

  it("blocks review while dirty, saves, approves, and verifies saved text", async () => {
    const user = userEvent.setup();
    renderDream();
    const editor = await screen.findByRole("textbox", { name: "Playbook Markdown editor" });

    await user.type(editor, "\nDocument escalation context.");
    expect(screen.getAllByText("Unsaved")).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Approve correction" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getAllByText("Saved")).not.toHaveLength(0));
    await user.click(screen.getByRole("button", { name: "Approve correction" }));
    expect((editor as HTMLTextAreaElement).value).toContain("Call 999 guidance");

    await user.click(screen.getByRole("button", { name: "Test Changes" }));
    expect(screen.getByRole("region", { name: "Test Changes results" })).toHaveTextContent(
      "Preparing saved-text verification",
    );
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Test Changes results" })).toHaveTextContent(
        "1 passed",
      ),
    );
    expect(screen.getByRole("region", { name: "Test Changes results" })).toHaveTextContent(
      "Evaluation Lab scores stay separate",
    );
    const results = screen.getByRole("region", { name: "Test Changes results" });
    expect(results).toHaveTextContent("Line 3");
    expect(results).toHaveTextContent("Before");
    expect(results).toHaveTextContent("Seek urgent care for chest pain.");
    expect(results).toHaveTextContent("After");
    expect(results).toHaveTextContent("Call 999 guidance for chest pain with sweating.");
    expect(results).toHaveTextContent("Saved line 3 matches the approved text.");
  });

  it("does not claim an approved correction caused a stale proposal after an ordinary save", async () => {
    const user = userEvent.setup();
    renderDream();
    const editor = await screen.findByRole("textbox", { name: "Playbook Markdown editor" });

    await user.clear(editor);
    await user.type(editor, "# Triage\n\nCall 999 guidance for chest pain with sweating.\n");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const stale = await screen.findByText(/Saved text no longer contains the proposed line/i);
    expect(stale).toHaveTextContent("Re-run analysis");
    expect(stale).not.toHaveTextContent("approved correction changed");
    expect(screen.getByRole("button", { name: "Approve correction" })).toBeDisabled();
  });

  it("renders every server command failure as a failed operation", async () => {
    const user = userEvent.setup();
    const state = await createCanonicalServerState();
    const store = createAppStore(new MemoryStorage(), {
      workspaceClient: {
        async load() {
          return { revision: 1, state, workspaceId: "demo" };
        },
      },
      workspaceCommandClient: {
        async execute() {
          throw new Error("Workspace revision is stale.");
        },
      },
    });
    renderDream({ store });

    await user.click(await screen.findByRole("button", { name: "Approve correction" }));
    const message = await screen.findByText("Workspace revision is stale.");
    expect(message.closest(".operation-status")).toHaveClass("operation-status--failed");
  });

  it("renders one pane on mobile and follows file, changes, then Focus Line choreography", async () => {
    const user = userEvent.setup();
    renderDream({ width: 390 });

    expect(screen.getByRole("tablist", { name: "Dream panes" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Playbook files" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Playbook editor" })).not.toBeInTheDocument();
    screen.getByRole("tab", { name: "Files" }).focus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("treeitem", { name: /triage\.md/i }));
    expect(screen.getByRole("region", { name: "Playbook editor" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Playbook files" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Changes" }));
    expect(screen.getByRole("complementary", { name: "Proposed changes" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Focus Line" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Focus correction at line 3" }));
    expect(screen.getByRole("region", { name: "Playbook editor" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Playbook Markdown editor" })).toHaveFocus();
  });

  it("opens a correction deep link in its owning file and consumes the query", () => {
    renderDream({ entry: "/dream?correction=corr-malay-booking", width: 390 });

    expect(screen.getAllByText("playbooks/malay-booking.md")).not.toHaveLength(0);
    expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/SMS confirmation before closing/)).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Current location" })).toHaveTextContent("/dream");
  });

  it("reprocesses a new same-route file deep link", async () => {
    const user = userEvent.setup();
    renderDream({ entry: "/dream?correction=corr-malay-booking", width: 390 });
    await user.click(screen.getByRole("button", { name: "Test file deep link" }));

    expect(screen.getAllByText("playbooks/mandarin-prescription.md")).not.toHaveLength(0);
    expect(screen.getByRole("tab", { name: "Editor" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("status", { name: "Current location" })).toHaveTextContent("/dream");
  });

  it("rejects without changing saved text and keeps the decided line focusable", async () => {
    const user = userEvent.setup();
    renderDream();
    const editor = await screen.findByRole("textbox", { name: "Playbook Markdown editor" });
    const before = (editor as HTMLTextAreaElement).value;
    await user.click(screen.getByRole("button", { name: "Reject correction" }));

    expect((editor as HTMLTextAreaElement).value).toBe(before);
    expect(screen.getByText("rejected", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Focus correction at line 3" })).toBeEnabled();
  });

  it("creates a file through maintenance controls and surfaces path validation inline", async () => {
    const user = userEvent.setup();
    renderDream();

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
