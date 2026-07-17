import { describe, expect, it } from "vitest";

import {
  SCHEMA_VERSION,
  createCanonicalSeed,
  hydrateAppState,
  migrateV1ToV3,
  migrateV2ToV3,
  migrateV3ToV4,
  serializeAppState,
  type AppState,
} from "../../src/domain";

describe("schema envelope", () => {
  it("serializes version 3 envelope", () => {
    const seed = createCanonicalSeed();
    const payload = serializeAppState(seed);

    expect(payload.schemaVersion).toBe(SCHEMA_VERSION);
    expect(payload.state).toBeDefined();
    expect(typeof payload.serializedAt).toBe("string");
  });
});

describe("serialize and hydrate", () => {
  it("round-trips canonical state without aliasing", () => {
    const seed = createCanonicalSeed();
    const payload = serializeAppState(seed);
    const hydrated = hydrateAppState(payload);

    expect(hydrated.ok).toBe(true);
    if (!hydrated.ok) return;

    expect(hydrated.state).toEqual(seed);
    expect(hydrated.state).not.toBe(seed);
    expect(hydrated.state.conversations).not.toBe(seed.conversations);
  });
});

describe("v3 migration", () => {
  it("converts exact-text criteria, clears incompatible grades, and revisions bookings", () => {
    const seed = createCanonicalSeed();
    const dataset = seed.evalDatasets[0]!;
    const conversations = seed.conversations.map((conversation) => {
      if (!conversation.booking) {
        return conversation;
      }
      const { revision: _revision, ...booking } = conversation.booking;
      return { ...conversation, booking };
    });
    const v3 = {
      schemaVersion: 3 as const,
      serializedAt: "2026-07-11T10:00:00+08:00",
      state: {
        ...seed,
        schemaVersion: 3 as const,
        conversations,
        evalDatasets: [
          {
            ...dataset,
            criteria: [
              {
                id: "crit-aircon-selection",
                label: "Emergency services",
                value: "999",
                kind: "required_substring",
                blocking: true,
                caseTypes: ["emergency_triage"],
              },
              {
                id: "crit-dismissive",
                label: "Dismissive tone",
                value: "not my problem",
                kind: "forbidden_substring",
                blocking: true,
              },
            ],
            cases: dataset.cases.map((evalCase, index) => ({
              ...evalCase,
              grade:
                index === 0
                  ? {
                      pass: true,
                      criteriaScore: 1,
                      referenceCoverage: 0.5,
                      judgeScore: 0.75,
                      rationale: "legacy exact-text grade",
                    }
                  : undefined,
            })),
            runHistory: [
              {
                id: "run-legacy",
                caseId: dataset.cases[0]!.id,
                datasetId: dataset.id,
                ranAt: "2026-07-11T10:00:00+08:00",
                candidateVersion: 1,
                pass: true,
                judgeScore: 0.75,
              },
            ],
            suiteSnapshots: [
              {
                id: "snapshot-legacy",
                createdAt: "2026-07-11T10:00:00+08:00",
                overallPassPercent: 100,
                trainPassPercent: 100,
                holdoutPassPercent: 100,
                meanJudgeScore: 0.75,
              },
            ],
          },
        ],
      },
    };

    const migrated = migrateV3ToV4(v3);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;

    const migratedDataset = migrated.state.evalDatasets[0]!;
    expect(migrated.state.schemaVersion).toBe(4);
    const bookingConversation = migrated.state.conversations.find((item) => item.booking);
    if (bookingConversation?.booking) {
      expect(bookingConversation.booking.revision).toBe(1);
    }
    expect(migratedDataset.criteria[0]).toMatchObject({
      required: true,
      version: 1,
    });
    expect(migratedDataset.criteria[0]?.instruction).toContain("Semantically equivalent wording");
    expect(migratedDataset.criteria[0]).not.toHaveProperty("kind");
    expect(migratedDataset.cases.every((evalCase) => evalCase.grade === undefined)).toBe(true);
    expect(
      migratedDataset.cases.every(
        (evalCase) => evalCase.source.kind === "seed",
      ),
    ).toBe(true);
    expect(migratedDataset.runHistory).toEqual([]);
    expect(migratedDataset.suiteSnapshots).toEqual([]);
  });
});

describe("unknown or corrupt payload", () => {
  it("falls back to canonical seed on unknown version", () => {
    const result = hydrateAppState({
      schemaVersion: 99,
      serializedAt: "2026-07-08T10:00:00+08:00",
      state: { conversations: [] },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toEqual(createCanonicalSeed());
    expect(result.fallback).toBe("reseed");
  });

  it("falls back to canonical seed on corrupt payload", () => {
    const result = hydrateAppState(null);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.conversations).toHaveLength(3);
    expect(result.fallback).toBe("reseed");
  });
});

describe("v1 migration", () => {
  it("migrates version 1 envelope into version 3 without wiping valid data", () => {
    const seed = createCanonicalSeed();
    const dataset = seed.evalDatasets[0]!;

    const v1 = {
      schemaVersion: 1 as const,
      serializedAt: "2026-07-08T08:00:00+08:00",
      state: {
        conversations: seed.conversations,
        playbookFiles: seed.playbookFiles,
        corrections: seed.corrections,
        evalDatasets: [
          {
            id: dataset.id,
            name: dataset.name,
            protected: dataset.protected,
            criteria: dataset.criteria,
            cases: dataset.cases.map((evalCase) => ({
              id: evalCase.id,
              title: evalCase.title,
              split: evalCase.split,
              language: evalCase.language,
              inputConversation: evalCase.inputConversation,
              expectedHumanOutput: evalCase.expectedHumanOutput,
            })),
            runHistory: [],
          },
        ],
        selections: seed.selections,
      },
    };

    const migrated = migrateV1ToV3(v1);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;

    expect(migrated.state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.state.conversations).toEqual(seed.conversations);
    expect(migrated.state.evalDatasets[0]?.candidateVersion).toBe(1);
    expect(migrated.state.evalDatasets[0]?.cases[0]?.type).toBeTruthy();
    expect(migrated.state.evalDatasets[0]?.cases[0]?.criterionIds.length).toBeGreaterThan(0);

    const hydrated = hydrateAppState(v1);
    expect(hydrated.ok).toBe(true);
    if (!hydrated.ok) return;
    expect(hydrated.state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(hydrated.fallback).not.toBe("reseed");
  });

  it("backfills legacy criteria caseTypes and assigns criterionIds for typed seed cases", () => {
    const seed = createCanonicalSeed();
    const dataset = seed.evalDatasets[0]!;

    const legacyCriteria = [
      {
        id: "crit-emergency",
        label: "Package selection",
        value: "chemical wash",
        kind: "required_substring" as const,
        blocking: true,
      },
      {
        id: "crit-booking",
        label: "Explicit booking confirmation",
        value: "confirm the slot",
        kind: "required_substring" as const,
        blocking: true,
      },
      {
        id: "crit-prescription",
        label: "Fixed rate card",
        value: "RM99",
        kind: "required_substring" as const,
        blocking: true,
      },
    ];
    legacyCriteria.push({
      id: "crit-custom-legacy",
      label: "Custom legacy rule",
      value: "custom-marker",
      kind: "required_substring",
      blocking: false,
    });

    const legacyCaseIds = [
      "case-emergency-train",
      "case-booking-train",
      "case-prescription-train",
    ] as const;

    const legacyCases = legacyCaseIds.map((caseId, index) => {
      const titles = [
        "Emergency triage train",
        "Explicit booking confirmation",
        "Malay general-service price",
      ] as const;
      const template = dataset.cases[index]!;
      return {
        id: caseId,
        title: titles[index] ?? template.title,
        split: template.split,
        language: template.language,
        inputConversation: template.inputConversation,
        expectedHumanOutput: template.expectedHumanOutput,
      };
    });

    const v1 = {
      schemaVersion: 1 as const,
      serializedAt: "2026-07-08T08:00:00+08:00",
      state: {
        conversations: seed.conversations,
        playbookFiles: seed.playbookFiles,
        corrections: seed.corrections,
        evalDatasets: [
          {
            id: dataset.id,
            name: dataset.name,
            protected: dataset.protected,
            criteria: legacyCriteria,
            cases: legacyCases,
            runHistory: [],
          },
        ],
        selections: seed.selections,
      },
    };

    const migrated = migrateV1ToV3(v1);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;

    const migratedDataset = migrated.state.evalDatasets[0]!;
    const criterionById = Object.fromEntries(migratedDataset.criteria.map((c) => [c.id, c]));
    const caseById = Object.fromEntries(migratedDataset.cases.map((c) => [c.id, c]));

    expect(criterionById["crit-emergency"]?.caseTypes).toEqual(["emergency_triage"]);
    expect(criterionById["crit-booking"]?.caseTypes).toEqual(["booking"]);
    expect(criterionById["crit-prescription"]?.caseTypes).toEqual(["prescription"]);
    expect(criterionById["crit-dismissive"]?.caseTypes).toBeUndefined();
    expect(criterionById["crit-custom-legacy"]?.caseTypes).toBeUndefined();

    expect(caseById["case-emergency-train"]?.criterionIds).toEqual(["crit-emergency"]);
    expect(caseById["case-booking-train"]?.criterionIds).toEqual(["crit-booking"]);
    expect(caseById["case-prescription-train"]?.criterionIds).toEqual(["crit-prescription"]);
  });
});

describe("selection reconciliation", () => {
  it("reconciles stale persisted selections to first valid entity or null on hydrate", () => {
    const seed = createCanonicalSeed();
    const payload = serializeAppState({
      ...seed,
      selections: {
        conversationId: "missing-conversation",
        playbookFileId: "missing-file",
        evalDatasetId: "missing-dataset",
      },
    });

    const hydrated = hydrateAppState(payload);
    expect(hydrated.ok).toBe(true);
    if (!hydrated.ok) return;

    expect(hydrated.state.selections.conversationId).toBe(seed.conversations[0]?.id ?? null);
    expect(hydrated.state.selections.playbookFileId).toBe(seed.playbookFiles[0]?.id ?? null);
    expect(hydrated.state.selections.evalDatasetId).toBe(seed.evalDatasets[0]?.id ?? null);
  });
});

describe("v2 migration", () => {
  it("preserves recognized fields and fills new v3 state", () => {
    const seed = createCanonicalSeed();
    const selectedConversationId = seed.conversations[0]!.id;
    const selectedFileId = seed.playbookFiles[0]!.id;
    const selectedDatasetId = seed.evalDatasets[0]!.id;

    const v2 = {
      schemaVersion: 2 as const,
      serializedAt: "2026-07-08T09:00:00+08:00",
      state: {
        conversations: seed.conversations,
        playbookFiles: seed.playbookFiles,
        corrections: seed.corrections,
        evalDatasets: seed.evalDatasets.map((dataset) => ({
          ...dataset,
          suiteSnapshots: [],
        })),
        selections: {
          conversationId: selectedConversationId,
          playbookFileId: selectedFileId,
          evalDatasetId: selectedDatasetId,
        },
      },
    };

    const migrated = migrateV2ToV3(v2);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;

    expect(migrated.state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.state.conversations).toEqual(v2.state.conversations);
    expect(migrated.state.playbookFiles).toEqual(v2.state.playbookFiles);
    expect(migrated.state.selections.conversationId).toBe(selectedConversationId);
    expect(migrated.state.fixtureTime).toBeTruthy();
    expect(migrated.state.evalDatasets[0]?.suiteSnapshots).toEqual([]);
  });
});

describe("immutability from caller perspective", () => {
  it("hydrate returns a deep clone even when payload matches seed shape", () => {
    const seed = createCanonicalSeed();
    const payload = serializeAppState(seed);
    const hydrated = hydrateAppState(payload);
    expect(hydrated.ok).toBe(true);
    if (!hydrated.ok) return;

    (hydrated.state as AppState).conversations[0]!.patient.name = "mutated";
    expect(seed.conversations[0]!.patient.name).not.toBe("mutated");
  });
});
