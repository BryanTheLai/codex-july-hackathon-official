import { describe, expect, it } from "vitest";

import {
  appStateSchema,
  conversationSchema,
  datasetSchema,
  domainStateSchema,
  evalCaseSchema,
  gradeSchema,
  persistedAppStateEnvelopeSchema,
  toDomainStatePayload,
  type AppStatePayload,
  type PersistedAppStateEnvelope,
} from "../../src/contracts/app-state";
import {
  createCanonicalSeed,
  serializeAppState,
  type AppState,
  type PersistedEnvelopeV4,
} from "../../src/domain";

type IsExact<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
        (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;

describe("app state contract", () => {
  it("keeps the runtime state and persisted envelope aligned", () => {
    const state = createCanonicalSeed();
    const appStateTypesMatch: IsExact<AppStatePayload, AppState> = true;
    const envelopeTypesMatch: IsExact<PersistedAppStateEnvelope, PersistedEnvelopeV4> = true;

    expect(appStateTypesMatch).toBe(true);
    expect(envelopeTypesMatch).toBe(true);
    expect(appStateSchema.parse(state)).toEqual(state);
    expect(persistedAppStateEnvelopeSchema.parse(serializeAppState(state))).toEqual(
      serializeAppState(state),
    );
  });

  it("rejects incomplete persisted state", () => {
    const state = createCanonicalSeed();
    const { conversations: _conversations, ...incomplete } = state;

    expect(appStateSchema.safeParse(incomplete).success).toBe(false);
  });

  it("keeps persisted judge evidence as strict as the judge response", () => {
    const grade = {
      pass: true,
      verdict: "pass",
      judgeScore: 1,
      rationale: "The response meets the required scoring rule.",
      criterionResults: [],
      metadata: {
        provider: "fixture",
        model: "fixture-judge-v1",
        promptVersion: "judge-v1",
        rubricVersions: { "criterion-1": 1 },
        runId: "run-1",
        latencyMs: 1,
        simulated: true,
      },
    };

    expect(gradeSchema.safeParse(grade).success).toBe(false);
    expect(
      gradeSchema.safeParse({
        ...grade,
        criterionResults: [
          {
            criterionId: "criterion-1",
            verdict: "pass",
            reason: "The response follows the rule.",
            evidence: "Matching response evidence.",
          },
        ],
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it("rejects contradictory workflow, provenance, grade, and dataset references", () => {
    const state = createCanonicalSeed();
    const conversation = state.conversations[0]!;
    const dataset = structuredClone(state.evalDatasets[0]!);
    const evalCase = dataset.cases[0]!;
    const criterion = dataset.criteria[0]!;
    const grade = {
      pass: true,
      verdict: "fail" as const,
      judgeScore: 0,
      rationale: "The response fails the required rule.",
      criterionResults: [
        {
          criterionId: criterion.id,
          verdict: "fail" as const,
          reason: "The response does not follow the rule.",
          evidence: null,
        },
      ],
      metadata: {
        provider: "fixture",
        model: "fixture-judge-v1",
        promptVersion: "judge-v1",
        rubricVersions: { [criterion.id]: criterion.version },
        runId: "run-contradictory",
        latencyMs: 1,
        simulated: true,
      },
    };

    expect(
      conversationSchema.safeParse({
        ...conversation,
        workflowStatus: "resolved",
        resolvedAt: null,
      }).success,
    ).toBe(false);
    expect(
      evalCaseSchema.safeParse({
        ...evalCase,
        source: { kind: "hitl", conversationId: "conversation-a" },
        sourceConversationId: "conversation-b",
      }).success,
    ).toBe(false);
    expect(gradeSchema.safeParse(grade).success).toBe(false);

    dataset.cases[0] = {
      ...evalCase,
      criterionIds: ["criterion-missing"],
    };
    expect(datasetSchema.safeParse(dataset).success).toBe(false);

    dataset.cases[0] = evalCase;
    dataset.runHistory = [
      {
        id: "run-orphan",
        caseId: "case-missing",
        datasetId: dataset.id,
        ranAt: "2026-07-13T12:00:00.000Z",
        candidateVersion: 1,
        pass: true,
        verdict: "pass",
        judgeScore: 1,
      },
    ];
    expect(datasetSchema.safeParse(dataset).success).toBe(false);
  });

  it("keeps client selections outside the backend-owned domain state", () => {
    const state = createCanonicalSeed();
    const { selections: _selections, ...domainState } = state;

    expect(domainStateSchema.parse(domainState)).toEqual(domainState);
    expect("selections" in domainStateSchema.parse(domainState)).toBe(false);
    expect(toDomainStatePayload(state)).toEqual(domainState);
  });

  it("rejects duplicate case identities inside one dataset", () => {
    const state = createCanonicalSeed();
    const firstCase = state.evalDatasets[0]!.cases[0]!;
    state.evalDatasets[0]!.cases.push({
      ...structuredClone(firstCase),
      source: { kind: "manual" },
    });

    expect(appStateSchema.safeParse(state).success).toBe(false);
  });

  it("backfills durable case provenance for existing schema-v4 data", () => {
    const seedCase = createCanonicalSeed().evalDatasets[0]!.cases[0]!;
    const { source: _source, ...legacySeedCase } = seedCase;

    expect(evalCaseSchema.parse(legacySeedCase).source).toEqual({ kind: "seed" });
    expect(
      evalCaseSchema.parse({
        ...legacySeedCase,
        id: "case-hitl-legacy",
        sourceConversationId: "conversation-1",
      }).source,
    ).toEqual({
      kind: "hitl",
      conversationId: "conversation-1",
    });
    expect(
      evalCaseSchema.parse({
        ...legacySeedCase,
        id: "case-manual-legacy",
      }).source,
    ).toEqual({ kind: "manual" });
  });
});
