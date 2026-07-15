import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  createSupabaseWorkspaceDataSource,
  readSupabaseConfig,
  SupabaseDataSourceError,
} from "../../server/supabase";
import { createServerStateFixture } from "../fixtures/server-state";

type QueryResponse = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

class FakeSupabaseQuery {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  private readonly response: QueryResponse;

  constructor(response: QueryResponse) {
    this.response = response;
  }

  select(...args: unknown[]): this {
    this.calls.push({ method: "select", args });
    return this;
  }

  eq(...args: unknown[]): this {
    this.calls.push({ method: "eq", args });
    return this;
  }

  insert(...args: unknown[]): this {
    this.calls.push({ method: "insert", args });
    return this;
  }

  update(...args: unknown[]): this {
    this.calls.push({ method: "update", args });
    return this;
  }

  async maybeSingle(): Promise<QueryResponse> {
    this.calls.push({ method: "maybeSingle", args: [] });
    return this.response;
  }
}

function fakeClient(query: FakeSupabaseQuery): SupabaseClient {
  return {
    from: (table: string) => {
      query.calls.push({ method: "from", args: [table] });
      return query;
    },
  } as unknown as SupabaseClient;
}

function databaseRow(revision = 1) {
  return {
    workspace_id: "demo",
    schema_version: 4,
    revision,
    state: createServerStateFixture(),
  };
}

describe("Supabase server adapter", () => {
  it("loads bounded server-only configuration", () => {
    expect(
      readSupabaseConfig({
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        KAUNTER_WORKSPACE_ID: "demo",
      }),
    ).toEqual({
      url: "https://project.supabase.co",
      serviceRoleKey: "service-role-key",
      workspaceId: "demo",
    });

    expect(() => readSupabaseConfig({})).toThrow(
      "Supabase server configuration is invalid",
    );
  });

  it("maps a validated database row to the repository record", async () => {
    const query = new FakeSupabaseQuery({
      data: databaseRow(),
      error: null,
    });
    const source = createSupabaseWorkspaceDataSource(fakeClient(query));

    await expect(source.read("demo")).resolves.toEqual({
      workspaceId: "demo",
      schemaVersion: 4,
      revision: 1,
      state: createServerStateFixture(),
    });
    expect(query.calls).toEqual([
      { method: "from", args: ["demo_state"] },
      {
        method: "select",
        args: ["workspace_id,schema_version,revision,state"],
      },
      { method: "eq", args: ["workspace_id", "demo"] },
      { method: "maybeSingle", args: [] },
    ]);
  });

  it("migrates a stored workspace without Eval artifacts on read", async () => {
    const row = databaseRow();
    const { evalArtifacts: _evalArtifacts, ...legacyState } = row.state;
    const query = new FakeSupabaseQuery({
      data: {
        ...row,
        state: legacyState,
      },
      error: null,
    });
    const source = createSupabaseWorkspaceDataSource(fakeClient(query));

    await expect(source.read("demo")).resolves.toMatchObject({
      state: {
        evalArtifacts: {
          resolutions: [],
          runs: [],
          suites: [],
        },
      },
    });
  });

  it("treats only a uniqueness conflict as an existing bootstrap", async () => {
    const duplicateQuery = new FakeSupabaseQuery({
      data: null,
      error: { code: "23505", message: "duplicate detail" },
    });
    const duplicateSource = createSupabaseWorkspaceDataSource(
      fakeClient(duplicateQuery),
    );

    await expect(
      duplicateSource.insertIfAbsent({
        workspaceId: "demo",
        schemaVersion: 4,
        revision: 1,
        state: createServerStateFixture(),
      }),
    ).resolves.toBeNull();

    const failedQuery = new FakeSupabaseQuery({
      data: null,
      error: { code: "42501", message: "secret provider detail" },
    });
    const failedSource = createSupabaseWorkspaceDataSource(
      fakeClient(failedQuery),
    );
    await expect(
      failedSource.insertIfAbsent({
        workspaceId: "demo",
        schemaVersion: 4,
        revision: 1,
        state: createServerStateFixture(),
      }),
    ).rejects.toEqual(
      new SupabaseDataSourceError(
        "insert",
        "Supabase workspace insert failed",
      ),
    );
  });

  it("applies both workspace and expected-revision filters to CAS updates", async () => {
    const query = new FakeSupabaseQuery({
      data: databaseRow(2),
      error: null,
    });
    const source = createSupabaseWorkspaceDataSource(
      fakeClient(query),
      () => "2026-07-13T16:00:00.000Z",
    );

    await source.updateIfRevision(
      {
        workspaceId: "demo",
        schemaVersion: 4,
        revision: 2,
        state: createServerStateFixture(),
      },
      1,
    );

    expect(query.calls).toContainEqual({
      method: "eq",
      args: ["workspace_id", "demo"],
    });
    expect(query.calls).toContainEqual({
      method: "eq",
      args: ["revision", 1],
    });
    expect(query.calls).toContainEqual({
      method: "update",
      args: [
        {
          schema_version: 4,
          revision: 2,
          state: createServerStateFixture(),
          updated_at: "2026-07-13T16:00:00.000Z",
        },
      ],
    });
  });
});
