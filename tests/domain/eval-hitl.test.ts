import { describe, expect, it } from "vitest";

import {
  addCriterion,
  addDataset,
  createCanonicalSeed,
  importHitlConversations,
  importHitlFromConversation,
  resolveConversation,
  sendStaffReply,
  type AppState,
} from "../../src/domain";

const SEED_DATASET_ID = "dataset-aircon-ops";

function seedDataset(state: AppState) {
  return state.evalDatasets.find((d) => d.id === SEED_DATASET_ID)!;
}

function selectedDataset(state: AppState) {
  return state.evalDatasets.find((d) => d.id === state.selections.evalDatasetId)!;
}

function addBookingHumanReview(state: AppState) {
  const result = sendStaffReply(state, {
    conversationId: "convo-aircon-booking",
    text: "A human reviewer confirmed the requested appointment details.",
    kind: "reply",
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe("HITL import", () => {
  it("rejects an unresolved conversation even when it has a staff reply", () => {
    const seed = addBookingHumanReview(createCanonicalSeed());
    const source = seed.conversations.find((conversation) => conversation.id === "convo-aircon-booking")!;

    expect(source.workflowStatus).toBe("in_progress");
    expect(source.messages.some((message) => message.role === "staff")).toBe(true);

    const result = importHitlFromConversation(seed, source.id);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/resolve/i);
    expect(result.state).toEqual(seed);
  });

  it("imports multiple resolved conversations atomically with source lineage", () => {
    const seed = createCanonicalSeed();
    const reviewed = addBookingHumanReview(seed);
    const bookingReviewId = reviewed.conversations
      .find((conversation) => conversation.id === "convo-aircon-booking")!
      .messages.at(-1)!.id;
    const resolvedBooking = resolveConversation(reviewed, "convo-aircon-booking");
    expect(resolvedBooking.ok).toBe(true);
    if (!resolvedBooking.ok) return;
    const beforeCases = seedDataset(resolvedBooking.state).cases.length;

    const result = importHitlConversations(resolvedBooking.state, [
      "convo-aircon-resolved",
      "convo-aircon-booking",
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const imported = seedDataset(result.state).cases.slice(beforeCases);
    expect(imported).toHaveLength(2);
    expect(imported.map((evalCase) => evalCase.sourceConversationId)).toEqual([
      "convo-aircon-resolved",
      "convo-aircon-booking",
    ]);
    expect(imported.map((evalCase) => evalCase.source)).toEqual([
      {
        kind: "hitl",
        conversationId: "convo-aircon-resolved",
        messageIds: [
          "resolved-1",
          "resolved-2",
          "resolved-3",
          "resolved-4",
          "resolved-5",
          "resolved-6",
        ],
      },
      {
        kind: "hitl",
        conversationId: "convo-aircon-booking",
        messageIds: ["book-1", "book-2", "book-3", "book-4", bookingReviewId],
      },
    ]);
  });

  it("keeps a failed multi-import atomic", () => {
    const seed = createCanonicalSeed();
    const beforeCases = seedDataset(seed).cases;

    const result = importHitlConversations(seed, ["convo-aircon-resolved", "convo-aircon-booking"]);

    expect(result.ok).toBe(false);
    expect(seedDataset(result.state).cases).toEqual(beforeCases);
  });

  it("imports latest staff reply into one train case with separate expected output", () => {
    const seed = createCanonicalSeed();
    const source = seed.conversations.find((c) => c.id === "convo-aircon-resolved")!;
    const staff = [...source.messages].reverse().find((m) => m.role === "staff")!;

    const result = importHitlFromConversation(seed, source.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const dataset = seedDataset(result.state);
    const imported = dataset.cases.find((c) => c.expectedHumanOutput === staff.text);
    expect(imported).toBeDefined();
    expect(imported?.split).toBe("train");
    expect(imported?.inputConversation.messages.every((m) => m.role !== "system")).toBe(true);
    expect(imported?.actualSyntheticOutput).toBeUndefined();
    expect(imported?.grade).toBeUndefined();
  });

  it("uses latest staff text as expected output and excludes it from imported input", () => {
    const seed = createCanonicalSeed();
    const reviewed = addBookingHumanReview(seed);
    const source = reviewed.conversations.find((c) => c.id === "convo-aircon-booking")!;
    const staff = [...source.messages].reverse().find((m) => m.role === "staff")!;
    const preceding = source.messages.filter(
      (message) => message.role !== "system" && message.id !== staff.id,
    );
    const resolved = resolveConversation(reviewed, source.id);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const result = importHitlFromConversation(resolved.state, source.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const imported = seedDataset(result.state).cases.find(
      (c) => c.expectedHumanOutput === staff.text,
    );
    expect(imported).toBeDefined();
    expect(imported?.inputConversation.messages).toEqual(preceding);
    expect(imported?.inputConversation.messages.some((m) => m.id === staff.id)).toBe(false);
  });

  it("imports language from the latest staff message not patient preferred language", () => {
    const seed = createCanonicalSeed();
    const source = seed.conversations.find((c) => c.id === "convo-aircon-booking")!;
    expect(source.patient.preferredLanguage).toBe("Malay");

    const replied = sendStaffReply(seed, {
      conversationId: source.id,
      text: "Please bring your IC to counter one.",
      kind: "reply",
    });
    expect(replied.ok).toBe(true);
    if (!replied.ok) return;

    const staff = [...replied.state.conversations.find((c) => c.id === source.id)!.messages]
      .reverse()
      .find((m) => m.role === "staff")!;
    staff.language = "English";
    const resolved = resolveConversation(replied.state, source.id);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const imported = importHitlFromConversation(resolved.state, source.id);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;

    const evalCase = seedDataset(imported.state).cases.find(
      (c) => c.expectedHumanOutput === staff.text,
    );
    expect(evalCase?.language).toBe("English");
    expect(evalCase?.language).not.toBe(source.patient.preferredLanguage);
  });

  it("rejects duplicate fingerprint of input message ids plus expected staff text", () => {
    const seed = createCanonicalSeed();
    const source = seed.conversations.find((c) => c.id === "convo-aircon-resolved")!;

    const first = importHitlFromConversation(seed, source.id);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = importHitlFromConversation(first.state, source.id);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toMatch(/already imported/i);
    expect(second.state.evalDatasets).toEqual(first.state.evalDatasets);
  });

  it("returns typed error when conversation has no staff reply", () => {
    const seed = createCanonicalSeed();
    const source = seed.conversations.find((c) => c.id === "convo-aircon-complaint")!;
    expect(source.messages.some((message) => message.role === "staff")).toBe(false);
    const resolved = resolveConversation(seed, source.id);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const result = importHitlFromConversation(resolved.state, source.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/staff/i);
    expect(result.state).toEqual(resolved.state);
  });
});

describe("HITL criterion assignment", () => {
  it("auto-assigns global criteria and criteria matching the imported case type", () => {
    const seed = createCanonicalSeed();
    const created = addDataset(seed, { name: "Custom criteria set" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const datasetId = created.state.selections.evalDatasetId!;
    const withGlobalCriterion = addCriterion(created.state, datasetId, {
      label: "Global factual grounding",
      instruction: "Use only facts present in the active Knowledge bundle.",
      required: true,
    });
    expect(withGlobalCriterion.ok).toBe(true);
    if (!withGlobalCriterion.ok) return;
    const globalCriterion = selectedDataset(withGlobalCriterion.state).criteria.find(
      (criterion) => criterion.label === "Global factual grounding",
    );
    expect(globalCriterion).toBeDefined();

    const withBookingCriterion = addCriterion(withGlobalCriterion.state, datasetId, {
      label: "Custom booking offer",
      instruction: "Offer the patient an appropriate appointment slot.",
      required: false,
      caseTypes: ["booking"],
    });
    expect(withBookingCriterion.ok).toBe(true);
    if (!withBookingCriterion.ok) return;

    const customCriterion = selectedDataset(withBookingCriterion.state).criteria.find(
      (criterion) => criterion.label === "Custom booking offer",
    );
    expect(customCriterion).toBeDefined();

    const reviewed = addBookingHumanReview(withBookingCriterion.state);
    const resolvedBooking = resolveConversation(reviewed, "convo-aircon-booking");
    expect(resolvedBooking.ok).toBe(true);
    if (!resolvedBooking.ok) return;
    const bookingImport = importHitlFromConversation(resolvedBooking.state, "convo-aircon-booking");
    expect(bookingImport.ok).toBe(true);
    if (!bookingImport.ok) return;

    const importedBooking = selectedDataset(bookingImport.state).cases.find((evalCase) =>
      evalCase.title.includes("Aina Demo"),
    );
    expect(importedBooking?.criterionIds).toContain(customCriterion!.id);
    expect(importedBooking?.criterionIds).toContain(globalCriterion!.id);

    const withEmergencyCriterion = addCriterion(bookingImport.state, datasetId, {
      label: "Custom emergency services",
      instruction: "Give the patient Malaysia's emergency number when urgent care is required.",
      required: true,
      caseTypes: ["emergency_triage"],
    });
    expect(withEmergencyCriterion.ok).toBe(true);
    if (!withEmergencyCriterion.ok) return;

    const emergencyCriterion = selectedDataset(withEmergencyCriterion.state).criteria.find(
      (criterion) => criterion.label === "Custom emergency services",
    );
    expect(importedBooking?.criterionIds).not.toContain(emergencyCriterion!.id);
  });
});
