import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCanonicalSeed, createCanonicalServerState } from "../../src/domain";
import EvalRoute from "../../src/routes/eval/eval-route";
import { AppStoreProvider } from "../../src/store/app-store-context";
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
      const max899 = query.includes("899px") && width <= 899;
      const max1199 = query.includes("1199px") && width <= 1199;
      const min1200 = query.includes("1200px") && width >= 1200;
      const max339 = query.includes("339px") && width <= 339;
      return {
        matches: max899 || max1199 || min1200 || max339,
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
          <Route path="/dream" element={<div>Dream destination</div>} />
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

  it("keeps cases dominant and reduces the overview to release decisions", () => {
    renderEval();

    expect(screen.getByRole("heading", { name: "Evaluation Lab" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Eval overview" })).toHaveTextContent("Regression guard");
    expect(screen.getByRole("region", { name: "Eval overview" })).toHaveTextContent("Open failures");
    expect(screen.getByRole("table", { name: "Evaluation cases" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Case" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Patient context" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Result" })).toBeInTheDocument();
    expect(screen.getByText("Emergency chest pain")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter by evaluation use" })).toHaveDisplayValue(
      "All case roles",
    );
    expect(screen.queryByRole("complementary", { name: "Evaluation support" })).not.toBeInTheDocument();
    expect(screen.queryByText("Mean judge")).not.toBeInTheDocument();
    expect(screen.queryByText("Last delta")).not.toBeInTheDocument();
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
      expect(screen.getByRole("button", { name: "Run Suite" })).toBeDisabled(),
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

    const row = screen.getByRole("row", { name: /Emergency chest pain/i });
    row.focus();
    await user.keyboard("{Enter}");
    const details = screen.getByRole("dialog", { name: "Case details" });
    await user.hover(within(details).getByRole("term", { name: "Staff-approved reply" }));
    const expectedTooltip = screen.getByRole("tooltip", {
      name: /staff-approved reply used only as grading reference evidence/i,
    });
    expect(expectedTooltip).toBeInTheDocument();
    expect(expectedTooltip.parentElement).toBe(document.body);
    expect(within(details).getByText("Patient conversation")).toBeInTheDocument();
  });

  it("runs one case with visible progress and keeps staff evidence inside case details", async () => {
    const user = userEvent.setup();
    renderEval({ store: createPendingEvalStore() });

    const row = screen.getByRole("row", { name: /Emergency chest pain/i });
    expect(within(row).queryByText("Expected human HITL")).not.toBeInTheDocument();
    expect(within(row).queryByText("Actual synthetic")).not.toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Run Emergency chest pain" }));
    expect(within(row).getByRole("button", { name: "Cancel Emergency chest pain run" })).toBeInTheDocument();
    expect(within(row).getByText("Replaying...")).toBeInTheDocument();

    await waitFor(() => expect(within(row).getByText("Fail")).toBeInTheDocument());
    await user.click(row);
    const evidence = screen.getByRole("dialog", { name: "Case details" });
    expect(evidence).toHaveTextContent(/Synthetic demo response/);
    expect(evidence).toHaveTextContent(/Simulated fixture verdict/);
    expect(evidence).toHaveTextContent(/Emergency direction.*fail/i);
    expect(evidence).toHaveTextContent("Fixture required rubric failed");
    await user.click(within(evidence).getByText("Run details"));
    expect(evidence).toHaveTextContent(/ModeSimulated/);
  });

  it("routes required judge uncertainty to Needs review", async () => {
    const user = userEvent.setup();
    const store = createAppStore(new MemoryStorage(), {
      judgeClient: createFixtureJudgeClient({
        delayMs: 20,
        verdictByCase: { "case-emergency-train": "needs_review" },
      }),
    });
    renderEval({ store });

    const row = screen.getByRole("row", { name: /Emergency chest pain/i });
    await user.click(within(row).getByRole("button", { name: "Run Emergency chest pain" }));
    await waitFor(() => expect(within(row).getByText("Needs review")).toBeInTheDocument());
  });

  it("keeps prior case state unchanged on judge error and allows retry", async () => {
    const user = userEvent.setup();
    const fixture = createFixtureJudgeClient();
    let attempts = 0;
    const store = createAppStore(new MemoryStorage(), {
      judgeClient: {
        async judge(request, signal) {
          attempts += 1;
          if (attempts === 1) {
            throw new Error("Judge temporarily unavailable");
          }
          return fixture.judge(request, signal);
        },
      },
    });
    renderEval({ store });

    const row = screen.getByRole("row", { name: /Emergency chest pain/i });
    await user.click(within(row).getByRole("button", { name: "Run Emergency chest pain" }));
    await waitFor(() =>
      expect(screen.getByText("Judge temporarily unavailable")).toBeInTheDocument(),
    );
    expect(within(row).getAllByText("Not run")).toHaveLength(1);

    await user.click(within(row).getByRole("button", { name: "Run Emergency chest pain" }));
    await waitFor(() => expect(within(row).getByText("Fail")).toBeInTheDocument());
    expect(attempts).toBe(2);
  });

  it("runs the suite and exposes history only on request", async () => {
    const user = userEvent.setup();
    renderEval();

    await user.click(screen.getByRole("button", { name: "Run Suite" }));
    expect(screen.getByRole("button", { name: "Cancel suite" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cancel suite" })).not.toBeInTheDocument());
    expect(screen.getByRole("region", { name: "Evaluation summary" })).toHaveTextContent(/Regression guard/);
    await user.click(screen.getByRole("button", { name: "More evaluation actions" }));
    await user.click(screen.getByRole("menuitem", { name: "History" }));
    expect(screen.getByRole("region", { name: "Suite history" })).not.toHaveTextContent(
      "Run the suite to create history.",
    );
  });

  it("marks the active suite row while completed rows keep their results", async () => {
    const user = userEvent.setup();
    const store = createAppStore(new MemoryStorage(), {
      judgeClient: createFixtureJudgeClient({ delayMs: 500 }),
    });
    renderEval({ store });

    const emergencyRow = screen.getByRole("row", { name: /Emergency chest pain/i });
    const bookingRow = screen.getByRole("row", { name: /Malay booking/i });
    await user.click(screen.getByRole("button", { name: "Run Suite" }));

    expect(within(emergencyRow).getByText("Replaying...")).toBeInTheDocument();
    expect(within(bookingRow).getByText("Not run")).toBeInTheDocument();
    await waitFor(() => expect(within(emergencyRow).getByText("Fail")).toBeInTheDocument());
    await waitFor(() => expect(within(bookingRow).getByText("Replaying...")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Cancel suite" }));
  });

  it("blocks opening a case while another evaluation operation runs", async () => {
    const user = userEvent.setup();
    renderEval();
    const row = screen.getByRole("row", { name: /Emergency chest pain/i });

    await user.click(screen.getByRole("button", { name: "Run Suite" }));

    expect(screen.getByRole("button", { name: "Cancel suite" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Edit Emergency chest pain" })).toBeDisabled();
    expect(within(row).getByRole("button", { name: "Duplicate Emergency chest pain" })).toBeDisabled();
    expect(within(row).getByRole("button", { name: "Delete Emergency chest pain" })).toBeDisabled();
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
    expect(confirm).toHaveTextContent(/run history|pending Dream corrections/i);
    await user.click(within(confirm).getByRole("button", { name: "Delete case" }));
    expect(screen.queryByText("Walk-in follow-up", { exact: true })).not.toBeInTheDocument();
  });

  it("keeps generated synthetic output out of the editable case definition", async () => {
    const user = userEvent.setup();
    renderEval();

    await user.click(screen.getByRole("button", { name: "Run Emergency chest pain" }));
    const row = screen.getByRole("row", { name: /Emergency chest pain/i });
    await waitFor(() => expect(within(row).getByText("Fail", { exact: true })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Edit Emergency chest pain" }));

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
    await user.type(within(datasetDialog).getByRole("textbox", { name: "Dataset name" }), "Clinic QA");
    await user.click(within(datasetDialog).getByRole("button", { name: "Create dataset" }));
    expect(screen.getByRole("combobox", { name: "Dataset" })).toHaveValue("dataset-clinic-qa");

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
        conversationId: "convo-booking",
        text: "A human reviewer confirmed the requested appointment details.",
        kind: "reply",
      }).ok,
    ).toBe(true);
    expect(store.getState().resolveConversation("convo-booking").ok).toBe(true);
    renderEval({ store });

    await user.click(screen.getByRole("button", { name: "More evaluation actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Import resolved conversations" }));
    const dialog = screen.getByRole("dialog", { name: "Import resolved conversations" });
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("checkbox", { name: "Select all available conversations" }),
    );
    expect(within(dialog).getByRole("checkbox", { name: /Nurul Aisyah/ })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /Rajesh Kumar/ })).toBeChecked();
    await user.click(
      within(dialog).getByRole("button", { name: "Import 2 conversations" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Import resolved conversations" })).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "More evaluation actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Import resolved conversations" }));
    const reopened = screen.getByRole("dialog", { name: "Import resolved conversations" });
    expect(within(reopened).getByRole("checkbox", { name: /Nurul Aisyah/ })).toBeDisabled();
    expect(within(reopened).getByRole("checkbox", { name: /Rajesh Kumar/ })).toBeDisabled();
    expect(within(reopened).getAllByText("Already imported")).toHaveLength(2);
  });

  it("explains why unresolved conversations cannot be imported", async () => {
    const user = userEvent.setup();
    renderEval();

    await user.click(screen.getByRole("button", { name: "More evaluation actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Import resolved conversations" }));
    const dialog = screen.getByRole("dialog", { name: "Import resolved conversations" });
    expect(within(dialog).getByRole("checkbox", { name: /Nurul Aisyah/ })).toBeDisabled();
    expect(within(dialog).getAllByText("Resolve in Chat").length).toBeGreaterThan(0);
  });

  it("analyzes committed failures without rerunning or changing the evaluated dataset", async () => {
    const user = userEvent.setup();
    const store = createAppStore(new MemoryStorage(), {
      judgeClient: createFixtureJudgeClient(),
    });
    const added = store.getState().addCase({
      datasetId: "dataset-seed",
      title: "Analysis-only emergency failure",
      split: "train",
      type: "emergency_triage",
      language: "English",
      inputConversation: {
        messages: [
          {
            id: "analysis-only-message",
            role: "patient",
            text: "I have severe chest pain.",
            sentAt: "2026-07-08T10:00:00+08:00",
          },
        ],
      },
      expectedHumanOutput: "Call 999 and seek emergency care now.",
      criterionIds: [],
    });
    expect(added.ok).toBe(true);
    const addedCase = store
      .getState()
      .state.evalDatasets[0]!.cases.find(
        (evalCase) => evalCase.title === "Analysis-only emergency failure",
      );
    expect(addedCase).toBeDefined();
    if (!addedCase) return;
    const run = await store.getState().runEvalCase(addedCase.id);
    expect(run.ok).toBe(true);
    const beforeDataset = structuredClone(store.getState().state.evalDatasets[0]!);
    const beforeCorrections = store.getState().state.corrections.length;
    const beforeFeedback = store.getState().lastFeedback;
    renderEval({ store });

    await user.click(screen.getByRole("button", { name: "More evaluation actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Analyze failures" }));
    const drawer = screen.getByRole("complementary", { name: "Analyze failures" });
    expect(drawer).toHaveTextContent(
      "A configured LLM proposes one reviewable SOP diff from committed train failures.",
    );
    expect(within(drawer).queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
    const failedHeading = within(drawer).getByRole("heading", { name: "Failed train cases" });
    const proposalsHeading = within(drawer).getByRole("heading", {
      name: "Proposed Dream corrections",
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
        name: /Open pending correction for Analysis-only emergency failure in Dream/,
      }),
    ).toBeInTheDocument();
  });

  it("explains when there are no committed failed train cases to analyze", async () => {
    const user = userEvent.setup();
    renderEval();

    await user.click(screen.getByRole("button", { name: "More evaluation actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Analyze failures" }));
    const drawer = screen.getByRole("complementary", { name: "Analyze failures" });

    expect(drawer).toHaveTextContent("The selected suite has no failed train cases.");
    expect(within(drawer).getByRole("button", { name: "Start analysis" })).toBeDisabled();
    expect(within(drawer).getByText("No proposed Dream corrections.")).toBeInTheDocument();
  });

  it("shows only pending corrections in failure analysis", async () => {
    const user = userEvent.setup();
    const store = createAppStore(new MemoryStorage(), {
      judgeClient: createFixtureJudgeClient(),
    });
    const emergencyCase = store
      .getState()
      .state.evalDatasets[0]!.cases.find(
        (evalCase) => evalCase.type === "emergency_triage" && evalCase.split === "train",
      )!;
    expect((await store.getState().runEvalCase(emergencyCase.id)).ok).toBe(true);
    expect(store.getState().rejectCorrection("corr-triage").ok).toBe(true);
    renderEval({ store });

    await user.click(screen.getByRole("button", { name: "More evaluation actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Analyze failures" }));
    const drawer = screen.getByRole("complementary", { name: "Analyze failures" });

    expect(
      within(drawer).queryByRole("button", {
        name: /Open rejected correction/,
      }),
    ).not.toBeInTheDocument();
    expect(within(drawer).getByText("No proposed Dream corrections.")).toBeInTheDocument();
  });

  it("blocks analysis while a case or suite judge operation is active", async () => {
    const user = userEvent.setup();
    const store = createAppStore(new MemoryStorage(), {
      judgeClient: createFixtureJudgeClient({ delayMs: 100 }),
    });
    const emergencyCase = store
      .getState()
      .state.evalDatasets[0]!.cases.find(
        (evalCase) => evalCase.type === "emergency_triage" && evalCase.split === "train",
      )!;
    expect((await store.getState().runEvalCase(emergencyCase.id)).ok).toBe(true);
    renderEval({ store });

    await user.click(screen.getByRole("button", { name: "More evaluation actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Analyze failures" }));
    const drawer = screen.getByRole("complementary", { name: "Analyze failures" });
    await user.click(screen.getByRole("button", { name: "Run Suite" }));

    expect(screen.getByRole("button", { name: "Cancel suite" })).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Start analysis" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel suite" }));
  });

  it("uses compact case cards and a scrollable details dialog on 320px", async () => {
    const user = userEvent.setup();
    renderEval({ width: 320 });

    expect(screen.queryByRole("table", { name: "Evaluation cases" })).not.toBeInTheDocument();
    const card = screen.getByRole("article", { name: "Emergency chest pain" });
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

    await user.click(screen.getByRole("button", { name: "Run Suite" }));
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
    const importView = renderEval({ entry: "/eval?import=convo-booking" });
    const importDialog = await screen.findByRole("dialog", {
      name: "Import resolved conversations",
    });
    expect(within(importDialog).getByRole("checkbox", { name: /Nurul Aisyah/ })).not.toBeChecked();
    expect(within(importDialog).getAllByText("Resolve in Chat").length).toBeGreaterThan(0);
    importView.unmount();

    renderEval({ entry: "/eval?case=case-emergency-train" });
    expect(
      await screen.findByRole("dialog", { name: "Case details" }),
    ).toHaveTextContent("Emergency chest pain");
  });

  it("cancels a pending case commit when the route unmounts", async () => {
    const user = userEvent.setup();
    const { store, unmount } = renderEval({ store: createPendingEvalStore() });

    await user.click(screen.getByRole("button", { name: "Run Emergency chest pain" }));
    unmount();
    await new Promise((resolve) => window.setTimeout(resolve, 220));

    const evalCase = store
      .getState()
      .state.evalDatasets[0]!.cases.find((candidate) => candidate.id === "case-emergency-train");
    expect(evalCase?.grade).toBeUndefined();
    expect(evalCase?.actualSyntheticOutput).toBeUndefined();
  });
});
