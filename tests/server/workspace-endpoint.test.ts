import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ServerDomainStatePayload } from "../../src/contracts/app-state";
import { createCanonicalServerState } from "../../src/domain";
import { createJudgeApp } from "../../server/index";
import { createWorkspaceRepository } from "../../server/workspace-repository";
import { InMemoryWorkspaceDataSource } from "./fixtures/workspace-data-source";

const servers: Array<ReturnType<ReturnType<typeof createJudgeApp>["listen"]>> =
  [];

async function start(
  options?: Parameters<typeof createJudgeApp>[0],
): Promise<string> {
  const server = createJudgeApp(options).listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function configuredServer(state?: ServerDomainStatePayload) {
  const dataSource = new InMemoryWorkspaceDataSource();
  const repository = createWorkspaceRepository(dataSource);
  await repository.bootstrap(
    "demo",
    state ?? (await createCanonicalServerState()),
  );
  const baseUrl = await start({
    workspace: {
      workspaceId: "demo",
      repository,
      createCanonicalState: createCanonicalServerState,
    },
  });
  return { baseUrl, dataSource, repository };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  );
});

describe("workspace endpoints", () => {
  it("returns a typed feature-disabled error without server storage config", async () => {
    const baseUrl = await start({ workspace: null });

    const response = await fetch(`${baseUrl}/api/workspace/state`);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: "feature_disabled",
      error: "Workspace persistence is not configured.",
      retryable: false,
    });
  });

  it("keeps the server available when Supabase config is partial", async () => {
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");

    const baseUrl = await start();
    const response = await fetch(`${baseUrl}/api/workspace/state`);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "feature_disabled",
    });
  });

  it("loads state, saves one matching revision, and returns truth on conflict", async () => {
    const { baseUrl } = await configuredServer();
    const loaded = await fetch(`${baseUrl}/api/workspace/state`);
    const initial = await loaded.json();
    const savedState = {
      ...initial.state,
      fixtureTime: "2026-07-13T18:00:00.000Z",
    };

    const saved = await fetch(`${baseUrl}/api/workspace/state`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 1,
        state: savedState,
      }),
    });
    const conflict = await fetch(`${baseUrl}/api/workspace/state`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 1,
        state: {
          ...savedState,
          fixtureTime: "2026-07-13T19:00:00.000Z",
        },
      }),
    });

    expect(loaded.status).toBe(200);
    expect(initial.revision).toBe(1);
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      ok: true,
      workspace: {
        revision: 2,
        state: { fixtureTime: "2026-07-13T18:00:00.000Z" },
      },
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      ok: false,
      code: "revision_conflict",
      workspace: {
        revision: 2,
        state: { fixtureTime: "2026-07-13T18:00:00.000Z" },
      },
    });
  });

  it("rejects an invalid save before touching storage", async () => {
    const { baseUrl, dataSource } = await configuredServer();

    const response = await fetch(`${baseUrl}/api/workspace/state`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 0,
        state: {},
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "invalid_request",
      error: "Workspace save request is invalid.",
      retryable: false,
    });
    expect(dataSource.records.get("demo")?.revision).toBe(1);
  });

  it("resets synthetic state while preserving Telegram and imported Eval truth", async () => {
    const dirty = await createCanonicalServerState();
    const telegram = {
      ...structuredClone(dirty.conversations[0]!),
      id: "conversation-telegram",
      channel: "telegram" as const,
      agentMode: "live_agent" as const,
      source: "telegram" as const,
      externalConversationId: "chat-42",
      patient: {
        ...structuredClone(dirty.conversations[0]!.patient),
        phone: null,
        medicalRecordNumber: null,
        externalContactId: "user-42",
      },
    };
    dirty.conversations.push(telegram);
    dirty.evalDatasets[0]!.cases.push({
      ...structuredClone(dirty.evalDatasets[0]!.cases[0]!),
      id: "case-hitl-42",
      source: {
        kind: "hitl",
        conversationId: telegram.id,
      },
      sourceConversationId: telegram.id,
    });
    dirty.evalDatasets[0]!.cases.push({
      ...structuredClone(dirty.evalDatasets[0]!.cases[0]!),
      id: "case-manual-42",
      source: { kind: "manual" },
    });
    dirty.playbookFiles[0]!.savedContent = "Dirty synthetic content";
    const { baseUrl } = await configuredServer(dirty);

    const response = await fetch(`${baseUrl}/api/demo/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 1 }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      workspace: {
        revision: 2,
      },
    });
    expect(
      body.workspace.state.conversations.some(
        (conversation: { id: string }) => conversation.id === telegram.id,
      ),
    ).toBe(true);
    expect(
      body.workspace.state.evalDatasets[0].cases.some(
        (evalCase: { id: string }) => evalCase.id === "case-hitl-42",
      ),
    ).toBe(true);
    expect(
      body.workspace.state.evalDatasets[0].cases.some(
        (evalCase: { id: string }) => evalCase.id === "case-manual-42",
      ),
    ).toBe(true);
    expect(body.workspace.state.evalDatasets[0].cases).toHaveLength(7);
    expect(body.workspace.state.playbookFiles[0].savedContent).not.toBe(
      "Dirty synthetic content",
    );

    const stale = await fetch(`${baseUrl}/api/demo/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 1 }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      ok: false,
      code: "revision_conflict",
      workspace: { revision: 2 },
    });
  });
});
