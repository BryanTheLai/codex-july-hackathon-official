import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { serverDomainStateSchema } from "../../src/contracts/app-state";
import { SCHEMA_VERSION } from "../../src/contracts/constants";
import {
  compileDemoSeedSource,
  extractDomainSourceKeys,
} from "../../server/demo-seed-builder";
import {
  createSupabaseDemoWorkspaceResetDataSource,
  SupabaseDataSourceError,
} from "../../server/supabase";
import { createServerStateFixture } from "../fixtures/server-state";

const FIXTURE_TIME = "2026-07-18T08:00:00+08:00";

const inlineAirconSource = {
  schemaVersion: SCHEMA_VERSION,
  fixtureTime: FIXTURE_TIME,
  conversations: [
    {
      id: "convo-aircon-booking",
      patient: {
        name: "Aina Demo",
        phone: "+601100000101",
        medicalRecordNumber: "",
        preferredLanguage: "Malay",
      },
      channel: "Telegram",
      urgency: "routine",
      agentMode: "synthetic_agent",
      workflowStatus: "in_progress",
      resolvedAt: null,
      labels: ["aircon", "booking"],
      messages: [
        {
          id: "book-1",
          role: "patient",
          text: "Saya nak servis biasa untuk satu aircond wall unit 1.5 HP di SS2.",
          sentAt: FIXTURE_TIME,
        },
      ],
    },
  ],
  playbookFolders: ["playbooks", "playbooks/data"],
  playbookFiles: [
    {
      id: "file-aircon-rate-card",
      path: "playbooks/aircon-rate-card.md",
      title: "Aircon rate card",
      savedContent: "# Aircon rate card\n\n- General service: RM99 per unit.\n",
      updatedAt: FIXTURE_TIME,
      protected: true,
    },
  ],
  corrections: [],
  evalDatasets: [
    {
      id: "dataset-aircon-ops",
      name: "Aircon service operations",
      protected: true,
      candidateVersion: 1,
      criteria: [
        {
          id: "crit-aircon-price",
          label: "Fixed rate card",
          instruction: "Use RM99 general service and RM160 chemical wash",
          required: true,
          version: 1,
        },
      ],
      cases: [
        {
          id: "case-aircon-rate-card-train",
          title: "Malay general-service price",
          split: "train",
          type: "general",
          language: "Malay",
          inputConversation: {
            messages: [
              {
                id: "case-aircon-rate-card-train-1",
                role: "patient",
                text: "Berapa servis biasa?",
                sentAt: FIXTURE_TIME,
              },
            ],
          },
          expectedHumanOutput: "General service is RM99 per supported unit.",
          criterionIds: ["crit-aircon-price"],
          source: { kind: "seed" },
        },
      ],
      suiteSnapshots: [],
      runHistory: [],
    },
  ],
} as const;

describe("compileDemoSeedSource", () => {
  it("validates domain source keys and compiles server payload", async () => {
    expect(extractDomainSourceKeys(inlineAirconSource)).toEqual([
      "schemaVersion",
      "fixtureTime",
      "conversations",
      "playbookFolders",
      "playbookFiles",
      "corrections",
      "evalDatasets",
    ]);

    const compiled = await compileDemoSeedSource(inlineAirconSource);
    expect(serverDomainStateSchema.parse(compiled)).toEqual(compiled);
    expect(compiled.conversations[0]).toMatchObject({
      channel: "demo",
      source: "synthetic",
      revision: 1,
      patient: {
        medicalRecordNumber: null,
        externalContactId: null,
      },
    });
    expect(compiled.playbookHistory.versions[0]?.files[0]?.contentHash).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(compiled.evalArtifacts).toEqual({
      resolutions: [],
      runs: [],
      suites: [],
    });
  });

  it("compiles the checked-in Supabase aircon seed", async () => {
    const sql = await readFile(
      resolve(process.cwd(), "supabase/seed.sql"),
      "utf8",
    );
    const sourceJson = sql.match(/\$json\$(\{[\s\S]*\})\$json\$/)?.[1];
    if (!sourceJson) {
      throw new Error("Supabase seed is missing its $json$ source payload");
    }

    const compiled = await compileDemoSeedSource(JSON.parse(sourceJson));
    expect(compiled.conversations.map((conversation) => conversation.patient.name)).toEqual([
      "Aina Demo",
      "Farid Demo",
      "Mei Demo",
    ]);
    expect(compiled.playbookHistory.versions[0]?.files).toHaveLength(3);
    expect(compiled.evalDatasets[0]?.cases).toHaveLength(5);
  });

  it("keeps the reset migration service-role-only", async () => {
    const migration = await readFile(
      resolve(
        process.cwd(),
        "supabase/migrations/20260718010000_demo_seed_templates.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = pg_catalog, public");
    expect(migration).toContain("alter table public.demo_seed_templates enable row level security");
    expect(migration).toContain(
      "revoke all on function public.reset_demo_workspace(text, text, text) from public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.reset_demo_workspace(text, text, text) to service_role",
    );
  });

  it("defines transactional factory reset with full workspace cleanup", async () => {
    const migration = await readFile(
      resolve(
        process.cwd(),
        "supabase/migrations/20260718020000_factory_reset_demo_workspace.sql",
      ),
      "utf8",
    );

    expect(migration).toContain(
      "create or replace function public.reset_demo_workspace(",
    );
    expect(migration).toContain("p_expected_revision bigint");
    expect(migration).toMatch(/raise exception 'revision_conflict'/);
    expect(migration).toContain(
      "raise exception 'Workspace not allowlisted for reset: %', p_workspace_id",
    );
    expect(migration).toContain("if p_workspace_id is distinct from 'demo' then");

    const firstDeleteIndex = migration.indexOf(
      "delete from public.outbox_jobs where workspace_id = p_workspace_id",
    );
    const compiledSeedCheckIndex = migration.indexOf(
      "raise exception 'Seed template not compiled: %', p_seed_key",
    );
    expect(compiledSeedCheckIndex).toBeGreaterThan(-1);
    expect(firstDeleteIndex).toBeGreaterThan(-1);
    expect(compiledSeedCheckIndex).toBeLessThan(firstDeleteIndex);

    expect(migration).toContain(
      "delete from public.outbox_jobs where workspace_id = p_workspace_id",
    );
    expect(migration).toContain(
      "delete from public.google_calendar_events where workspace_id = p_workspace_id",
    );
    expect(migration).toContain(
      "delete from public.calendar_deliveries where workspace_id = p_workspace_id",
    );
    expect(migration).toContain(
      "delete from public.telegram_deliveries where workspace_id = p_workspace_id",
    );
    expect(migration).toContain(
      "delete from public.telegram_events where workspace_id = p_workspace_id",
    );
    expect(migration).toContain("set state = v_template.state");
    expect(migration).toContain("schema_version = v_template.schema_version");
    expect(migration).toContain("revision = revision + 1");
    expect(migration).not.toContain("delete from public.google_calendar_connections");
    expect(migration).toContain("'oauth_preserved', true");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = pg_catalog, public");
    expect(migration).toContain(
      "revoke all on function public.reset_demo_workspace(text, text, bigint) from public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.reset_demo_workspace(text, text, bigint) to service_role",
    );
  });
});

describe("createSupabaseDemoWorkspaceResetDataSource", () => {
  function fakeResetClient(
    rpcResponse: { data: unknown; error: { code?: string; message: string } | null },
    workspaceRow?: {
      workspace_id: string;
      schema_version: number;
      revision: number;
      state: unknown;
    },
  ): SupabaseClient {
    const workspace = workspaceRow ?? {
      workspace_id: "demo",
      schema_version: SCHEMA_VERSION,
      revision: 12,
      state: createServerStateFixture(),
    };
    return {
      rpc: async (name: string, params: Record<string, unknown>) => {
        expect(name).toBe("reset_demo_workspace");
        expect(params).toEqual({
          p_workspace_id: "demo",
          p_seed_key: "msme-aircon-v1",
          p_expected_revision: 11,
        });
        return rpcResponse;
      },
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: table === "demo_state" ? workspace : null,
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;
  }

  it("maps a successful reset RPC into workspace and cleanup counts", async () => {
    const compiledState = createServerStateFixture();
    const source = createSupabaseDemoWorkspaceResetDataSource(
      fakeResetClient({
        data: {
          workspace_id: "demo",
          seed_key: "msme-aircon-v1",
          previous_revision: 11,
          new_revision: 12,
          outbox_rows_removed: 3,
          google_events_removed: 2,
          calendar_deliveries_removed: 1,
          telegram_deliveries_removed: 4,
          telegram_events_removed: 5,
          oauth_preserved: true,
        },
        error: null,
      }),
    );

    await expect(
      source.reset("demo", "msme-aircon-v1", 11),
    ).resolves.toEqual({
      ok: true,
      workspace: {
        workspaceId: "demo",
        revision: 12,
        state: compiledState,
      },
      summary: {
        seedKey: "msme-aircon-v1",
        previousRevision: 11,
        newRevision: 12,
        outboxRowsRemoved: 3,
        googleEventsRemoved: 2,
        calendarDeliveriesRemoved: 1,
        telegramDeliveriesRemoved: 4,
        telegramEventsRemoved: 5,
        oauthPreserved: true,
      },
    });
  });

  it("maps revision_conflict RPC failures into SaveWorkspaceResult conflict shape", async () => {
    const currentState = createServerStateFixture();
    const source = createSupabaseDemoWorkspaceResetDataSource(
      fakeResetClient(
        {
          data: null,
          error: { message: "revision_conflict" },
        },
        {
          workspace_id: "demo",
          schema_version: SCHEMA_VERSION,
          revision: 13,
          state: currentState,
        },
      ),
    );

    await expect(
      source.reset("demo", "msme-aircon-v1", 11),
    ).resolves.toEqual({
      ok: false,
      code: "revision_conflict",
      workspace: {
        workspaceId: "demo",
        revision: 13,
        state: currentState,
      },
    });
  });

  it("maps prefixed revision_conflict RPC failures into SaveWorkspaceResult conflict shape", async () => {
    const currentState = createServerStateFixture();
    const source = createSupabaseDemoWorkspaceResetDataSource(
      fakeResetClient(
        {
          data: null,
          error: { message: "ERROR: revision_conflict" },
        },
        {
          workspace_id: "demo",
          schema_version: SCHEMA_VERSION,
          revision: 13,
          state: currentState,
        },
      ),
    );

    await expect(
      source.reset("demo", "msme-aircon-v1", 11),
    ).resolves.toEqual({
      ok: false,
      code: "revision_conflict",
      workspace: {
        workspaceId: "demo",
        revision: 13,
        state: currentState,
      },
    });
  });

  it("throws on non-conflict RPC failures", async () => {
    const source = createSupabaseDemoWorkspaceResetDataSource(
      fakeResetClient({
        data: null,
        error: { message: "Seed template not compiled: msme-aircon-v1" },
      }),
    );

    await expect(
      source.reset("demo", "msme-aircon-v1", 11),
    ).rejects.toEqual(
      new SupabaseDataSourceError(
        "update",
        "Supabase demo workspace reset failed",
      ),
    );
  });
});
