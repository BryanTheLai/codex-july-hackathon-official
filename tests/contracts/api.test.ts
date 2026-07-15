import { describe, expect, it } from "vitest";

import {
  API_ERROR_CODES,
  apiErrorSchema,
  outboundReconcileRequestSchema,
  outboundReconcileResultSchema,
  outboundSendRequestSchema,
  outboundSendResultSchema,
  requestIdSchema,
  resetDemoRequestSchema,
  saveWorkspaceRequestSchema,
  saveWorkspaceResultSchema,
  workspaceEnvelopeSchema,
} from "../../src/contracts/api";
import { createServerStateFixture } from "../fixtures/server-state";

const workspaceId = "workspace-demo";

describe("shared API contracts", () => {
  it("validates bounded request IDs", () => {
    expect(requestIdSchema.safeParse("request-1").success).toBe(true);
    expect(requestIdSchema.safeParse("").success).toBe(false);
    expect(requestIdSchema.safeParse("x".repeat(129)).success).toBe(false);
  });

  it("validates the fixed workspace envelope and positive aggregate revision", () => {
    const envelope = {
      workspaceId,
      revision: 1,
      state: createServerStateFixture(),
    };

    expect(workspaceEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expect(workspaceEnvelopeSchema.safeParse({ ...envelope, workspaceId: "" }).success).toBe(
      false,
    );
    expect(workspaceEnvelopeSchema.safeParse({ ...envelope, revision: 0 }).success).toBe(false);
  });

  it("rejects UI selections and unknown fields in workspace envelopes", () => {
    const envelope = {
      workspaceId,
      revision: 1,
      state: {
        ...createServerStateFixture(),
        selections: { route: "chat" },
      },
    };

    expect(workspaceEnvelopeSchema.safeParse(envelope).success).toBe(false);
    expect(
      workspaceEnvelopeSchema.safeParse({
        ...envelope,
        state: createServerStateFixture(),
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("validates compare-and-swap save requests and revisioned results", () => {
    const state = createServerStateFixture();
    const request = {
      expectedRevision: 3,
      state,
    };
    const workspace = {
      workspaceId,
      revision: 4,
      state,
    };

    expect(saveWorkspaceRequestSchema.parse(request)).toEqual(request);
    expect(
      saveWorkspaceResultSchema.parse({
        ok: true,
        workspace,
      }),
    ).toEqual({
      ok: true,
      workspace,
    });
    expect(
      saveWorkspaceResultSchema.parse({
        ok: false,
        code: "revision_conflict",
        workspace,
      }),
    ).toEqual({
      ok: false,
      code: "revision_conflict",
      workspace,
    });
    expect(
      saveWorkspaceRequestSchema.safeParse({ ...request, expectedRevision: 0 }).success,
    ).toBe(false);
    expect(saveWorkspaceRequestSchema.safeParse({ ...request, unknown: true }).success).toBe(
      false,
    );
  });

  it("requires a positive revision for synthetic reset", () => {
    expect(resetDemoRequestSchema.parse({ expectedRevision: 2 })).toEqual({
      expectedRevision: 2,
    });
    expect(
      resetDemoRequestSchema.safeParse({ expectedRevision: 0 }).success,
    ).toBe(false);
    expect(
      resetDemoRequestSchema.safeParse({
        expectedRevision: 2,
        wipeTelegram: true,
      }).success,
    ).toBe(false);
  });

  it("validates text-only outbound send and reconciliation contracts", () => {
    const sendRequest = {
      requestId: "send-42",
      conversationId: "conversation-telegram-42",
      expectedConversationRevision: 3,
      targetLanguage: "Malay",
      approvedPatientText: "Klinik akan menghubungi anda.",
      mode: "text",
    } as const;
    const receipt = {
      providerMessageId: "9001",
      acceptedAt: "2026-07-13T12:01:00.000Z",
    };

    expect(outboundSendRequestSchema.parse(sendRequest)).toEqual(sendRequest);
    expect(
      outboundSendResultSchema.parse({
        deliveryIds: ["send-42"],
        status: "sent",
        text: receipt,
      }),
    ).toEqual({
      deliveryIds: ["send-42"],
      status: "sent",
      text: receipt,
    });
    expect(
      outboundReconcileRequestSchema.parse({
        expectedConversationRevision: 4,
      }),
    ).toEqual({
      expectedConversationRevision: 4,
    });
    expect(
      outboundReconcileResultSchema.parse({
        deliveryId: "send-42",
        workspaceSyncStatus: "synced",
        workspaceRevision: 5,
      }),
    ).toEqual({
      deliveryId: "send-42",
      workspaceSyncStatus: "synced",
      workspaceRevision: 5,
    });
  });

  it("rejects unapproved outbound modes, stale revisions, and invalid sent results", () => {
    const request = {
      requestId: "send-42",
      conversationId: "conversation-telegram-42",
      expectedConversationRevision: 3,
      targetLanguage: "Malay",
      approvedPatientText: "Klinik akan menghubungi anda.",
      mode: "text",
    };

    expect(
      outboundSendRequestSchema.safeParse({
        ...request,
        mode: "voice",
      }).success,
    ).toBe(false);
    expect(
      outboundSendRequestSchema.safeParse({
        ...request,
        expectedConversationRevision: 0,
      }).success,
    ).toBe(false);
    expect(
      outboundSendRequestSchema.safeParse({
        ...request,
        approvedPatientText: "x".repeat(4097),
      }).success,
    ).toBe(false);
    expect(
      outboundSendResultSchema.safeParse({
        deliveryIds: ["send-42"],
        status: "sent",
      }).success,
    ).toBe(false);
  });

  it("validates every shared error code and rejects invented codes", () => {
    expect(API_ERROR_CODES).toEqual([
      "invalid_request",
      "not_found",
      "revision_conflict",
      "duplicate",
      "provider_timeout",
      "provider_failed",
      "feature_disabled",
      "release_blocked",
    ]);
    for (const code of API_ERROR_CODES) {
      expect(
        apiErrorSchema.safeParse({
          code,
          error: "Request failed",
          retryable: code === "provider_timeout",
        }).success,
      ).toBe(true);
    }
    expect(
      apiErrorSchema.safeParse({
        code: "made_up",
        error: "Request failed",
        retryable: false,
      }).success,
    ).toBe(false);
  });

  it("rejects incomplete conflict results and unknown error fields", () => {
    const error = {
      code: "revision_conflict" as const,
      error: "Workspace revision changed",
      retryable: true,
    };

    expect(apiErrorSchema.parse(error)).toEqual(error);
    expect(apiErrorSchema.safeParse({ ...error, stack: "private" }).success).toBe(false);
    expect(
      saveWorkspaceResultSchema.safeParse({
        ok: false,
        code: "revision_conflict",
      }).success,
    ).toBe(false);
  });
});
