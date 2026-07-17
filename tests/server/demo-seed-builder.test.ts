import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { serverDomainStateSchema } from "../../src/contracts/app-state";
import { SCHEMA_VERSION } from "../../src/contracts/constants";
import {
  compileDemoSeedSource,
  extractDomainSourceKeys,
} from "../../server/demo-seed-builder";

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
});
