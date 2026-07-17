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
});
