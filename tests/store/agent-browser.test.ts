import { describe, expect, it, vi } from "vitest";

import type { AgentRunResult } from "../../src/contracts/agent";
import { createCanonicalServerState } from "../../src/domain";
import { ApiClientError } from "../../src/services/api-client";
import { createAppStore } from "../../src/store/use-app-store";

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const agentResult: AgentRunResult = {
  runId: "agent-run-1",
  draft: {
    englishText: "Please seek urgent care now.",
    patientLanguage: "English",
    patientText: "Please seek urgent care now.",
  },
  proposedAction: "reply",
  handoffReason: null,
  evidence: [],
  toolCalls: [],
  stopReason: "completed",
  usage: {
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
  },
  latencyMs: 250,
};

async function fixture() {
  const serverState = await createCanonicalServerState();
  const conversation = serverState.conversations[0];
  if (!conversation) {
    throw new Error("Canonical state is missing a conversation");
  }
  const workspaceClient = {
    load: vi.fn(async () => ({
      workspaceId: "demo",
      revision: 4,
      state: serverState,
    })),
  };
  const agentClient = {
    run: vi.fn(async () => agentResult),
  };
  const outboundClient = {
    reconcile: vi.fn(),
    send: vi.fn(),
  };
  const store = createAppStore(new MemoryStorage(), {
    agentClient,
    outboundClient,
    workspaceClient,
  });
  return {
    agentClient,
    conversation,
    outboundClient,
    serverState,
    store,
    workspaceClient,
  };
}

describe("Chat agent draft orchestration", () => {
  it("uses the current server revision and never mutates or sends before approval", async () => {
    const {
      agentClient,
      conversation,
      outboundClient,
      store,
      workspaceClient,
    } = await fixture();
    const before = structuredClone(store.getState().state);

    const generated = await store
      .getState()
      .generateAgentDraft(conversation.id);

    expect(generated).toEqual({
      ok: true,
      result: agentResult,
    });
    expect(workspaceClient.load).toHaveBeenCalledTimes(1);
    expect(agentClient.run).toHaveBeenCalledWith(
      {
        kind: "manual",
        conversationId: conversation.id,
        expectedConversationRevision: conversation.revision,
      },
      undefined,
    );
    expect(store.getState().state).toEqual(before);
    expect(outboundClient.send).not.toHaveBeenCalled();
  });

  it("surfaces a revision conflict without changing the composer source state", async () => {
    const { agentClient, conversation, store } = await fixture();
    agentClient.run.mockRejectedValueOnce(
      new ApiClientError(
        "revision_conflict",
        "Conversation revision is stale",
        true,
      ),
    );
    const before = structuredClone(store.getState().state);

    const generated = await store
      .getState()
      .generateAgentDraft(conversation.id);

    expect(generated).toEqual({
      ok: false,
      error:
        "Conversation changed before generation. Refresh the inbox and retry.",
    });
    expect(store.getState().state).toEqual(before);
  });

  it("does not call the agent when the conversation is absent from server truth", async () => {
    const { agentClient, conversation, serverState, store, workspaceClient } =
      await fixture();
    workspaceClient.load.mockResolvedValueOnce({
      workspaceId: "demo",
      revision: 5,
      state: {
        ...serverState,
        conversations: serverState.conversations.filter(
          (candidate) => candidate.id !== conversation.id,
        ),
      },
    });

    const generated = await store
      .getState()
      .generateAgentDraft(conversation.id);

    expect(generated).toEqual({
      ok: false,
      error: "Conversation is unavailable in server workspace state.",
    });
    expect(agentClient.run).not.toHaveBeenCalled();
  });

  it("blocks resolved and Staff-only conversations before workspace access", async () => {
    const { agentClient, conversation, store, workspaceClient } =
      await fixture();
    const current = store.getState().state;
    store.setState({
      state: {
        ...current,
        conversations: current.conversations.map((candidate) =>
          candidate.id === conversation.id
            ? {
                ...candidate,
                workflowStatus: "resolved",
                resolvedAt: current.fixtureTime,
              }
            : candidate,
        ),
      },
    });

    await expect(
      store.getState().generateAgentDraft(conversation.id),
    ).resolves.toMatchObject({
      ok: false,
      error:
        "Conversation resolved. Reopen it before generating a draft.",
    });

    const resolved = store.getState().state;
    store.setState({
      state: {
        ...resolved,
        conversations: resolved.conversations.map((candidate) =>
          candidate.id === conversation.id
            ? {
                ...candidate,
                workflowStatus: "in_progress",
                resolvedAt: null,
                agentMode: "staff_only",
              }
            : candidate,
        ),
      },
    });
    await expect(
      store.getState().generateAgentDraft(conversation.id),
    ).resolves.toMatchObject({
      ok: false,
      error:
        "Agent mode is Staff only. Turn on agent handling before generating a draft.",
    });

    expect(workspaceClient.load).not.toHaveBeenCalled();
    expect(agentClient.run).not.toHaveBeenCalled();
  });

  it("does not report a completed draft after selection changes", async () => {
    const { agentClient, conversation, store } = await fixture();
    let resolveRun: ((value: AgentRunResult) => void) | undefined;
    agentClient.run.mockImplementationOnce(
      () =>
        new Promise<AgentRunResult>((resolve) => {
          resolveRun = resolve;
        }),
    );

    const generating = store
      .getState()
      .generateAgentDraft(conversation.id);
    await vi.waitFor(() => {
      expect(agentClient.run).toHaveBeenCalledTimes(1);
    });
    const nextConversation = store
      .getState()
      .state.conversations.find(
        (candidate) => candidate.id !== conversation.id,
      );
    if (!nextConversation || !resolveRun) {
      throw new Error("Fixture is missing a second conversation");
    }
    store.getState().selectConversation(nextConversation.id);
    resolveRun(agentResult);

    await expect(generating).resolves.toEqual({
      ok: true,
      result: agentResult,
    });
    expect(store.getState().lastFeedback).not.toBe(
      "Agent draft ready for review.",
    );
  });
});
