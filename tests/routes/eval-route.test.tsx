import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCanonicalSeed } from "../../src/domain";
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

describe("Evaluation Lab route", () => {
  beforeEach(() => {
    installMatchMedia(1440);
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps raw cases dominant with grouped columns and supporting metrics", () => {
    renderEval();

    expect(screen.getByRole("heading", { name: "Evaluation Lab" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Evaluation cases" })).toBeInTheDocument();
    expect(screen.getByText("Item metadata")).toBeInTheDocument();
    expect(screen.getByText("Sample")).toBeInTheDocument();
    expect(screen.getByText("Testing")).toBeInTheDocument();
    expect(screen.getByText("Emergency chest pain")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Evaluation support" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Score summary" })).toHaveTextContent(
      "Improve with",
    );
    expect(screen.getByRole("region", { name: "Score summary" })).toHaveTextContent(
      "Verify only",
    );
    expect(screen.getByRole("combobox", { name: "Filter by evaluation use" })).toHaveDisplayValue(
      "All uses",
    );
    expect(screen.getByRole("region", { name: "Suite history" })).toHaveTextContent(
      "Run the suite to create history.",
    );
    expect(screen.queryByText(/dashboard|overview/i)).not.toBeInTheDocument();
  });

  it("defines evaluation terms on hover or focus without adding explanation panels", async () => {
    const user = userEvent.setup();
    renderEval();

    const verifyOnly = screen.getAllByRole("term", { name: "Verify only" })[0]!;
    act(() => verifyOnly.focus());
    await waitFor(() =>
      expect(
        screen.getByRole("tooltip", { name: /kept out while improving/i }),
      ).toBeInTheDocument(),
    );
    act(() => verifyOnly.blur());

    await user.hover(screen.getAllByRole("term", { name: /expected/i })[0]!);
    const expectedTooltip = screen.getByRole("tooltip", {
      name: /human-approved reply used only as the grading reference/i,
    });
    expect(expectedTooltip).toBeInTheDocument();
    expect(expectedTooltip.parentElement).toBe(document.body);
    await user.unhover(screen.getAllByRole("term", { name: /expected/i })[0]!);

    await user.hover(screen.getAllByRole("term", { name: /actual synthetic/i })[0]!);
    expect(
      screen.getByRole("tooltip", { name: /agent-generated reply produced without reading/i }),
    ).toBeInTheDocument();
    await user.unhover(screen.getAllByRole("term", { name: /actual synthetic/i })[0]!);

    await user.hover(screen.getAllByRole("term", { name: /emergency triage/i })[0]!);
    expect(
      screen.getByRole("tooltip", { name: /urgent escalation language/i }),
    ).toBeInTheDocument();
    await user.unhover(screen.getAllByRole("term", { name: /emergency triage/i })[0]!);

    await user.hover(screen.getAllByRole("term", { name: "booking" })[0]!);
    expect(
      screen.getByRole("tooltip", { name: /appointment scheduling and confirmation/i }),
    ).toBeInTheDocument();
    await user.unhover(screen.getAllByRole("term", { name: "booking" })[0]!);

    await user.hover(screen.getByRole("term", { name: "prescription" }));
    expect(
      screen.getByRole("tooltip", { name: /medication renewal and approval checks/i }),
    ).toBeInTheDocument();
    await user.unhover(screen.getByRole("term", { name: "prescription" }));

    await user.hover(screen.getByRole("term", { name: "lab follow up" }));
    expect(
      screen.getByRole("tooltip", { name: /laboratory result availability/i }),
    ).toBeInTheDocument();
    await user.unhover(screen.getByRole("term", { name: "lab follow up" }));

    await user.hover(screen.getByRole("term", { name: "Type" }));
    expect(
      screen.getByRole("tooltip", {
        name: /emergency triage, booking, prescription, lab follow up, and general/i,
      }),
    ).toBeInTheDocument();
    await user.unhover(screen.getByRole("term", { name: "Type" }));

    await user.hover(screen.getByRole("term", { name: "Input" }));
    expect(
      screen.getByRole("tooltip", { name: /ordered conversation context/i }),
    ).toBeInTheDocument();
  });

  it("runs one case with visible progress and keeps HITL separate from synthetic output", async () => {
    const user = userEvent.setup();
    renderEval();

    const row = screen.getByRole("row", { name: /Emergency chest pain/i });
    expect(within(row).getByText("Expected human HITL")).toBeInTheDocument();
    expect(within(row).getByText("Actual synthetic")).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Run Emergency chest pain" }));
    expect(within(row).getByRole("button", { name: "Cancel run" })).toBeInTheDocument();

    await waitFor(() => expect(within(row).getByText("Fail")).toBeInTheDocument());
    expect(within(row).getByText(/Synthetic demo response/)).toBeInTheDocument();
    expect(within(row).getByText(/Simulated fixture verdict/)).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Emergency chest pain" }));
    const evidence = screen.getByRole("complementary", { name: "Case evidence" });
    expect(evidence).toHaveTextContent(/Emergency direction.*fail/i);
    expect(evidence).toHaveTextContent("Fixture required rubric failed");
    await user.click(within(evidence).getByText("Judge details"));
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
    expect(within(row).getAllByText("Not run")).toHaveLength(2);

    await user.click(within(row).getByRole("button", { name: "Run Emergency chest pain" }));
    await waitFor(() => expect(within(row).getByText("Fail")).toBeInTheDocument());
    expect(attempts).toBe(2);
  });

  it("runs the suite and turns snapshots into supporting history", async () => {
    const user = userEvent.setup();
    renderEval();

    await user.click(screen.getByRole("button", { name: "Run Suite" }));
    expect(screen.getByRole("button", { name: "Cancel suite" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Suite history" })).not.toHaveTextContent(
        "Run the suite to create history.",
      ),
    );
    expect(screen.getByRole("region", { name: "Score summary" })).toHaveTextContent(/Overall/);
  });

  it("blocks case-evidence mutations while another evaluation operation runs", async () => {
    const user = userEvent.setup();
    renderEval();
    const row = screen.getByRole("row", { name: /Emergency chest pain/i });

    await user.click(within(row).getByRole("button", { name: "Emergency chest pain" }));
    const evidence = screen.getByRole("complementary", { name: "Case evidence" });
    await user.click(screen.getByRole("button", { name: "Run Suite" }));

    expect(within(evidence).getByRole("button", { name: "Run Case" })).toBeDisabled();
    expect(within(evidence).getByRole("button", { name: "Edit" })).toBeDisabled();
    expect(within(evidence).getByRole("button", { name: "More" })).toBeDisabled();
    expect(
      within(evidence).getByRole("button", { name: /English emergency train case failed/ }),
    ).toBeDisabled();
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
    expect(store.getState().resolveConversation("convo-booking").ok).toBe(true);
    renderEval({ store });

    await user.click(screen.getByRole("button", { name: "Import resolved conversations" }));
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

    await user.click(screen.getByRole("button", { name: "Import resolved conversations" }));
    const reopened = screen.getByRole("dialog", { name: "Import resolved conversations" });
    expect(within(reopened).getByRole("checkbox", { name: /Nurul Aisyah/ })).toBeDisabled();
    expect(within(reopened).getByRole("checkbox", { name: /Rajesh Kumar/ })).toBeDisabled();
    expect(within(reopened).getAllByText("Already imported")).toHaveLength(2);
  });

  it("explains why unresolved conversations cannot be imported", async () => {
    const user = userEvent.setup();
    renderEval();

    await user.click(screen.getByRole("button", { name: "Import resolved conversations" }));
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

    await user.click(screen.getByRole("button", { name: "Analyze failures" }));
    const drawer = screen.getByRole("complementary", { name: "Analyze failures" });
    expect(drawer).toHaveTextContent(
      "Analysis creates review proposals from committed train failures. It does not rerun or improve the agent.",
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

    await user.click(screen.getByRole("button", { name: "Analyze failures" }));
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

    await user.click(screen.getByRole("button", { name: "Analyze failures" }));
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

    await user.click(screen.getByRole("button", { name: "Analyze failures" }));
    const drawer = screen.getByRole("complementary", { name: "Analyze failures" });
    await user.click(screen.getByRole("button", { name: "Run Suite" }));

    expect(screen.getByRole("button", { name: "Cancel suite" })).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Start analysis" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel suite" }));
  });

  it("uses complete case cards and support drawers on 320px", async () => {
    const user = userEvent.setup();
    renderEval({ width: 320 });

    expect(screen.getByRole("button", { name: "Analyze failures" })).toHaveTextContent(
      "Analyze",
    );

    expect(screen.queryByRole("table", { name: "Evaluation cases" })).not.toBeInTheDocument();
    const card = screen.getByRole("article", { name: "Emergency chest pain" });
    expect(card).toHaveTextContent(/Input|Expected|Actual|Criteria|Rationale/);
    const actions = within(card).getByRole("group", { name: "Case actions" });
    expect(within(actions).getAllByRole("button")).toHaveLength(4);

    await user.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByRole("complementary", { name: "Evaluation history" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close history" }));

    await user.click(within(card).getByRole("button", { name: "Emergency chest pain" }));
    expect(screen.getByRole("complementary", { name: "Case evidence" })).toBeInTheDocument();
  });

  it("cancels an in-flight suite when the global demo resets", async () => {
    const user = userEvent.setup();
    const { store } = renderEval();

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
      await screen.findByRole("complementary", { name: "Case evidence" }),
    ).toHaveTextContent("Emergency chest pain");
  });

  it("cancels a pending case commit when the route unmounts", async () => {
    const user = userEvent.setup();
    const { store, unmount } = renderEval();

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
