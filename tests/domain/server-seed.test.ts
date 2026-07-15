import { describe, expect, it } from "vitest";

import { serverDomainStateSchema } from "../../src/contracts/app-state";
import { createCanonicalServerState } from "../../src/domain";

describe("canonical server state", () => {
  it("builds a stable validated aggregate with real content hashes", async () => {
    const first = await createCanonicalServerState();
    const second = await createCanonicalServerState();
    const seedDataset = first.evalDatasets.find(
      (dataset) => dataset.id === "dataset-seed",
    )!;

    expect(serverDomainStateSchema.parse(first)).toEqual(first);
    expect(second).toEqual(first);
    expect(first.conversations.every((item) => item.source === "synthetic")).toBe(
      true,
    );
    expect(seedDataset.cases).toHaveLength(5);
    expect(seedDataset.cases.every((item) => item.source.kind === "seed")).toBe(
      true,
    );
    expect(first.evalArtifacts).toEqual({
      resolutions: [],
      runs: [],
      suites: [],
    });
    expect(
      first.playbookHistory.versions[0]!.files.every((file) =>
        /^[a-f0-9]{64}$/.test(file.contentHash),
      ),
    ).toBe(true);
    expect(first.playbookHistory.versions[0]!.bundleHash).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });
});
