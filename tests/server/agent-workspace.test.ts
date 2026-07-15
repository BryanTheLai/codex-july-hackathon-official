import { describe, expect, it } from "vitest";

import type { AgentRunCreateRequest } from "../../src/contracts/agent";
import { createCanonicalServerState } from "../../src/domain";
import {
  AgentWorkspaceError,
  buildLiveAgentRunRequest,
} from "../../server/agent-workspace";

async function fixture() {
  const state = await createCanonicalServerState();
  const conversation = state.conversations[0];
  if (!conversation) {
    throw new Error("Canonical state is missing a conversation");
  }
  const request: AgentRunCreateRequest = {
    kind: "manual",
    conversationId: conversation.id,
    expectedConversationRevision: conversation.revision,
  };
  return { conversation, request, state };
}

describe("agent workspace request builder", () => {
  it("rejects unknown and resolved conversations", async () => {
    const { conversation, request, state } = await fixture();

    expect(() =>
      buildLiveAgentRunRequest(
        state,
        {
          ...request,
          conversationId: "missing-conversation",
        },
        "agent-config-test",
      ),
    ).toThrow(
      expect.objectContaining<Partial<AgentWorkspaceError>>({
        code: "not_found",
        retryable: false,
      }),
    );

    conversation.workflowStatus = "resolved";
    conversation.resolvedAt = "2026-07-13T12:00:00.000Z";
    expect(() =>
      buildLiveAgentRunRequest(
        state,
        request,
        "agent-config-test",
      ),
    ).toThrow(
      expect.objectContaining<Partial<AgentWorkspaceError>>({
        code: "invalid_request",
        retryable: false,
      }),
    );
  });

  it("rejects a missing active Dream bundle", async () => {
    const { request, state } = await fixture();
    state.playbookHistory.activeVersionId = "missing-version";

    expect(() =>
      buildLiveAgentRunRequest(
        state,
        request,
        "agent-config-test",
      ),
    ).toThrow(
      expect.objectContaining<Partial<AgentWorkspaceError>>({
        code: "provider_failed",
        retryable: false,
      }),
    );
  });

  it("normalizes invalid workspace inputs before provider execution", async () => {
    const { request, state } = await fixture();
    const active = state.playbookHistory.versions.find(
      (version) =>
        version.id === state.playbookHistory.activeVersionId,
    );
    if (!active?.files[0]) {
      throw new Error("Canonical state is missing an active Dream file");
    }
    active.files[0].content = "";

    expect(() =>
      buildLiveAgentRunRequest(
        state,
        request,
        "agent-config-test",
      ),
    ).toThrow(
      expect.objectContaining<Partial<AgentWorkspaceError>>({
        code: "provider_failed",
        retryable: false,
        message: "Workspace agent inputs are invalid",
      }),
    );
  });
});
