import { describe, expect, it } from "vitest";

import {
  inboundSpeechArtifactSchema,
  playbookVersionStateSchema,
  serverConversationSchema,
  serverDomainStateSchema,
} from "../../src/contracts/app-state";
import { createCanonicalSeed } from "../../src/domain";
import { createServerStateFixture } from "../fixtures/server-state";

describe("server state contract", () => {
  it("validates the fixed-workspace aggregate without client selections", () => {
    const state = createServerStateFixture();
    const parsed = serverDomainStateSchema.parse(state);

    expect(parsed).toEqual(state);
    expect("selections" in state).toBe(false);
  });

  it("validates frozen Eval artifacts and defaults legacy state safely", () => {
    const { evalArtifacts: _evalArtifacts, ...legacy } =
      createServerStateFixture();
    const migrated = serverDomainStateSchema.parse(legacy);

    expect(migrated.evalArtifacts).toEqual({
      resolutions: [],
      runs: [],
      suites: [],
    });
    expect(
      serverDomainStateSchema.safeParse({
        ...legacy,
        evalArtifacts: {
          resolutions: [],
          runs: [],
          suites: [],
        },
      }).success,
    ).toBe(true);
    expect(
      serverDomainStateSchema.parse({
        ...legacy,
        evalArtifacts: null,
      }).evalArtifacts,
    ).toEqual({
      resolutions: [],
      runs: [],
      suites: [],
    });
  });

  it("defaults absent or null legacy speech artifacts safely", () => {
    const { speechArtifacts: _speechArtifacts, ...legacy } =
      createServerStateFixture();

    expect(
      serverDomainStateSchema.parse(legacy).speechArtifacts,
    ).toEqual([]);
    expect(
      serverDomainStateSchema.parse({
        ...legacy,
        speechArtifacts: null,
      }).speechArtifacts,
    ).toEqual([]);
  });

  it("rejects client selections in backend-owned state", () => {
    const state = createServerStateFixture();

    expect(
      serverDomainStateSchema.safeParse({
        ...state,
        selections: createCanonicalSeed().selections,
      }).success,
    ).toBe(false);
  });

  it("requires a positive conversation revision and accepts Telegram nullability", () => {
    const state = createServerStateFixture();
    const conversation = {
      ...state.conversations[0]!,
      revision: 1,
      agentMode: "live_agent" as const,
      patient: {
        ...state.conversations[0]!.patient,
        phone: null,
        medicalRecordNumber: null,
        externalContactId: "telegram-user-1",
      },
      channel: "telegram" as const,
      source: "telegram" as const,
      externalConversationId: "telegram-chat-1",
    };

    expect(serverConversationSchema.safeParse(conversation).success).toBe(true);
    expect(
      serverConversationSchema.safeParse({
        ...conversation,
        source: "synthetic",
      }).success,
    ).toBe(false);
    expect(
      serverConversationSchema.safeParse({
        ...conversation,
        channel: "demo",
      }).success,
    ).toBe(false);
    expect(
      serverConversationSchema.safeParse({
        ...conversation,
        externalConversationId: null,
      }).success,
    ).toBe(false);
    expect(serverConversationSchema.safeParse({ ...conversation, revision: 0 }).success).toBe(false);
    const { revision: _revision, ...withoutRevision } = conversation;
    expect(serverConversationSchema.safeParse(withoutRevision).success).toBe(false);
  });

  it("requires unique speech artifacts linked to Telegram messages", () => {
    const state = createServerStateFixture();
    const conversation = state.conversations[0]!;
    const messageId = conversation.messages[0]!.id;
    const stateWithTelegram = {
      ...state,
      conversations: [
        {
          ...conversation,
          channel: "telegram" as const,
          source: "telegram" as const,
          externalConversationId: "-10042",
          patient: {
            ...conversation.patient,
            externalContactId: "42",
          },
        },
        ...state.conversations.slice(1),
      ],
    };
    const artifact = inboundSpeechArtifactSchema.parse({
      messageId,
      telegramFileId: "telegram-file-1",
      status: "pending",
      detectedLanguage: null,
      originalTranscript: null,
      englishGloss: null,
      model: null,
      error: null,
    });

    expect(
      serverDomainStateSchema.safeParse({
        ...stateWithTelegram,
        speechArtifacts: [artifact],
      }).success,
    ).toBe(true);
    expect(
      serverDomainStateSchema.safeParse({
        ...stateWithTelegram,
        speechArtifacts: [
          artifact,
          { ...artifact, telegramFileId: "telegram-file-2" },
        ],
      }).success,
    ).toBe(false);
    expect(
      serverDomainStateSchema.safeParse({
        ...stateWithTelegram,
        speechArtifacts: [
          { ...artifact, messageId: "missing-message" },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires playbook pointers to reference a stored bundle version", () => {
    const history = createServerStateFixture().playbookHistory;

    expect(playbookVersionStateSchema.safeParse(history).success).toBe(true);
    expect(
      playbookVersionStateSchema.safeParse({
        ...history,
        activeVersionId: "missing-version",
      }).success,
    ).toBe(false);
    expect(
      playbookVersionStateSchema.safeParse({
        ...history,
        candidateVersionId: "missing-version",
      }).success,
    ).toBe(false);
    expect(
      playbookVersionStateSchema.safeParse({
        ...history,
        rollbackTargetVersionId: "missing-version",
      }).success,
    ).toBe(false);
  });
});
