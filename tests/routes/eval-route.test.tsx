import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCanonicalSeed, createCanonicalServerState } from "../../src/domain";
import EvalRoute from "../../src/routes/eval/eval-route";
import { AppStoreProvider } from "../../src/store/app-store-context";
import { saveAppState } from "../../src/store/repository";
import { createAppStore, type AppStore } from "../../src/store/use-app-store";
import { createFixtureJudgeClient } from "../fixtures/judge-client";

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

function installMatchMedia(width: number) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      const minimum = query.match(/min-width:\s*(\d+)px/);
      const maximum = query.match(/max-width:\s*(\d+)px/);
      return {
        matches:
          (!minimum || width >= Number(minimum[1])) &&
          (!maximum || width <= Number(maximum[1])),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      };
    },
  });
}

function renderEval(options: { width?: number; store?: AppStore; entry?: string } = {}) {
  installMatchMedia(options.width ?? 1440);
  const store =
    options.store ??
    createAppStore(new MemoryStorage(), { judgeClient: createFixtureJudgeClient({ delayMs: 40 }) });
  const result = render(
    <AppStoreProvider store={store}>
      <MemoryRouter initialEntries={[options.entry ?? "/eval"]}>
        <Routes>
          <Route path="/eval" element={<EvalRoute />} />
          <Route path="/knowledge" element={<div>Knowledge destination</div>} />
        </Routes>
      </MemoryRouter>
    </AppStoreProvider>,
  );
  return { ...result, store };
}

function createPendingEvalStore() {
  return createAppStore(new MemoryStorage(), {
    judgeClient: createFixtureJudgeClient({ delayMs: 1_000 }),
  });
}

describe("Evaluation Lab route", () => {
  beforeEach(() => {
    installMatchMedia(1440);
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps cases dominant and completes the desktop evaluation support rail", () => {
    renderEval();

    expect(screen.getByRole("heading", { name: "Evaluation Lab" })).toBeInTheDocument();
    const support = screen.getByRole("complementary", { name: "Evaluation support" });
    expect(support).toHaveTextContent("Regression guard");
    expect(support).toHaveTextContent("Open failures");
    expect(within(support).getByRole("region", { name: "Suite history" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Evaluation cases" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Case" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Customer context" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Result" })).toBeInTheDocument();
    expect(screen.getByText("Combined symptoms need chemical wash")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter by evaluation use" })).toHaveDisplayValue(
      "All case roles",
    );
    expect(screen.queryByText("Mean judge")).not.toBeInTheDocument();
    expect(screen.queryByText("Last delta")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Run a failed train case first" }),
    ).toBeDisabled();
  });

  it("moves evaluation support above the cases at middle desktop widths", () => {
    renderEval({ width: 1_100 });

    const support = screen.getByRole("region", { name: "Evaluation support" });
    expect(within(support).getByRole("region", { name: "Evaluation summary" })).toBeInTheDocument();
    expect(within(support).getByRole("region", { name: "Suite history" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Evaluation support" })).not.toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Evaluation cases" })).toBeInTheDocument();
  });

  it("blocks Eval runs when the configured server reports execution is unavailable", async () => {
    const state = await createCanonicalServerState();
    const store = createAppStore(new MemoryStorage(), {
      evalClient: {
        async executionCapability() {
          return { enabled: false, reason: "Eval execution is not configured." };
        },
        async createSuite() {
          throw new Error("should not run");
        },
        async runCase() {
          throw new Error("should not run");
        },
      },
      workspaceClient: {
        async load() {
          return { revision: 1, state, workspaceId: "demo" };
        },
      },
    });
    renderEval({ store });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Run all cases" })).toBeDisabled(),
    );
    const status = screen.getByText("Eval execution is not configured.").closest(".operation-status");
    expect(status).toHaveClass("operation-status--failed");
  });

  it("defines evaluation terms on hover or focus without adding explanation panels", async () => {
    const user = userEvent.setup();
    renderEval();

    const regressionGuard = screen.getAllByRole("term", { name: "Regression guard" })[0]!;
    act(() => regressionGuard.focus());
    await waitFor(() =>
      expect(
        screen.getByRole("tooltip", { name: /held out from SOP improvement/i }),
      ).toBeInTheDocument(),
    );
    act(() => regressionGuard.blur());

    const row = screen.getByRole("row", { name: /Combined symptoms need chemical wash/i });
    row.focus();
    await user.keyboard("{Enter}");
    const details = screen.getByRole("dialog", { name: "Case details" });
    await user.hover(within(details).getByRole("term", { name: "Staff-approved reply" }));
    const expectedTooltip = screen.getByRole("tooltip", {
      name: /staff-approved reply used only as grading reference evidence/i,
    });
    expect(expectedTooltip).toBeInTheDocument();
    expect(expectedTooltip.parentElement).toBe(document.body);
    expect(within(details).getByText("Customer conversation")).toBeInTheDocument();
  });

  it("runs one case with visible progress and keeps staff evidence inside case details", async () => {
    const user = userEvent.setup();
    renderEval({ store: createPendingEvalStore() });

    const row = screen.getByRole("row", { name: /Combined symptoms need chemical wash/i });
    expect(within(row).queryByText("Expected human HITL")).not.toBeInTheDocument();
    expect(within(row).queryByText("Actual synthetic")).not.toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Run Combined symptoms need chemical wash" }));
    expect(within(row).getByRole("button", { name: "Cancel Combined symptoms need chemical wash run" })).toBeInTheDocument();
    expect(within(row).getByText("Replaying...")).toBeInTheDocument();

    await waitFor(() => expect(within(row).getByText("Fail")).toBeInTheDocument());
    await user.click(row);
    const evidence = screen.getByRole("dialog", { name: "Case details" });
    expect(evidence).toHaveTextContent(/Synthetic demo response/);
    expect(evidence).toHaveTextContent(/Simulated fixture verdict/);
    expect(evidence).toHaveTextContent(/Package selection.*fail/i);
    expect(evidence).toHaveTextContent("Fixture required rubric failed");
    await user.click(within(evidence).getByText("Run details"));
    expect(evidence).toHaveTextContent(/ModeSimulated/);
  });

  it("routes required judge uncertainty to Needs review", async () => {
    const user = userEvent.setup();
    const store = createAppStore(new MemoryStorage(), {
      judgeClient: createFixtureJudgeClient({
        delayMs: 20,
        verdictByCase: { "case-aircon-selection-train": "needs_review" },
      }),
    });
    renderEval({ store });

    const row = screen.getByRole("row", { name: /Combined symptoms need chemical wash/i });
    await user.click(within(row).getByRole("button", { name: "Run Combined symptoms need chemical wash" }));
    await waitFor(() => expect(within(row).getByText("Needs review")).toBeInTheDocument());
  });

  it("keeps prior case state unchanged on invalid judge evidence and allows retry", async () => {
    const user = userEvent.setup();
    const fixture = createFixtureJudgeClient();
    let attempts = 0;
    const store = createAppStore(new MemoryStorage(), {
      judgeClient: {
        async judge(request, signal) {
          attempts += 1;
          if (attempts === 1) {
            throw new Error(
              "The model provider returned invalid judge evidence. Retry the run; if it repeats, check the judge model configuration.",
            );
          }
          return fixture.judge(request, signal);
        },
      },
    });
    renderEval({ store });

    const row = screen.getByRole("row", { name: /Combined symptoms need chemical wash/i });
    await user.click(within(row).getByRole("button", { name: "Run Combined symptoms need chemical wash" }));
    await waitFor(() =>
      expect(
        screen.getByText(
          "The model provider returned invalid judge evidence. Retry the run; if it repeats, check the judge model configuration.",
        ),
      ).toBeInTheDocument(),
    );
    expect(within(row).getAllByText("Not run")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Retry last evaluation run" }));
    await waitFor(() => expect(within(row).getByText("Fail")).toBeInTheDocument());
    expect(attempts).toBe(2);
  });

  it("runs all cases and updates desktop suite history", async () => {
    const user = userEvent.setup();
    renderEval();

    await user.click(screen.getByRole("button", { name: "Run all cases" }));
    expect(screen.getByRole("button", { name: "Cancel suite" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cancel suite" })).not.toBeInTheDocument());
    expect(screen.getByRole("complementary", { name: "Evaluation support" })).toHaveTextContent(
      /Regression guard/,
    );
    expect(screen.getByRole("region", { name: "Suite history" })).not.toHaveTextContent(
      "Run all cases to create history.",
    );
  });

  it("marks the active suite row while completed rows keep their results", async () => {
    const user = userEvent.setup();
    const store = createAppStore(new MemoryStorage(), {
      judgeClient: createFixtureJudgeClient({ delayMs: 500 }),
    });
    renderEval({ store });

    const emergencyRow = screen.getByRole("row", { name: /Malay general-service price/i });
    const bookingRow = screen.getByRole("row", { name: /Combined symptoms need chemical wash/i });
    await user.click(screen.getByRole("button", { name: "Run all cases" }));

    expect(within(emergencyRow).getByText("Replaying...")).toBeInTheDocument();
    expect(within(bookingRow).getByText("Not run")).toBeInTheDocument();
    await waitFor(() => expect(within(emergencyRow).getByText("Pass")).toBeInTheDocument());
    await waitFor(() => expect(within(bookingRow).getByText("Replaying...")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Cancel suite" }));
  });

  it("blocks opening a case while another evaluation operation runs", async () => {
    const user = userEvent.setup();
    renderEval();
    const row = screen.getByRole("row", { name: /Combined symptoms need chemical wash/i });

    await user.click(screen.getByRole("button", { name: "Run all cases" }));

    expect(screen.getByRole("button", { name: "Cancel suite" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Edit Combined symptoms need chemical wash" })).toBeDisabled();
    expect(within(row).getByRole("button", { name: "Duplicate Combined symptoms need chemical wash" })).toBeDisabled();
    expect(within(row).getByRole("button", { name: "Delete Combined symptoms need chemical wash" })).toBeDisabled();
    await user.click(row);
    expect(screen.queryByRole("dialog", { name: "Case details" })).not.toBeInTheDocument();
  });

  it("supports case CRUD with explicit destructive confirmation", async () => {
    const user = userEvent.setup();
    renderEval();

    await user.click(screen.getByRole("button", { name: "New manual test" }));
    const dialog = screen.getByRole("dialog", { name: "New manual test" });
    expect(dialog).toHaveTextContent(
      "Conversation input -> synthetic reply -> expected staff reply + scoring rules",
    );
    expect(dialog).toHaveTextContent(/single-message manual test/i);
    await user.type(within(dialog).getByRole("textbox", { name: "Test name" }), "Walk-in follow-up");
    await user.type(
      within(dialog).getByRole("textbox", { name: "Conversation input" }),
      "I am at the clinic.",
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: "Expected staff reply" }),
      "Please proceed to registration.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Add test" }));
    expect(screen.getByText("Walk-in follow-up")).toBeInTheDocument();

    const row = screen.getByRole("row", { name: /Walk-in follow-up/i });
    await user.click(within(row).getByRole("button", { name: "Duplicate Walk-in follow-up" }));
    expect(screen.getByText("Walk-in follow-up copy")).toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: "Delete Walk-in follow-up" }));
    const confirm = screen.getByRole("alertdialog");
    expect(confirm).toHaveTextContent(/run history|pending Knowledge corrections/i);
    await user.click(within(confirm).getByRole("button", { name: "Delete case" }));
    expect(screen.queryByText("Walk-in follow-up", { exact: true })).not.toBeInTheDocument();
  });

  it("keeps generated synthetic output out of the editable case definition", async () => {
    const user = userEvent.setup();
    renderEval();

    await user.click(screen.getByRole("button", { name: "Run Combined symptoms need chemical wash" }));
    const row = screen.getByRole("row", { name: /Combined symptoms need chemical wash/i });
    await waitFor(() => expect(within(row).getByText("Fail", { exact: true })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Edit Combined symptoms need chemical wash" }));

    const dialog = screen.getByRole("dialog", { name: "Edit evaluation case" });
    expect(
      within(dialog).queryByRole("textbox", { name: "Actual synthetic output" }),
    ).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent("Generated output is run evidence and cannot be edited here.");
  });

  it("supports dataset and criterion maintenance from More", async () => {
    const user = userEvent.setup();
    renderEval();

    await user.click(screen.getByRole("button", { name: "More evaluation actions" }));
    await user.click(screen.getByRole("menuitem", { name: "New Dataset" }));
    const datasetDialog = screen.getByRole("dialog", { name: "New dataset" });
    await user.type(within(datasetDialog).getByRole("textbox", { name: "Dataset name" }), "Aircon QA");
    await user.click(within(datasetDialog).getByRole("button", { name: "Create dataset" }));
    expect(screen.getByRole("combobox", { name: "Dataset" })).toHaveValue("dataset-aircon-qa");

    await user.click(screen.getByRole("button", { name: "More evaluation actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Scoring rules" }));
    const criteriaDialog = screen.getByRole("dialog", { name: "Scoring rules" });
    expect(criteriaDialog).toHaveTextContent(/plain-language description/i);
    expect(within(criteriaDialog).queryByLabelText("Text to check")).not.toBeInTheDocument();
    expect(within(criteriaDialog).queryByLabelText("Rule behavior")).not.toBeInTheDocument();
    await user.click(within(criteriaDialog).getByRole("button", { name: "Add scoring rule" }));
    await user.type(within(criteriaDialog).getByRole("textbox", { name: "Rule name" }), "Registration");
    await user.type(
      within(criteriaDialog).getByRole("textbox", { name: "What should a good reply do?" }),
      "Explain the next registration step without inventing a completed action.",
    );
    await user.click(within(criteriaDialog).getByRole("checkbox", { name: "Required to pass" }));
    await user.click(within(criteriaDialog).getByRole("button", { name: "Advanced" }));
    await user.type(
      within(criteriaDialog).getByRole("textbox", { name: "Good example" }),
      "Please visit counter two.",
    );
    await user.type(
      within(criteriaDialog).getByRole("textbox", { name: "Bad example" }),
      "Your registration is already complete.",
    );
    await user.click(within(criteriaDialog).getByRole("button", { name: "Save rule" }));
    expect(within(criteriaDialog).getByText("Registration")).toBeInTheDocument();
    expect(within(criteriaDialog).getByText(/Required to pass/)).toBeInTheDocument();
  });

  it("multi-selects resolved conversations and disables them after import", async () => {
    const user = userEvent.setup();
    const store = createAppStore(new MemoryStorage());
    expect(
      store.getState().sendStaffReply({
        conversationId: "convo-aircon-booking",
        text: "A human reviewer confirmed the requested appointment details.",
        kind: "reply",
      }).ok,
    ).toBe(true);
    expect(store.getState().resolveConversation("convo-aircon-booking").ok).toBe(true);
    renderEval({ store });

    await user.click(screen.getByRole("button", { name: "More evaluation actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Import resolved conversations" }));
    const dialog = screen.getByRole("dialog", { name: "Import resolved conversations" });
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("checkbox", { name: "Select all available conversations" }),
    );
    expect(within(dialog).getByRole("checkbox", { name: /Mei Demo/ })).toBeChecked();
    await user.click(
      within(dialog).getByRole("button", { name: "Import 2 conversations" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Import resolved conversations" })).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "More evaluation actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Import resolved conversations" }));
    const reopened = screen.getByRole("dialog", { name: "Import resolved conversations" });
    expect(within(reopened).getByRole("checkbox", { name: /Mei Demo/ })).toBeDisabled();
    expect(within(reopened).getAllByText("Already imported")).toHaveLength(2);
  });

  it("explains why unresolved conversations cannot be imported", async () => {
    const user = userEvent.setup();
    renderEval();

    await user.click(screen.getByRole("button", { name: "More evaluation actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Import resolved conversations" }));
    const dialog = screen.getByRole("dialog", { name: "Import resolved conversations" });
    expect(within(dialog).getByRole("checkbox", { name: /Aina Demo/ })).toBeDisabled();
    expect(within(dialog).getAllByText("Resolve in Chat").length).toBeGreaterThan(0);
  });

  it("analyzes committed failures without rerunning or changing the evaluated dataset", async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    let store = createAppStore(storage, {
      judgeClient: createFixtureJudgeClient(),
    });
    const added = store.getState().addCase({
      datasetId: "dataset-aircon-ops",
      title: "Analysis-only selection failure",
      split: "train",
      type: "general",
      language: "English",
      inputConversation: {
        messages: [
          {
            id: "analysis-only-message",
            role: "patient",
            text: "My 1.5 HP wall unit is not cooling and smells musty.",
            sentAt: "2026-07-08T10:00:00+08:00",
          },
        ],
      },
      expectedHumanOutput:
        "For poor cooling and a musty smell, I recommend the RM160 chemical wash for one supported unit.",
      criterionIds: ["crit-aircon-selection"],
    });
    expect(added.ok).toBe(true);
    const addedCase = store
      .getState()
      .state.evalDatasets[0]!.cases.find(
        (evalCase) => evalCase.title === "Analysis-only selection failure",
      );
    expect(addedCase).toBeDefined();
    if (!addedCase) return;
    store = createAppStore(storage, {
      judgeClient: createFixtureJudgeClient({ verdictByCase: { [addedCase.id]: "fail" } }),
    });
    const run = await store.getState().runEvalCase(addedCase.id);
    expect(run.ok).toBe(true);
    const beforeDataset = structuredClone(store.getState().state.evalDatasets[0]!);
    const beforeCorrections = store.getState().state.corrections.length;
    const beforeFeedback = store.getState().lastFeedback;
    renderEval({ store });

    await user.click(screen.getByRole("button", { name: "Analyze failures" }));
    const drawer = screen.getByRole("complementary", { name: "Analyze failures" });
    expect(drawer).toHaveTextContent(
      "The configured correction proposer creates one reviewable SOP diff from committed train failures.",
    );
    expect(within(drawer).queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
    const failedHeading = within(drawer).getByRole("heading", { name: "Failed train cases" });
    const proposalsHeading = within(drawer).getByRole("heading", {
      name: "Proposed Knowledge corrections",
    });
    expect(
      failedHeading.compareDocumentPosition(proposalsHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(within(drawer).getByRole("button", { name: "Start analysis" }));

    expect(within(drawer).getByText("Analysis complete.")).toBeInTheDocument();
    expect(store.getState().state.evalDatasets[0]).toEqual(beforeDataset);
    expect(store.getState().state.corrections).toHaveLength(beforeCorrections + 1);
    expect(store.getState().lastFeedback).toBe(beforeFeedback);
    expect(
      within(drawer).getByRole("button", {
        name: /Open pending correction for Analysis-only selection failure in Knowledge/,
      }),
    ).toBeInTheDocument();
  });

  it("explains when there are no committed failed train cases to analyze", async () => {
    renderEval();

    const analyze = screen.getByRole("button", {
      name: "Run a failed train case first",
    });
    expect(analyze).toBeDisabled();
    expect(analyze).toHaveAttribute(
      "title",
      "Run train cases and commit at least one failure first.",
    );
    expect(
      screen.queryByRole("complementary", { name: "Analyze failures" }),
    ).not.toBeInTheDocument();
  });

  it("shows only pending corrections in failure analysis", async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    const seed = createCanonicalSeed();
    seed.corrections.push({
      id: "corr-aircon-selection",
      fileId: "file-aircon-service-selection",
      oldText: "For poor cooling and a musty smell, quote the RM99 general service.",
      newText:
        "If a wall-mounted 1.0-1.5 HP unit has both poor cooling and a musty smell, recommend the RM160 chemical wash. Do not quote the RM99 general service.",
      evidence: "Combined symptoms need chemical wash.",
      status: "pending",
      sourceCaseId: "case-aircon-selection-train",
    });
    saveAppState(storage, seed);
    const store = createAppStore(storage, {
      judgeClient: createFixtureJudgeClient({
        verdictByCase: { "case-aircon-selection-train": "fail" },
      }),
    });
    expect(
      (await store.getState().runEvalCase("case-aircon-selection-train")).ok,
    ).toBe(true);
    expect(store.getState().rejectCorrection("corr-aircon-selection").ok).toBe(true);
    renderEval({ store });

    await user.click(screen.getByRole("button", { name: "Analyze failures" }));
    const drawer = screen.getByRole("complementary", { name: "Analyze failures" });

    expect(
      within(drawer).queryByRole("button", {
        name: /Open rejected correction/,
      }),
    ).not.toBeInTheDocument();
    expect(within(drawer).getByText("No proposed Knowledge corrections.")).toBeInTheDocument();
  });

  it("blocks analysis while a case or suite judge operation is active", async () => {
    const user = userEvent.setup();
    const store = createAppStore(new MemoryStorage(), {
      judgeClient: createFixtureJudgeClient({ delayMs: 100 }),
    });
    const selectionCase = store
      .getState()
      .state.evalDatasets[0]!.cases.find(
        (evalCase) => evalCase.id === "case-aircon-selection-train",
      )!;
    expect((await store.getState().runEvalCase(selectionCase.id)).ok).toBe(true);
    renderEval({ store });

    await user.click(screen.getByRole("button", { name: "Analyze failures" }));
    const drawer = screen.getByRole("complementary", { name: "Analyze failures" });
    await user.click(screen.getByRole("button", { name: "Run all cases" }));

    expect(screen.getByRole("button", { name: "Cancel suite" })).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Start analysis" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel suite" }));
  });

  it("uses compact case cards and a scrollable details dialog on 320px", async () => {
    const user = userEvent.setup();
    renderEval({ width: 320 });

    expect(screen.queryByRole("table", { name: "Evaluation cases" })).not.toBeInTheDocument();
    const card = screen.getByRole("article", { name: "Combined symptoms need chemical wash" });
    expect(card).toHaveTextContent(/Synthetic scenario|Improve SOP|Not run/);
    const actions = within(card).getByRole("group", { name: "Case actions" });
    expect(within(actions).getAllByRole("button")).toHaveLength(4);

    await user.click(screen.getByRole("button", { name: "More evaluation actions" }));
    await user.click(screen.getByRole("menuitem", { name: "History" }));
    expect(screen.getByRole("complementary", { name: "Evaluation history" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close history" }));

    await user.click(card);
    expect(screen.getByRole("dialog", { name: "Case details" })).toBeInTheDocument();
  });

  it("cancels an in-flight suite when the global demo resets", async () => {
    const user = userEvent.setup();
    const { store } = renderEval({ store: createPendingEvalStore() });

    await user.click(screen.getByRole("button", { name: "Run all cases" }));
    expect(screen.getByRole("button", { name: "Cancel suite" })).toBeInTheDocument();

    act(() => {
      store.getState().resetDemo();
    });

    expect(screen.queryByRole("button", { name: "Cancel suite" })).not.toBeInTheDocument();
    expect(screen.queryByText("Demo reset to canonical seed.")).not.toBeInTheDocument();
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    expect(store.getState().state).toEqual(createCanonicalSeed());
  });

  it("consumes import and case deep links into the requested local workflow", async () => {
    const importView = renderEval({ entry: "/eval?import=convo-aircon-booking" });
    const importDialog = await screen.findByRole("dialog", {
      name: "Import resolved conversations",
    });
    expect(within(importDialog).getByRole("checkbox", { name: /Aina Demo/ })).not.toBeChecked();
    expect(within(importDialog).getAllByText("Resolve in Chat").length).toBeGreaterThan(0);
    importView.unmount();

    renderEval({ entry: "/eval?case=case-aircon-selection-train" });
    expect(
      await screen.findByRole("dialog", { name: "Case details" }),
    ).toHaveTextContent("Combined symptoms need chemical wash");
  });

  it("cancels a pending case commit when the route unmounts", async () => {
    const user = userEvent.setup();
    const { store, unmount } = renderEval({ store: createPendingEvalStore() });

    await user.click(screen.getByRole("button", { name: "Run Combined symptoms need chemical wash" }));
    unmount();
    await new Promise((resolve) => window.setTimeout(resolve, 220));

    const evalCase = store
      .getState()
      .state.evalDatasets[0]!.cases.find((candidate) => candidate.id === "case-aircon-selection-train");
    expect(evalCase?.grade).toBeUndefined();
    expect(evalCase?.actualSyntheticOutput).toBeUndefined();
  });
});
