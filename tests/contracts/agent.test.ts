import { describe, expect, it } from "vitest";

import {
  AGENT_RUN_MODES,
  DEMO_TOOL_POLICY_VERSION,
  agentRunCreateRequestSchema,
  agentRunRequestSchema,
  agentRunResultSchema,
  providerAgentResultSchema,
} from "../../src/contracts/agent";

const hash = "a".repeat(64);
const request = {
  mode: "live",
  conversation: {
    id: "conversation-1",
    revision: 2,
    messages: [
      {
        id: "message-1",
        role: "patient",
        text: "Boleh saya buat temujanji?",
        language: "Malay",
        sentAt: "2026-07-13T12:00:00.000Z",
      },
    ],
  },
  patientContext: {
    preferredLanguage: "Malay",
  },
  bookingContext: {
    provider: "Dr. Tan",
    slotIso: "2026-07-14T09:00:00+08:00",
    reason: "Follow-up",
    status: "pending",
    revision: 1,
  },
  playbookBundle: {
    versions: [
      {
        fileId: "playbook-booking",
        versionId: "playbook-version-1",
        contentHash: hash,
        content: "Confirm the requested date before booking.",
      },
    ],
    bundleHash: hash,
  },
  agentConfigVersion: "agent-config-1",
  promptVersion: "agent-prompt-1",
  toolPolicyVersion: "demo-no-tools-v1",
} as const;

const providerResult = {
  draft: {
    englishText: "The clinic will contact you to confirm.",
    patientLanguage: "Malay",
    patientText: "Klinik akan menghubungi anda untuk pengesahan.",
  },
  proposedAction: "reply",
  handoffReason: null,
  evidence: [
    {
      fileId: "playbook-booking",
      versionId: "playbook-version-1",
      contentHash: hash,
      excerpt: "Confirm the requested date before booking.",
    },
  ],
} as const;

describe("shared agent contracts", () => {
  it("validates the pinned live and sandbox request", () => {
    expect(AGENT_RUN_MODES).toEqual(["live", "sandbox"]);
    expect(agentRunRequestSchema.parse(request)).toEqual(request);
    expect(
      agentRunRequestSchema.parse({
        ...request,
        mode: "sandbox",
        bookingContext: null,
      }),
    ).toMatchObject({
      mode: "sandbox",
      bookingContext: null,
    });
  });

  it("requires the empty demo tool policy and valid immutable pins", () => {
    expect(DEMO_TOOL_POLICY_VERSION).toBe("demo-no-tools-v1");
    expect(
      agentRunRequestSchema.safeParse({
        ...request,
        toolPolicyVersion: "tools-enabled",
      }).success,
    ).toBe(false);
    expect(
      agentRunRequestSchema.safeParse({
        ...request,
        conversation: {
          ...request.conversation,
          revision: 0,
        },
      }).success,
    ).toBe(false);
    expect(
      agentRunRequestSchema.safeParse({
        ...request,
        playbookBundle: {
          ...request.playbookBundle,
          bundleHash: "not-a-sha256",
        },
      }).success,
    ).toBe(false);
    expect(
      agentRunRequestSchema.safeParse({
        ...request,
        playbookBundle: {
          ...request.playbookBundle,
          versions: [
            request.playbookBundle.versions[0],
            request.playbookBundle.versions[0],
          ],
        },
      }).success,
    ).toBe(false);
    for (const forbidden of [
      { judgeBundle: { expectedStaffResponse: "Hidden answer" } },
      { expectedHumanOutput: "Hidden answer" },
      { criterionIds: ["criterion-1"] },
      { grade: { verdict: "pass" } },
      { rubricRefs: [{ id: "criterion-1", version: 1 }] },
      { actualSyntheticOutput: "Prior output" },
    ]) {
      expect(
        agentRunRequestSchema.safeParse({
          ...request,
          ...forbidden,
        }).success,
      ).toBe(false);
    }
  });

  it("validates provider output separately from server-owned run evidence", () => {
    expect(providerAgentResultSchema.parse(providerResult)).toEqual(
      providerResult,
    );

    const result = {
      runId: "agent-run-1",
      ...providerResult,
      toolCalls: [],
      stopReason: "completed",
      usage: {
        inputTokens: 100,
        outputTokens: 30,
        totalTokens: 130,
      },
      latencyMs: 420,
    } as const;
    expect(agentRunResultSchema.parse(result)).toEqual(result);
    expect(
      agentRunResultSchema.safeParse({
        ...result,
        toolCalls: [{ name: "send_telegram" }],
      }).success,
    ).toBe(false);
    expect(
      agentRunResultSchema.safeParse({
        ...result,
        usage: {
          ...result.usage,
          totalTokens: 999,
        },
      }).success,
    ).toBe(false);
    expect(
      providerAgentResultSchema.safeParse({
        ...providerResult,
        proposedAction: "staff_handoff",
        handoffReason: null,
      }).success,
    ).toBe(false);
    expect(
      providerAgentResultSchema.parse({
        ...providerResult,
        proposedAction: "staff_handoff",
        handoffReason: "A clinician must review this request.",
      }),
    ).toMatchObject({
      proposedAction: "staff_handoff",
      handoffReason: "A clinician must review this request.",
    });
    expect(
      providerAgentResultSchema.safeParse({
        ...providerResult,
        handoffReason: "Reply must not carry a handoff reason.",
      }).success,
    ).toBe(false);
    expect(
      providerAgentResultSchema.safeParse({
        ...providerResult,
        unexpected: true,
      }).success,
    ).toBe(false);
    expect(
      providerAgentResultSchema.safeParse({
        ...providerResult,
        draft: {
          ...providerResult.draft,
          englishText: "   ",
        },
      }).success,
    ).toBe(false);
  });

  it("validates manual and retry create requests without accepting extras", () => {
    expect(
      agentRunCreateRequestSchema.parse({
        kind: "manual",
        conversationId: "conversation-1",
        expectedConversationRevision: 2,
      }),
    ).toEqual({
      kind: "manual",
      conversationId: "conversation-1",
      expectedConversationRevision: 2,
    });
    expect(
      agentRunCreateRequestSchema.parse({
        kind: "retry",
        conversationId: "conversation-1",
        expectedConversationRevision: 2,
        previousRunId: "agent-run-1",
      }),
    ).toMatchObject({
      kind: "retry",
      previousRunId: "agent-run-1",
    });
    expect(
      agentRunCreateRequestSchema.safeParse({
        kind: "manual",
        conversationId: "conversation-1",
        expectedConversationRevision: 2,
        previousRunId: "not-allowed",
      }).success,
    ).toBe(false);
  });
});
