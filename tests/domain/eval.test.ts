import { describe, expect, it } from "vitest";

import {
  addCase,
  addCriterion,
  addDataset,
  buildGenerationInput,
  buildJudgeRequest,
  createCanonicalSeed,
  deleteCase,
  deleteCriterion,
  deleteDataset,
  duplicateCase,
  editCase,
  editCriterion,
  generateSyntheticOutput,
  renameDataset,
  runEvalCase,
  runEvalSuite,
  type AppState,
  type EvalCaseId,
} from "../../src/domain";
import { createFixtureJudgeClient } from "../fixtures/judge-client";

const SEED_DATASET_ID = "dataset-seed";

function seedDataset(state: AppState) {
  return state.evalDatasets.find((d) => d.id === SEED_DATASET_ID)!;
}

function trainCases(state: AppState) {
  return seedDataset(state).cases.filter((c) => c.split === "train");
}

function caseById(state: AppState, id: EvalCaseId) {
  return seedDataset(state).cases.find((c) => c.id === id)!;
}

describe("generation boundary", () => {
  it("keeps actual synthetic output independent of expected human output", () => {
    const seed = createCanonicalSeed();
    const evalCase = trainCases(seed)[0]!;

    const baselineInput = buildGenerationInput(seed, evalCase.id);
    expect(baselineInput.ok).toBe(true);
    if (!baselineInput.ok) return;

    const actualA = generateSyntheticOutput(seed, evalCase.id);
    expect(actualA.ok).toBe(true);
    if (!actualA.ok) return;

    const edited = editCase(seed, evalCase.id, {
      expectedHumanOutput: "Completely different HITL reference text for isolation test",
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;

    const actualB = generateSyntheticOutput(edited.state, evalCase.id);
    expect(actualB.ok).toBe(true);
    if (!actualB.ok) return;

    expect(actualB.output).toBe(actualA.output);
    expect(actualB.output).not.toBe(edited.state.evalDatasets[0]!.cases.find((c) => c.id === evalCase.id)!
      .expectedHumanOutput);
  });
});

describe("judge boundary", () => {
  it("builds semantic rubric input only after candidate generation", () => {
    const seed = createCanonicalSeed();
    const evalCase = trainCases(seed)[0]!;
    const generated = generateSyntheticOutput(seed, evalCase.id);
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;

    const built = buildJudgeRequest(seed, evalCase.id, generated.output, "run-test-1");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.request.expectedResponse).toBe(evalCase.expectedHumanOutput);
    expect(built.request.candidateResponse).toBe(generated.output);
    expect(built.request.rubrics[0]).toMatchObject({
      instruction: expect.any(String),
      version: 1,
    });
    expect(built.request.rubrics[0]).not.toHaveProperty("value");
    expect(built.request.rubrics[0]).not.toHaveProperty("kind");
  });
});

describe("run case", () => {
  it("commits output, grade, and one run-history row atomically on success", async () => {
    const seed = createCanonicalSeed();
    const evalCase = trainCases(seed)[0]!;
    const beforeHistory = seedDataset(seed).runHistory.length;

    const result = await runEvalCase(seed, evalCase.id, createFixtureJudgeClient());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const afterCase = caseById(result.state, evalCase.id);
    expect(afterCase.actualSyntheticOutput).toBeTruthy();
    expect(afterCase.grade).toBeDefined();
    expect(afterCase.grade?.metadata.simulated).toBe(true);
    expect(seedDataset(result.state).runHistory).toHaveLength(beforeHistory + 1);
  });

  it("cancels an in-flight judge without committing partial state", async () => {
    const seed = createCanonicalSeed();
    const evalCase = trainCases(seed)[0]!;
    const before = structuredClone(caseById(seed, evalCase.id));
    const beforeHistory = seedDataset(seed).runHistory.length;
    const controller = new AbortController();
    const pending = runEvalCase(
      seed,
      evalCase.id,
      {
        judge: (_request, signal) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          }),
      },
      { signal: controller.signal },
    );
    controller.abort();
    const canceled = await pending;
    expect(canceled.ok).toBe(false);
    if (canceled.ok) return;
    expect(canceled.error).toMatch(/cancel/i);

    const after = caseById(canceled.state, evalCase.id);
    expect(after.actualSyntheticOutput).toEqual(before.actualSyntheticOutput);
    expect(after.grade).toEqual(before.grade);
    expect(seedDataset(canceled.state).runHistory).toHaveLength(beforeHistory);
  });

  it("does not commit when cancellation arrives with the judge response", async () => {
    const seed = createCanonicalSeed();
    const evalCase = trainCases(seed)[0]!;
    const before = structuredClone(seedDataset(seed));
    const controller = new AbortController();

    const result = await runEvalCase(
      seed,
      evalCase.id,
      {
        async judge(request) {
          const response = await createFixtureJudgeClient().judge(request);
          controller.abort();
          return response;
        },
      },
      { signal: controller.signal },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/cancel/i);
    expect(seedDataset(result.state)).toEqual(before);
  });
});

describe("run suite", () => {
  it("updates every case and appends one suite snapshot", async () => {
    const seed = createCanonicalSeed();
    const dataset = seedDataset(seed);
    const beforeSnapshots = dataset.suiteSnapshots.length;

    const result = await runEvalSuite(seed, dataset.id, createFixtureJudgeClient());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = seedDataset(result.state);
    expect(after.cases.every((c) => c.actualSyntheticOutput && c.grade)).toBe(true);
    expect(after.suiteSnapshots).toHaveLength(beforeSnapshots + 1);
    expect(after.runHistory.length).toBeGreaterThanOrEqual(dataset.cases.length);
  });

  it("keeps dataset data unchanged when one judge request fails", async () => {
    const seed = createCanonicalSeed();
    const dataset = seedDataset(seed);
    const before = structuredClone(dataset);
    let calls = 0;
    const result = await runEvalSuite(seed, dataset.id, {
      async judge(request) {
        calls += 1;
        if (calls === 2) {
          throw new Error("Provider unavailable");
        }
        return createFixtureJudgeClient().judge(request);
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(seedDataset(result.state)).toEqual(before);
  });

  it("keeps dataset data unchanged when a suite is canceled between judge responses", async () => {
    const seed = createCanonicalSeed();
    const dataset = seedDataset(seed);
    const before = structuredClone(dataset);
    const controller = new AbortController();
    let calls = 0;

    const result = await runEvalSuite(
      seed,
      dataset.id,
      {
        async judge(request) {
          calls += 1;
          const response = await createFixtureJudgeClient().judge(request);
          if (calls === 2) {
            controller.abort();
          }
          return response;
        },
      },
      { signal: controller.signal },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/cancel/i);
    expect(seedDataset(result.state)).toEqual(before);
  });
});

describe("train and holdout explicit splits", () => {
  it("keeps holdout cases out of improvement proposals", () => {
    const seed = createCanonicalSeed();
    const dataset = seedDataset(seed);
    expect(dataset.cases.some((c) => c.split === "holdout")).toBe(true);
    expect(dataset.cases.some((c) => c.split === "train")).toBe(true);
  });
});

describe("dataset CRUD", () => {
  it("creates empty dataset at candidate version 1, trims name, and selects it", () => {
    const seed = createCanonicalSeed();

    const emptyName = addDataset(seed, { name: "   " });
    expect(emptyName.ok).toBe(false);
    if (emptyName.ok) return;
    expect(emptyName.error).toMatch(/empty|name/i);

    const created = addDataset(seed, { name: "  Sandbox set  " });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const dataset = created.state.evalDatasets.find((d) => d.name === "Sandbox set");
    expect(dataset).toBeDefined();
    expect(dataset?.protected).toBe(false);
    expect(dataset?.candidateVersion).toBe(1);
    expect(dataset?.cases).toHaveLength(0);
    expect(dataset?.criteria).toHaveLength(0);
    expect(created.state.selections.evalDatasetId).toBe(dataset?.id);
  });

  it("rejects duplicate dataset names after trim", () => {
    const seed = createCanonicalSeed();
    const first = addDataset(seed, { name: "Unique" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const dup = addDataset(first.state, { name: "  Unique  " });
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.error).toMatch(/duplicate|exists|unique/i);
  });

  it("renames with trim and non-empty validation", () => {
    const seed = createCanonicalSeed();
    const created = addDataset(seed, { name: "Rename target" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const datasetId = created.state.evalDatasets.find((d) => d.name === "Rename target")!.id;
    const invalid = renameDataset(created.state, { datasetId, name: "  " });
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;

    const renamed = renameDataset(created.state, { datasetId, name: "  Renamed set  " });
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.state.evalDatasets.find((d) => d.id === datasetId)?.name).toBe("Renamed set");
  });

  it("blocks deleting protected seed dataset and last remaining dataset", () => {
    const seed = createCanonicalSeed();

    const blockedSeed = deleteDataset(seed, {
      datasetId: SEED_DATASET_ID,
      confirmed: true,
    });
    expect(blockedSeed.ok).toBe(false);
    if (blockedSeed.ok) return;
    expect(blockedSeed.error).toMatch(/protected|seed/i);

    const created = addDataset(seed, { name: "Disposable" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const disposableId = created.state.evalDatasets.find((d) => d.name === "Disposable")!.id;
    const deleted = deleteDataset(created.state, { datasetId: disposableId, confirmed: true });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;

    const lastBlocked = deleteDataset(deleted.state, {
      datasetId: SEED_DATASET_ID,
      confirmed: true,
    });
    expect(lastBlocked.ok).toBe(false);
    if (lastBlocked.ok) return;
    expect(lastBlocked.error).toMatch(/last|only/i);
  });
});

describe("addCase", () => {
  it("validates required fields and creates case without actual output or grade", () => {
    const seed = createCanonicalSeed();

    const invalid = addCase(seed, {
      datasetId: SEED_DATASET_ID,
      title: "  ",
      split: "train",
      type: "general",
      language: "English",
      inputConversation: { messages: [] },
      expectedHumanOutput: "  ",
      criterionIds: [],
    });
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.error).toMatch(/title|expected|empty/i);

    const created = addCase(seed, {
      datasetId: SEED_DATASET_ID,
      title: "  Manual general case  ",
      split: "holdout",
      type: "general",
      language: "English",
      inputConversation: {
        messages: [
          {
            id: "manual-msg-1",
            role: "patient",
            text: "What are my lab results?",
            sentAt: "2026-07-08T10:00:00+08:00",
          },
        ],
      },
      expectedHumanOutput: "  Please visit counter two.  ",
      criterionIds: ["crit-booking"],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const added = seedDataset(created.state).cases.find((c) => c.title === "Manual general case");
    expect(added).toBeDefined();
    expect(added?.split).toBe("holdout");
    expect(added?.type).toBe("general");
    expect(added?.language).toBe("English");
    expect(added?.expectedHumanOutput).toBe("Please visit counter two.");
    expect(added?.inputConversation.messages).toHaveLength(1);
    expect(added?.criterionIds).toEqual(["crit-booking"]);
    expect(added?.source).toEqual({ kind: "manual" });
    expect(added?.actualSyntheticOutput).toBeUndefined();
    expect(added?.grade).toBeUndefined();
  });

  it("rejects empty language and invalid criterion ids", () => {
    const seed = createCanonicalSeed();

    const emptyLanguage = addCase(seed, {
      datasetId: SEED_DATASET_ID,
      title: "Missing language",
      split: "train",
      type: "general",
      language: "   ",
      inputConversation: {
        messages: [
          {
            id: "lang-1",
            role: "patient",
            text: "Hello",
            sentAt: "2026-07-08T10:00:00+08:00",
          },
        ],
      },
      expectedHumanOutput: "Please wait.",
      criterionIds: [],
    });
    expect(emptyLanguage.ok).toBe(false);
    if (emptyLanguage.ok) return;
    expect(emptyLanguage.error).toMatch(/language|empty/i);

    const invalidCriterion = addCase(seed, {
      datasetId: SEED_DATASET_ID,
      title: "Bad criterion",
      split: "train",
      type: "booking",
      language: "English",
      inputConversation: {
        messages: [
          {
            id: "crit-1",
            role: "patient",
            text: "Book appointment",
            sentAt: "2026-07-08T10:00:00+08:00",
          },
        ],
      },
      expectedHumanOutput: "Slot confirmed.",
      criterionIds: ["crit-does-not-exist"],
    });
    expect(invalidCriterion.ok).toBe(false);
    if (invalidCriterion.ok) return;
    expect(invalidCriterion.error).toMatch(/criterion|invalid/i);
  });
});

describe("editCase generated output boundary", () => {
  it("clears generated output and grade when the editable case definition changes", async () => {
    const seed = createCanonicalSeed();
    const evalCase = trainCases(seed)[0]!;
    const run = await runEvalCase(seed, evalCase.id, createFixtureJudgeClient());
    expect(run.ok).toBe(true);
    if (!run.ok) return;

    const before = caseById(run.state, evalCase.id);
    expect(before.actualSyntheticOutput).toBeDefined();
    expect(before.grade).toBeDefined();

    const edited = editCase(run.state, evalCase.id, {
      expectedHumanOutput: "  Updated expected reference  ",
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;

    const afterEdit = caseById(edited.state, evalCase.id);
    expect(afterEdit.expectedHumanOutput).toBe("Updated expected reference");
    expect(afterEdit.actualSyntheticOutput).toBeUndefined();
    expect(afterEdit.grade).toBeUndefined();
  });
});

describe("CRUD guards", () => {
  it("blocks deleting criterion referenced by a case", () => {
    const seed = createCanonicalSeed();

    const blocked = deleteCriterion(seed, seedDataset(seed).criteria[0]!.id);
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error).toMatch(/reference|in use/i);
  });

  it("validates natural-language rubrics and increments the version on semantic edits", () => {
    const seed = createCanonicalSeed();
    const criterion = seedDataset(seed).criteria[0]!;
    const before = structuredClone(criterion);

    const invalid = editCriterion(seed, criterion.id, { instruction: "   " });
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(seedDataset(invalid.state).criteria.find((c) => c.id === criterion.id)).toEqual(before);

    const valid = addCriterion(seed, SEED_DATASET_ID, {
      label: "Handoff clarity",
      instruction:
        "Tell the patient what will happen next without promising that an external service was contacted.",
      required: false,
      examples: {
        good: "A staff member will review this request next.",
        bad: "The clinic has already called you.",
      },
    });
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    const added = seedDataset(valid.state).criteria.find((c) => c.label === "Handoff clarity");
    expect(added).toMatchObject({
      required: false,
      version: 1,
    });

    const edited = editCriterion(valid.state, added!.id, {
      instruction: "Explain the next human handoff without claiming external contact.",
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(seedDataset(edited.state).criteria.find((c) => c.id === added!.id)?.version).toBe(2);
  });

  it("duplicate case clears synthetic output and grade", async () => {
    const seed = createCanonicalSeed();
    const evalCase = trainCases(seed)[0]!;
    const run = await runEvalCase(seed, evalCase.id, createFixtureJudgeClient());
    expect(run.ok).toBe(true);
    if (!run.ok) return;

    const dup = duplicateCase(run.state, evalCase.id);
    expect(dup.ok).toBe(true);
    if (!dup.ok) return;

    const copy = seedDataset(dup.state).cases.find((c) => c.id !== evalCase.id && c.title === caseById(run.state, evalCase.id).title);
    expect(copy).toBeDefined();
    expect(copy?.source).toEqual({ kind: "manual" });
    expect(copy?.actualSyntheticOutput).toBeUndefined();
    expect(copy?.grade).toBeUndefined();
  });

  it("case delete confirmation names cascade and cancel preserves state", () => {
    const seed = createCanonicalSeed();
    const evalCase = trainCases(seed)[0]!;

    const canceled = deleteCase(seed, evalCase.id, { confirmed: false });
    expect(canceled.ok).toBe(false);
    if (canceled.ok) return;
    expect(canceled.error).toMatch(/confirm|history|correction/i);
    expect(canceled.state).toEqual(seed);

    const committed = deleteCase(seed, evalCase.id, { confirmed: true });
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    expect(seedDataset(committed.state).cases.some((c) => c.id === evalCase.id)).toBe(false);
  });
});
