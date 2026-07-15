import { describe, expect, it } from "vitest";

import {
  createWorkspaceRepository,
  WorkspaceRepositoryError,
} from "../../server/workspace-repository";
import {
  createCanonicalServerState,
  freezeEvalSuiteSnapshot,
} from "../../src/domain";
import { createServerStateFixture } from "../fixtures/server-state";
import { InMemoryWorkspaceDataSource } from "./fixtures/workspace-data-source";

function changedState(fixtureTime: string) {
  return {
    ...createServerStateFixture(),
    fixtureTime,
  };
}

describe("workspace repository", () => {
  it("bootstraps revision one once without overwriting existing state", async () => {
    const dataSource = new InMemoryWorkspaceDataSource();
    const repository = createWorkspaceRepository(dataSource);
    const firstState = changedState("2026-07-13T10:00:00.000Z");
    const secondState = changedState("2026-07-13T11:00:00.000Z");

    const first = await repository.bootstrap("demo", firstState);
    const second = await repository.bootstrap("demo", secondState);

    expect(first).toEqual({
      workspaceId: "demo",
      revision: 1,
      state: firstState,
    });
    expect(second).toEqual(first);
    expect(dataSource.records).toHaveLength(1);
  });

  it("increments one matching revision and returns current truth on conflict", async () => {
    const dataSource = new InMemoryWorkspaceDataSource();
    const repository = createWorkspaceRepository(dataSource);
    await repository.bootstrap("demo", createServerStateFixture());
    const savedState = changedState("2026-07-13T12:00:00.000Z");

    const saved = await repository.save("demo", 1, savedState);
    const conflict = await repository.save(
      "demo",
      1,
      changedState("2026-07-13T13:00:00.000Z"),
    );

    expect(saved).toEqual({
      ok: true,
      workspace: {
        workspaceId: "demo",
        revision: 2,
        state: savedState,
      },
    });
    expect(conflict).toEqual({
      ok: false,
      code: "revision_conflict",
      workspace: saved.workspace,
    });
  });

  it("allows only one winner when two saves race on the same revision", async () => {
    const dataSource = new InMemoryWorkspaceDataSource();
    const repository = createWorkspaceRepository(dataSource);
    await repository.bootstrap("demo", createServerStateFixture());

    const results = await Promise.all([
      repository.save("demo", 1, changedState("2026-07-13T14:00:00.000Z")),
      repository.save("demo", 1, changedState("2026-07-13T15:00:00.000Z")),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(results.every((result) => result.workspace.revision === 2)).toBe(true);
  });

  it("round-trips a frozen Eval suite without changing its manifest", async () => {
    const dataSource = new InMemoryWorkspaceDataSource();
    const repository = createWorkspaceRepository(dataSource);
    const state = await createCanonicalServerState();
    const suite = await freezeEvalSuiteSnapshot({
      state,
      suiteId: "suite-persisted",
      datasetId: "dataset-seed",
      caseIds: [state.evalDatasets[0]!.cases[0]!.id],
      playbookVersionId: state.playbookHistory.activeVersionId,
      agentConfig: {
        modelId: "agent-model",
        apiMode: "responses",
        agentConfigVersion: "agent-config-v1",
        promptVersion: "agent-prompt-v1",
        toolPolicyVersion: "demo-no-tools-v1",
      },
      judgeConfig: {
        modelId: "judge-model",
        promptVersion: "judge-prompt-v1",
      },
      baselineSuiteId: null,
      createdAt: state.fixtureTime,
    });
    state.evalArtifacts.suites.push(suite);

    await repository.bootstrap("demo", state);
    const loaded = await repository.load("demo");

    expect(loaded?.state.evalArtifacts.suites).toEqual([suite]);
    expect(
      loaded?.state.evalArtifacts.suites[0]?.manifestHash,
    ).toBe(suite.manifestHash);
  });

  it("returns null on load and a bounded not-found error on save", async () => {
    const repository = createWorkspaceRepository(
      new InMemoryWorkspaceDataSource(),
    );

    await expect(repository.load("missing")).resolves.toBeNull();
    await expect(
      repository.save("missing", 1, createServerStateFixture()),
    ).rejects.toEqual(
      new WorkspaceRepositoryError("not_found", "Workspace not found"),
    );
  });

  it("rejects invalid records loaded from storage", async () => {
    const dataSource = new InMemoryWorkspaceDataSource();
    dataSource.records.set("demo", {
      workspaceId: "demo",
      schemaVersion: 4,
      revision: 0,
      state: createServerStateFixture(),
    });
    const repository = createWorkspaceRepository(dataSource);

    await expect(repository.load("demo")).rejects.toMatchObject({
      code: "invalid_record",
    });
  });
});
