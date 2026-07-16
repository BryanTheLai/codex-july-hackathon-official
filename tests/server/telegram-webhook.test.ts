import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createCanonicalServerState,
  mergeTelegramInboundText,
} from "../../src/domain";
import { createJudgeApp } from "../../server/index";
import { createTelegramAdapter } from "../../server/telegram-adapter";
import { createTelegramInboundService } from "../../server/telegram-inbound-service";
import type { AgentRunRequest, AgentRunResult } from "../../src/contracts/agent";
import type { TelegramOutboundService } from "../../server/telegram-outbound-service";
import type { InboundSpeechService } from "../../server/inbound-speech-service";
import { createTelegramEventRepository } from "../../server/telegram-repository";
import type { WorkspaceRepository } from "../../server/workspace-repository";
import { createWorkspaceRepository } from "../../server/workspace-repository";
import { InMemoryTelegramEventDataSource } from "./fixtures/telegram-data-source";
import { InMemoryWorkspaceDataSource } from "./fixtures/workspace-data-source";

const servers: Array<ReturnType<ReturnType<typeof createJudgeApp>["listen"]>> =
  [];

const update = {
  update_id: 1001,
  message: {
    message_id: 88,
    date: 1_783_944_000,
    from: {
      id: 42,
      is_bot: false,
      first_name: "Aina",
      last_name: "Zulkifli",
      language_code: "ms",
    },
    chat: {
      id: -10042,
      type: "group",
      title: "Clinic test chat",
    },
    text: "Boleh saya buat temujanji?",
  },
};

const voiceUpdate = {
  ...update,
  update_id: 1002,
  message: {
    ...update.message,
    message_id: 89,
    text: undefined,
    voice: {
      file_id: "voice-1",
      file_unique_id: "voice-unique-1",
      duration: 4,
      mime_type: "audio/ogg",
      file_size: 12_345,
    },
  },
};

async function configuredServer(options?: {
  agent?: {
    agentConfigVersion: string;
    liveEnabled?: boolean;
    run(request: AgentRunRequest, signal?: AbortSignal): Promise<AgentRunResult>;
  };
  autoReplyEnabled?: boolean;
  inboundWorkspaceRepository?: WorkspaceRepository;
  maxCasAttempts?: number;
  outbound?: TelegramOutboundService;
  speech?: InboundSpeechService;
}) {
  const workspaceDataSource = new InMemoryWorkspaceDataSource();
  const workspaceRepository = createWorkspaceRepository(workspaceDataSource);
  await workspaceRepository.bootstrap(
    "demo",
    await createCanonicalServerState(),
  );
  const eventDataSource = new InMemoryTelegramEventDataSource();
  const eventRepository = createTelegramEventRepository(eventDataSource);
  const adapter = createTelegramAdapter({ botToken: "123456:test-token" });
  const inbound = createTelegramInboundService({
    adapter,
    eventRepository,
    workspaceId: "demo",
    workspaceRepository:
      options?.inboundWorkspaceRepository ?? workspaceRepository,
    maxCasAttempts: options?.maxCasAttempts,
  });
  const app = createJudgeApp({
    agent: options?.agent ?? null,
    workspace: {
      workspaceId: "demo",
      repository: workspaceRepository,
      createCanonicalState: createCanonicalServerState,
    },
    telegram: {
      autoReplyEnabled: options?.autoReplyEnabled,
      webhookSecret: "webhook_secret-42",
      inbound,
      normalizeInbound: adapter.normalizeInbound,
      outbound: options?.outbound,
      speech: options?.speech,
    },
  });
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    eventDataSource,
    eventRepository,
    workspaceRepository,
  };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  );
});

function postWebhook(
  baseUrl: string,
  payload: unknown,
  secret = "webhook_secret-42",
) {
  return fetch(`${baseUrl}/api/telegram/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": secret,
    },
    body: JSON.stringify(payload),
  });
}

describe("Telegram webhook", () => {
  it("automatically sends exactly one agent text reply for a newly persisted Telegram message", async () => {
    const run = vi.fn(async (): Promise<AgentRunResult> => ({
      draft: {
        englishText: "I can help with an appointment.",
        patientLanguage: "Malay",
        patientText: "Saya boleh bantu dengan temujanji.",
      },
      evidence: [],
      handoffReason: null,
      latencyMs: 12,
      proposedAction: "reply",
      runId: "agent-auto-1",
      stopReason: "completed",
      toolCalls: [],
      usage: { inputTokens: 4, outputTokens: 5, totalTokens: 9 },
    }));
    const send = vi.fn(async () => ({
      deliveryIds: ["agent-auto-delivery"],
      status: "sent" as const,
      text: {
        acceptedAt: "2026-07-13T12:00:00.000Z",
        providerMessageId: "123",
      },
    }));
    const outbound: TelegramOutboundService = {
      attachRecordedVoice: vi.fn(),
      prepareVoice: vi.fn(),
      readVoiceAudio: vi.fn(),
      reconcile: vi.fn(),
      send,
    };
    const { baseUrl } = await configuredServer({
      agent: { agentConfigVersion: "auto-agent-v1", liveEnabled: true, run },
      autoReplyEnabled: true,
      outbound,
    });

    expect((await postWebhook(baseUrl, update)).status).toBe(200);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation: expect.objectContaining({
          id: "telegram-conversation:-10042",
          revision: 1,
        }),
        mode: "live",
      }),
      expect.any(AbortSignal),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        approvedPatientText: "Saya boleh bantu dengan temujanji.",
        conversationId: "telegram-conversation:-10042",
        mode: "text",
        targetLanguage: "Malay",
      }),
    );

    expect((await postWebhook(baseUrl, update)).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(run).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("logs and does not send when the automatic agent requests staff handoff", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const send = vi.fn();
    const outbound: TelegramOutboundService = {
      attachRecordedVoice: vi.fn(),
      prepareVoice: vi.fn(),
      readVoiceAudio: vi.fn(),
      reconcile: vi.fn(),
      send,
    };
    const { baseUrl } = await configuredServer({
      agent: {
        agentConfigVersion: "auto-agent-v1",
        liveEnabled: true,
        run: vi.fn(async (): Promise<AgentRunResult> => ({
          draft: {
            englishText: "A staff member will help.",
            patientLanguage: "Malay",
            patientText: "Seorang staf akan membantu.",
          },
          evidence: [],
          handoffReason: "Needs staff review",
          latencyMs: 12,
          proposedAction: "staff_handoff",
          runId: "agent-auto-handoff",
          stopReason: "handoff",
          toolCalls: [],
          usage: { inputTokens: 4, outputTokens: 5, totalTokens: 9 },
        })),
      },
      autoReplyEnabled: true,
      outbound,
    });

    expect((await postWebhook(baseUrl, update)).status).toBe(200);
    await vi.waitFor(() =>
      expect(info).toHaveBeenCalledWith(
        expect.stringContaining('"event":"telegram_auto_reply_handoff"'),
      ),
    );
    expect(send).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it("rejects a wrong provider secret before persistence", async () => {
    const { baseUrl, eventDataSource } = await configuredServer();

    const response = await postWebhook(baseUrl, update, "wrong-secret");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "invalid_request",
      error: "Telegram webhook secret is invalid.",
      retryable: false,
    });
    expect(eventDataSource.records).toHaveLength(0);
  });

  it("persists one inbound text and returns 200 for the duplicate update", async () => {
    const { baseUrl, eventRepository, workspaceRepository } =
      await configuredServer();

    const first = await postWebhook(baseUrl, update);
    const duplicate = await postWebhook(baseUrl, update);
    const workspace = await workspaceRepository.load("demo");

    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({
      ok: true,
      status: "processed",
    });
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toEqual({
      ok: true,
      status: "duplicate",
    });
    expect(await eventRepository.read(1001)).toMatchObject({
      status: "processed",
    });
    const telegramConversations =
      workspace?.state.conversations.filter(
        (conversation) => conversation.source === "telegram",
      ) ?? [];
    expect(telegramConversations).toHaveLength(1);
    expect(telegramConversations[0]?.messages).toEqual([
      expect.objectContaining({
        id: "telegram-message:-10042:88",
        text: "Boleh saya buat temujanji?",
      }),
    ]);
  });

  it("rejects the same update ID when its payload changes", async () => {
    const { baseUrl, eventRepository, workspaceRepository } =
      await configuredServer();
    expect((await postWebhook(baseUrl, update)).status).toBe(200);

    const mismatch = await postWebhook(baseUrl, {
      ...update,
      message: {
        ...update.message,
        text: "Payload yang berbeza.",
      },
    });

    expect(mismatch.status).toBe(400);
    await expect(mismatch.json()).resolves.toMatchObject({
      code: "invalid_request",
      retryable: false,
    });
    expect(await eventRepository.read(1001)).toMatchObject({
      status: "processed",
    });
    const workspace = await workspaceRepository.load("demo");
    expect(
      workspace?.state.conversations
        .find(
          (conversation) =>
            conversation.id === "telegram-conversation:-10042",
        )
        ?.messages,
    ).toHaveLength(1);
  });

  it("retries a failed event and persists one message", async () => {
    const dataSource = new InMemoryWorkspaceDataSource();
    const realRepository = createWorkspaceRepository(dataSource);
    await realRepository.bootstrap(
      "demo",
      await createCanonicalServerState(),
    );
    let saveCalls = 0;
    const conflictOnce: WorkspaceRepository = {
      bootstrap: realRepository.bootstrap,
      load: realRepository.load,
      async save(workspaceId, revision, state) {
        saveCalls += 1;
        if (saveCalls === 1) {
          const current = await realRepository.load(workspaceId);
          if (!current) {
            throw new Error("Workspace missing");
          }
          return {
            ok: false,
            code: "revision_conflict",
            workspace: current,
          };
        }
        return realRepository.save(workspaceId, revision, state);
      },
    };
    const { baseUrl, eventRepository } = await configuredServer({
      inboundWorkspaceRepository: conflictOnce,
      maxCasAttempts: 1,
    });

    const failed = await postWebhook(baseUrl, update);
    expect(failed.status).toBe(409);
    expect(await eventRepository.read(1001)).toMatchObject({
      status: "failed",
    });

    const retried = await postWebhook(baseUrl, update);
    expect(retried.status).toBe(200);
    await expect(retried.json()).resolves.toEqual({
      ok: true,
      status: "processed",
    });
    expect(await eventRepository.read(1001)).toMatchObject({
      status: "processed",
    });
    const workspace = await realRepository.load("demo");
    expect(
      workspace?.state.conversations
        .find(
          (conversation) =>
            conversation.id === "telegram-conversation:-10042",
        )
        ?.messages,
    ).toHaveLength(1);
  });

  it("persists inbound voice metadata without downloading audio or calling STT", async () => {
    const { baseUrl, eventRepository, workspaceRepository } =
      await configuredServer();

    const first = await postWebhook(baseUrl, voiceUpdate);
    const duplicate = await postWebhook(baseUrl, voiceUpdate);
    const workspace = await workspaceRepository.load("demo");

    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({
      ok: true,
      status: "processed",
    });
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toEqual({
      ok: true,
      status: "duplicate",
    });
    expect(await eventRepository.read(1002)).toMatchObject({
      status: "processed",
    });
    expect(
      workspace?.state.conversations
        .find(
          (conversation) =>
            conversation.id === "telegram-conversation:-10042",
        )
        ?.messages,
    ).toEqual([
      expect.objectContaining({
        id: "telegram-message:-10042:89",
        text: "Voice note awaiting transcription.",
      }),
    ]);
    expect(workspace?.state.speechArtifacts).toEqual([
      expect.objectContaining({
        messageId: "telegram-message:-10042:89",
        telegramFileId: "voice-1",
        status: "pending",
      }),
    ]);
  });

  it("starts background speech processing only after the voice webhook is persisted", async () => {
    const speech: InboundSpeechService = {
      transcribeNext: vi.fn().mockResolvedValue({ status: "idle" }),
      retry: vi.fn(),
      saveManualTranscript: vi.fn(),
      downloadAudio: vi.fn(),
    };
    const { baseUrl } = await configuredServer({ speech });

    expect((await postWebhook(baseUrl, voiceUpdate)).status).toBe(200);
    await vi.waitFor(() => {
      expect(speech.transcribeNext).toHaveBeenCalledTimes(1);
    });
  });

  it("repairs a pending speech artifact when the message is already durable", async () => {
    const { baseUrl, workspaceRepository } = await configuredServer();
    const workspace = await workspaceRepository.load("demo");
    expect(workspace).not.toBeNull();
    if (!workspace) {
      return;
    }
    const messageOnly = mergeTelegramInboundText(workspace.state, {
      channel: "telegram",
      externalEventId: "1002",
      externalConversationId: "-10042",
      externalMessageId: "89",
      sender: {
        externalId: "42",
        displayName: "Aina Zulkifli",
      },
      message: {
        kind: "text",
        text: "Voice note awaiting transcription.",
        language: "ms",
      },
      receivedAt: "2026-07-13T12:00:00.000Z",
    });
    expect(messageOnly.ok).toBe(true);
    if (!messageOnly.ok) {
      return;
    }
    await expect(
      workspaceRepository.save(
        "demo",
        workspace.revision,
        messageOnly.state,
      ),
    ).resolves.toMatchObject({ ok: true });

    const response = await postWebhook(baseUrl, voiceUpdate);
    const repaired = await workspaceRepository.load("demo");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      status: "processed",
    });
    expect(repaired?.state.speechArtifacts).toEqual([
      expect.objectContaining({
        messageId: "telegram-message:-10042:89",
        telegramFileId: "voice-1",
        status: "pending",
      }),
    ]);
  });

  it("acknowledges unsupported Telegram updates without creating an event", async () => {
    const { baseUrl, eventDataSource } = await configuredServer();

    const response = await postWebhook(baseUrl, {
      ...update,
      message: {
        ...update.message,
        text: undefined,
        document: { file_id: "document-1" },
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      status: "ignored",
    });
    expect(eventDataSource.records).toHaveLength(0);
  });
});
