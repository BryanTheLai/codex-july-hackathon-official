import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createCanonicalServerState,
  mergeTelegramInboundText,
} from "../../src/domain";
import { createJudgeApp } from "../../server/index";
import { createWorkspaceRepository } from "../../server/workspace-repository";
import { InMemoryWorkspaceDataSource } from "./fixtures/workspace-data-source";

const servers: Array<ReturnType<ReturnType<typeof createJudgeApp>["listen"]>> = [];

async function configuredServer(initialMode: "live_agent" | "staff_only" = "live_agent") {
  const inbound = mergeTelegramInboundText(await createCanonicalServerState(), {
    channel: "telegram",
    externalEventId: "101",
    externalConversationId: "-101",
    externalMessageId: "11",
    sender: { externalId: "patient-1", displayName: "Aina" },
    message: { kind: "text", language: "en", text: "Please book." },
    receivedAt: "2026-07-17T01:00:00.000Z",
  });
  if (!inbound.ok) throw new Error(inbound.error);
  inbound.state.conversations[0]!.agentMode = initialMode;
  const repository = createWorkspaceRepository(new InMemoryWorkspaceDataSource());
  const workspace = await repository.bootstrap("demo", inbound.state);
  const run = vi.fn().mockResolvedValue({
    runId: "reply-now-run",
    draft: {
      englishText: "I can help. What is the unit horsepower?",
      patientLanguage: "English",
      patientText: "I can help. What is the unit horsepower?",
    },
    evidence: [],
    handoffReason: null,
    latencyMs: 10,
    proposedAction: "reply",
    stopReason: "completed",
    toolCalls: [],
    usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
  });
  const send = vi.fn().mockResolvedValue({
    deliveryIds: ["reply-now-delivery"],
    status: "sent",
    text: {
      acceptedAt: "2026-07-17T01:05:00.000Z",
      providerMessageId: "reply-now-message",
    },
  });
  const app = createJudgeApp({
    agent: {
      agentConfigVersion: "agent-config-test",
      liveEnabled: true,
      run,
    },
    telegram: {
      autoReplyEnabled: true,
      webhookSecret: "webhook-secret",
      inbound: {
        process: vi.fn(),
      },
      outbound: {
        attachRecordedVoice: vi.fn(),
        prepareVoice: vi.fn(),
        readVoiceAudio: vi.fn(),
        reconcile: vi.fn(),
        send,
      },
    },
    workspace: {
      workspaceId: "demo",
      repository,
      createCanonicalState: createCanonicalServerState,
    },
  });
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    conversation: workspace.state.conversations[0]!,
    run,
    send,
    workspace,
  };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => error ? reject(error) : resolve()),
        ),
    ),
  );
});

describe("Telegram autopilot endpoint", () => {
  it("updates one persisted Telegram conversation without accepting the full workspace payload", async () => {
    const { baseUrl, conversation, workspace } = await configuredServer();
    const response = await fetch(
      `${baseUrl}/api/telegram/conversations/${encodeURIComponent(conversation.id)}/agent-mode`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentMode: "staff_only",
          expectedConversationRevision: conversation.revision,
          expectedWorkspaceRevision: workspace.revision,
        }),
      },
    );

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.ok).toBe(true);
    expect(result.workspace.revision).toBe(workspace.revision + 1);
    expect(
      result.workspace.state.conversations.find(
        (candidate: { id: string }) => candidate.id === conversation.id,
      ),
    ).toMatchObject({
      agentMode: "staff_only",
      id: conversation.id,
      revision: conversation.revision + 1,
    });
  });

  it("replies to the latest waiting message after autopilot is resumed", async () => {
    const { baseUrl, conversation, run, send, workspace } =
      await configuredServer("staff_only");
    const resumed = await fetch(
      `${baseUrl}/api/telegram/conversations/${encodeURIComponent(conversation.id)}/agent-mode`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentMode: "live_agent",
          expectedConversationRevision: conversation.revision,
          expectedWorkspaceRevision: workspace.revision,
        }),
      },
    );
    const resumedBody = await resumed.json();
    const resumedConversation = resumedBody.workspace.state.conversations.find(
      (candidate: { id: string }) => candidate.id === conversation.id,
    );

    const response = await fetch(
      `${baseUrl}/api/telegram/conversations/${encodeURIComponent(conversation.id)}/reply-now`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedConversationRevision: resumedConversation.revision,
          expectedWorkspaceRevision: resumedBody.workspace.revision,
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        approvedPatientText: "I can help. What is the unit horsepower?",
        conversationId: conversation.id,
      }),
    );
  });
});
