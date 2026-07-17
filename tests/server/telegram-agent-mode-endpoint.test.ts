import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  createCanonicalServerState,
  mergeTelegramInboundText,
} from "../../src/domain";
import { createJudgeApp } from "../../server/index";
import { createWorkspaceRepository } from "../../server/workspace-repository";
import { InMemoryWorkspaceDataSource } from "./fixtures/workspace-data-source";

const servers: Array<ReturnType<ReturnType<typeof createJudgeApp>["listen"]>> = [];

async function configuredServer() {
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
  const repository = createWorkspaceRepository(new InMemoryWorkspaceDataSource());
  const workspace = await repository.bootstrap("demo", inbound.state);
  const app = createJudgeApp({
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
});
