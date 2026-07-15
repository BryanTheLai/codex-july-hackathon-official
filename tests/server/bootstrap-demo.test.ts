import { describe, expect, it } from "vitest";

import { createCanonicalServerState } from "../../src/domain";
import { bootstrapDemo } from "../../server/bootstrap-demo";
import { createWorkspaceRepository } from "../../server/workspace-repository";
import { InMemoryWorkspaceDataSource } from "./fixtures/workspace-data-source";

describe("demo bootstrap", () => {
  it("creates revision one once and validates an existing workspace without overwrite", async () => {
    const dataSource = new InMemoryWorkspaceDataSource();
    const repository = createWorkspaceRepository(dataSource);
    const first = await bootstrapDemo(
      repository,
      "demo",
      createCanonicalServerState,
    );
    const second = await bootstrapDemo(repository, "demo", async () => ({
      ...(await createCanonicalServerState()),
      fixtureTime: "2099-01-01T00:00:00.000Z",
    }));

    expect(first.revision).toBe(1);
    expect(second).toEqual(first);
    expect(dataSource.records).toHaveLength(1);
    expect(dataSource.records.get("demo")?.state.fixtureTime).not.toBe(
      "2099-01-01T00:00:00.000Z",
    );
  });
});
