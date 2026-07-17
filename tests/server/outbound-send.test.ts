import type { AddressInfo } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChannelAdapter } from "../../src/contracts/channel";
import { createCanonicalServerState, mergeTelegramInboundText } from "../../src/domain";
import { createJudgeApp } from "../../server/index";
import { TelegramAdapterError } from "../../server/telegram-adapter";
import {
  createTelegramOutboundService,
  type TelegramOutboundService,
} from "../../server/telegram-outbound-service";
import { createTelegramDeliveryRepository } from "../../server/telegram-repository";
import type { WorkspaceRepository } from "../../server/workspace-repository";
import { createWorkspaceRepository } from "../../server/workspace-repository";
import type { TtsProvider } from "../../server/openai-tts-provider";
import type { VoiceArtifactStore } from "../../server/voice-artifact-store";
import type { VoiceConverter } from "../../server/voice-converter";
import { InMemoryTelegramDeliveryDataSource } from "./fixtures/telegram-data-source";
import { InMemoryWorkspaceDataSource } from "./fixtures/workspace-data-source";

const servers: Array<ReturnType<ReturnType<typeof createJudgeApp>["listen"]>> =
  [];

const sendRequest = {
  requestId: "send-42",
  conversationId: "telegram-conversation:-10042",
  expectedConversationRevision: 1,
  targetLanguage: "Malay",
  approvedPatientText: "Klinik akan menghubungi anda.",
  mode: "text",
} as const;

async function telegramWorkspace() {
  const state = await createCanonicalServerState();
  const merged = mergeTelegramInboundText(state, {
    channel: "telegram",
    externalEventId: "1001",
    externalConversationId: "-10042",
    externalMessageId: "88",
    sender: {
      externalId: "42",
      displayName: "Aina Zulkifli",
    },
    message: {
      kind: "text",
      text: "Boleh saya buat temujanji?",
      language: "ms",
    },
    receivedAt: "2026-07-13T12:00:00.000Z",
  });
  if (!merged.ok) {
    throw new Error(merged.error);
  }
  return merged.state;
}

function fakeAdapter(
  sendText: ChannelAdapter["sendText"] = vi.fn(async () => ({
    providerMessageId: "9001",
    acceptedAt: "2026-07-13T12:01:00.000Z",
  })),
): ChannelAdapter {
  return {
    normalizeInbound: () => null,
    sendText,
    sendVoice: vi.fn(async () => ({
      providerMessageId: "9002",
      acceptedAt: "2026-07-13T12:01:00.000Z",
    })),
    sendDocument: vi.fn(async () => ({
      providerMessageId: "9003",
      acceptedAt: "2026-07-13T12:01:00.000Z",
    })),
  };
}

async function configuredOutbound(options?: {
  liveEnabled?: boolean;
  adapter?: ChannelAdapter;
  workspaceRepository?: WorkspaceRepository;
  maxCasAttempts?: number;
  voice?: {
    artifactStore: VoiceArtifactStore;
    converter: VoiceConverter;
    tts: TtsProvider;
  };
}) {
  const workspaceDataSource = new InMemoryWorkspaceDataSource();
  const defaultWorkspaceRepository = createWorkspaceRepository(
    workspaceDataSource,
  );
  await defaultWorkspaceRepository.bootstrap(
    "demo",
    await telegramWorkspace(),
  );
  const workspaceRepository =
    options?.workspaceRepository ?? defaultWorkspaceRepository;
  const deliveryDataSource = new InMemoryTelegramDeliveryDataSource();
  const deliveryRepository = createTelegramDeliveryRepository(
    deliveryDataSource,
  );
  const adapter = options?.adapter ?? fakeAdapter();
  const outbound = createTelegramOutboundService({
    adapter,
    deliveryRepository,
    liveEnabled: options?.liveEnabled ?? true,
    workspaceId: "demo",
    workspaceRepository,
    maxCasAttempts: options?.maxCasAttempts,
    voice: options?.voice,
  });
  return {
    adapter,
    defaultWorkspaceRepository,
    deliveryDataSource,
    deliveryRepository,
    outbound,
    workspaceRepository,
  };
}

async function start(
  outbound: TelegramOutboundService,
  workspaceRepository: WorkspaceRepository,
) {
  const app = createJudgeApp({
    workspace: {
      workspaceId: "demo",
      repository: workspaceRepository,
      createCanonicalState: createCanonicalServerState,
    },
    telegram: {
      webhookSecret: "webhook_secret-42",
      inbound: {
        process: async () => ({ ok: true, status: "ignored" }),
      },
      outbound,
    },
  });
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
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

function postSend(baseUrl: string, body: unknown = sendRequest) {
  return fetch(`${baseUrl}/api/outbound/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("visitor-approved Telegram text", () => {
  it("sends once, stores provider evidence, and appends only after acceptance", async () => {
    const configured = await configuredOutbound();
    const baseUrl = await start(
      configured.outbound,
      configured.workspaceRepository,
    );

    const response = await postSend(baseUrl);
    const workspace = await configured.workspaceRepository.load("demo");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deliveryIds: ["send-42"],
      status: "sent",
      text: {
        providerMessageId: "9001",
        acceptedAt: "2026-07-13T12:01:00.000Z",
      },
    });
    expect(configured.adapter.sendText).toHaveBeenCalledTimes(1);
    expect(
      await configured.deliveryRepository.read("send-42", "text"),
    ).toMatchObject({
      status: "sent",
      workspaceSyncStatus: "synced",
      approvedText: sendRequest.approvedPatientText,
      providerMessageId: "9001",
    });
    expect(
      workspace?.state.conversations
        .find(
          (conversation) =>
            conversation.id === sendRequest.conversationId,
        )
        ?.messages.at(-1),
    ).toMatchObject({
      id: "telegram-delivery:send-42:text",
      role: "staff",
      text: sendRequest.approvedPatientText,
      language: sendRequest.targetLanguage,
    });
  });

  it("returns the stored receipt without resending the same request ID", async () => {
    const configured = await configuredOutbound();
    const baseUrl = await start(
      configured.outbound,
      configured.workspaceRepository,
    );

    const first = await postSend(baseUrl);
    const duplicate = await postSend(baseUrl);

    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({
      status: "sent",
      text: { providerMessageId: "9001" },
    });
    expect(configured.adapter.sendText).toHaveBeenCalledTimes(1);
  });

  it("rejects a reused request ID with different approved text", async () => {
    const configured = await configuredOutbound();
    const baseUrl = await start(
      configured.outbound,
      configured.workspaceRepository,
    );
    expect((await postSend(baseUrl)).status).toBe(200);

    const duplicate = await postSend(baseUrl, {
      ...sendRequest,
      approvedPatientText: "Teks yang berbeza.",
    });

    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({
      code: "duplicate",
      retryable: false,
    });
    expect(configured.adapter.sendText).toHaveBeenCalledTimes(1);
  });

  it("allows only one provider call for concurrent duplicate clicks", async () => {
    let releaseProvider: (() => void) | undefined;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const sendText = vi.fn<ChannelAdapter["sendText"]>(async () => {
      await providerGate;
      return {
        providerMessageId: "9001",
        acceptedAt: "2026-07-13T12:01:00.000Z",
      };
    });
    const configured = await configuredOutbound({
      adapter: fakeAdapter(sendText),
    });
    const baseUrl = await start(
      configured.outbound,
      configured.workspaceRepository,
    );

    const first = postSend(baseUrl);
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1));
    const duplicate = await postSend(baseUrl);

    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({
      code: "duplicate",
      retryable: true,
    });
    expect(sendText).toHaveBeenCalledTimes(1);

    releaseProvider?.();
    expect((await first).status).toBe(200);
  });

  it("blocks stale and disabled sends before the provider call", async () => {
    const stale = await configuredOutbound();
    const staleBaseUrl = await start(
      stale.outbound,
      stale.workspaceRepository,
    );
    const staleResponse = await postSend(staleBaseUrl, {
      ...sendRequest,
      expectedConversationRevision: 2,
    });

    expect(staleResponse.status).toBe(409);
    await expect(staleResponse.json()).resolves.toMatchObject({
      code: "revision_conflict",
    });
    expect(stale.adapter.sendText).not.toHaveBeenCalled();

    const disabled = await configuredOutbound({ liveEnabled: false });
    const disabledBaseUrl = await start(
      disabled.outbound,
      disabled.workspaceRepository,
    );
    const disabledResponse = await postSend(disabledBaseUrl);

    expect(disabledResponse.status).toBe(503);
    await expect(disabledResponse.json()).resolves.toMatchObject({
      code: "feature_disabled",
    });
    expect(disabled.adapter.sendText).not.toHaveBeenCalled();
  });

  it("stores provider failure and retries the same request without duplication", async () => {
    const sendText = vi
      .fn<ChannelAdapter["sendText"]>()
      .mockRejectedValueOnce(new Error("provider detail"))
      .mockResolvedValueOnce({
        providerMessageId: "9002",
        acceptedAt: "2026-07-13T12:02:00.000Z",
      });
    const configured = await configuredOutbound({
      adapter: fakeAdapter(sendText),
    });
    const baseUrl = await start(
      configured.outbound,
      configured.workspaceRepository,
    );

    const failed = await postSend(baseUrl);
    expect(failed.status).toBe(200);
    await expect(failed.json()).resolves.toEqual({
      deliveryIds: ["send-42"],
      status: "failed",
      failedParts: ["text"],
    });
    expect(
      await configured.deliveryRepository.read("send-42", "text"),
    ).toMatchObject({
      status: "failed",
      error: { code: "provider_failed" },
    });

    const retried = await postSend(baseUrl);
    expect(retried.status).toBe(200);
    await expect(retried.json()).resolves.toMatchObject({
      status: "sent",
      text: { providerMessageId: "9002" },
    });
    expect(sendText).toHaveBeenCalledTimes(2);
  });

  it("stores provider timeouts without exposing provider internals", async () => {
    const sendText = vi.fn<ChannelAdapter["sendText"]>(async () => {
      throw new TelegramAdapterError(
        "provider_timeout",
        "Telegram request timed out.",
      );
    });
    const configured = await configuredOutbound({
      adapter: fakeAdapter(sendText),
    });
    const baseUrl = await start(
      configured.outbound,
      configured.workspaceRepository,
    );

    const response = await postSend(baseUrl);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deliveryIds: ["send-42"],
      status: "failed",
      failedParts: ["text"],
    });
    await expect(
      configured.deliveryRepository.read("send-42", "text"),
    ).resolves.toMatchObject({
      status: "failed",
      error: { code: "provider_timeout" },
    });
  });

  it("reconciles provider-accepted text without another Telegram call", async () => {
    const workspaceDataSource = new InMemoryWorkspaceDataSource();
    const realRepository = createWorkspaceRepository(workspaceDataSource);
    await realRepository.bootstrap("demo", await telegramWorkspace());
    let saveCalls = 0;
    const conflictOnce: WorkspaceRepository = {
      load: realRepository.load,
      bootstrap: realRepository.bootstrap,
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
    const configured = await configuredOutbound({
      workspaceRepository: conflictOnce,
      maxCasAttempts: 1,
    });
    const baseUrl = await start(
      configured.outbound,
      configured.workspaceRepository,
    );

    const sent = await configured.outbound.send(sendRequest);
    expect(sent.status).toBe("sent");
    expect(
      await configured.deliveryRepository.read("send-42", "text"),
    ).toMatchObject({
      status: "sent",
      workspaceSyncStatus: "pending",
    });

    const reconciled = await fetch(
      `${baseUrl}/api/outbound/deliveries/send-42/reconcile`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedConversationRevision: 1,
        }),
      },
    );
    expect(reconciled.status).toBe(200);
    await expect(reconciled.json()).resolves.toEqual({
      deliveryId: "send-42",
      workspaceSyncStatus: "synced",
      workspaceRevision: 2,
    });
    expect(configured.adapter.sendText).toHaveBeenCalledTimes(1);
  });

  it("returns invalid_request for an invalid reconcile delivery ID", async () => {
    const configured = await configuredOutbound();
    const baseUrl = await start(
      configured.outbound,
      configured.workspaceRepository,
    );

    const response = await fetch(
      `${baseUrl}/api/outbound/deliveries/${"x".repeat(129)}/reconcile`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedConversationRevision: 1 }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "invalid_request",
      retryable: false,
    });
  });

  it("prepares AI voice once and sends only the requested voice part", async () => {
    const artifacts = new Map<string, Uint8Array>();
    const directory = await mkdtemp(join(tmpdir(), "kaunter-outbound-test-"));
    const convertedPath = join(directory, "reply.ogg");
    const convertedBytes = new Uint8Array([79, 103, 103, 83, 4, 5, 6]);
    await writeFile(convertedPath, convertedBytes);
    const cleanup = vi.fn(() => rm(directory, { force: true, recursive: true }));
    const convertToOgg = vi.fn().mockResolvedValue({
      filePath: convertedPath,
      cleanup,
    });
    const synthesize = vi.fn().mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      model: "gpt-4o-mini-tts",
      voice: "coral",
    });
    const configured = await configuredOutbound({
      voice: {
        artifactStore: {
          async download(path) {
            return artifacts.get(path) ?? new Uint8Array();
          },
          async upload(path, bytes) {
            artifacts.set(path, bytes);
            return {
              objectPath: path,
              contentType: "audio/ogg",
              sha256: "a".repeat(64),
            };
          },
          async clearWorkspace() {},
        },
        converter: {
          convertToWebm: vi.fn(),
          convertToOgg,
        },
        tts: {
          synthesize,
        },
      },
    });
    const request = {
      ...sendRequest,
      mode: "voice" as const,
      voiceSource: "tts" as const,
    };

    await expect(
      configured.outbound.prepareVoice({
        requestId: request.requestId,
        conversationId: request.conversationId,
        expectedConversationRevision: request.expectedConversationRevision,
        targetLanguage: request.targetLanguage,
        approvedPatientText: request.approvedPatientText,
        source: "tts",
      }),
    ).resolves.toEqual({
      requestId: "send-42",
      source: "tts",
      status: "ready",
    });
    await expect(configured.outbound.send(request)).resolves.toMatchObject({
      status: "sent",
      voice: { providerMessageId: "9002" },
    });
    await expect(configured.outbound.send(request)).resolves.toMatchObject({
      status: "sent",
      voice: { providerMessageId: "9002" },
    });
    expect(configured.adapter.sendText).not.toHaveBeenCalled();
    expect(configured.adapter.sendVoice).toHaveBeenCalledTimes(1);
    expect(synthesize).toHaveBeenCalledWith(
      request.approvedPatientText,
      { targetLanguage: request.targetLanguage, signal: undefined },
    );
    expect(convertToOgg).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), undefined);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(configured.adapter.sendVoice).toHaveBeenCalledWith(
      "-10042",
      expect.objectContaining({ bytes: convertedBytes, contentType: "audio/ogg" }),
      "send-42",
    );
    expect(await configured.deliveryRepository.read("send-42", "voice")).toMatchObject({
      status: "sent",
      workspaceSyncStatus: "synced",
      voiceSource: "tts",
      ttsModel: "gpt-4o-mini-tts",
      ttsVoice: "coral",
    });
    expect(
      (await configured.workspaceRepository.load("demo"))?.state.conversations
        .find((conversation) => conversation.id === request.conversationId)
        ?.messages.at(-1),
    ).toMatchObject({
      id: "telegram-delivery:send-42:voice",
      role: "staff",
      outboundVoice: {
        deliveryId: "send-42",
        source: "tts",
        spokenTextHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
  });

  it("normalizes a legacy non-OGG artifact when the browser reads it", async () => {
    const artifacts = new Map<string, Uint8Array>();
    const convertedBytes = new Uint8Array([79, 103, 103, 83, 4, 5, 6]);
    const convertToOgg = vi.fn(async () => {
      const directory = await mkdtemp(join(tmpdir(), "kaunter-legacy-voice-test-"));
      const filePath = join(directory, "reply.ogg");
      await writeFile(filePath, convertedBytes);
      return {
        filePath,
        cleanup: () => rm(directory, { force: true, recursive: true }),
      };
    });
    const configured = await configuredOutbound({
      voice: {
        artifactStore: {
          async download(path) {
            return artifacts.get(path) ?? new Uint8Array();
          },
          async upload(path, bytes) {
            artifacts.set(path, bytes);
            return {
              objectPath: path,
              contentType: "audio/ogg",
              sha256: "c".repeat(64),
            };
          },
          async clearWorkspace() {},
        },
        converter: {
          convertToWebm: vi.fn(),
          convertToOgg,
        },
        tts: {
          synthesize: vi.fn().mockResolvedValue({
            bytes: new Uint8Array([1, 2, 3]),
            model: "legacy-tts",
            voice: "legacy-voice",
          }),
        },
      },
    });
    await configured.outbound.prepareVoice({
      requestId: "send-42",
      conversationId: sendRequest.conversationId,
      expectedConversationRevision: sendRequest.expectedConversationRevision,
      targetLanguage: sendRequest.targetLanguage,
      approvedPatientText: sendRequest.approvedPatientText,
      source: "tts",
    });
    const artifactPath = [...artifacts.keys()][0]!;
    artifacts.set(artifactPath, new Uint8Array([73, 68, 51, 4, 5, 6]));

    await expect(configured.outbound.readVoiceAudio("send-42")).resolves.toEqual(
      convertedBytes,
    );
    await expect(
      configured.outbound.send({
        ...sendRequest,
        mode: "voice",
        voiceSource: "tts",
      }),
    ).resolves.toMatchObject({ status: "sent" });
    expect(configured.adapter.sendVoice).toHaveBeenCalledWith(
      "-10042",
      expect.objectContaining({ bytes: convertedBytes }),
      "send-42",
    );
    expect(convertToOgg).toHaveBeenCalledTimes(3);
  });

  it("retries a partial text and voice delivery without resending accepted text", async () => {
    const artifacts = new Map<string, Uint8Array>();
    const directory = await mkdtemp(join(tmpdir(), "kaunter-outbound-retry-test-"));
    const convertedPath = join(directory, "reply.ogg");
    await writeFile(convertedPath, new Uint8Array([79, 103, 103, 83, 4, 5, 6]));
    const adapter = fakeAdapter();
    adapter.sendVoice = vi
      .fn<ChannelAdapter["sendVoice"]>()
      .mockRejectedValueOnce(
        new TelegramAdapterError("provider_failed", "Telegram voice failed."),
      )
      .mockResolvedValueOnce({
        providerMessageId: "9003",
        acceptedAt: "2026-07-13T12:02:00.000Z",
      });
    const configured = await configuredOutbound({
      adapter,
      voice: {
        artifactStore: {
          async download(path) {
            return artifacts.get(path) ?? new Uint8Array();
          },
          async upload(path, bytes) {
            artifacts.set(path, bytes);
            return {
              objectPath: path,
              contentType: "audio/ogg",
              sha256: "b".repeat(64),
            };
          },
          async clearWorkspace() {},
        },
        converter: {
          convertToWebm: vi.fn(),
          convertToOgg: vi.fn().mockResolvedValue({
            filePath: convertedPath,
            cleanup: () => rm(directory, { force: true, recursive: true }),
          }),
        },
        tts: {
          synthesize: vi.fn().mockResolvedValue({
            bytes: new Uint8Array([4, 5, 6]),
            model: "gpt-4o-mini-tts",
            voice: "coral",
          }),
        },
      },
    });
    const request = {
      ...sendRequest,
      mode: "both" as const,
      voiceSource: "tts" as const,
    };

    await configured.outbound.prepareVoice({
      requestId: request.requestId,
      conversationId: request.conversationId,
      expectedConversationRevision: request.expectedConversationRevision,
      targetLanguage: request.targetLanguage,
      approvedPatientText: request.approvedPatientText,
      source: "tts",
    });

    await expect(configured.outbound.send(request)).resolves.toMatchObject({
      status: "partial_failure",
      failedParts: ["voice"],
      text: { providerMessageId: "9001" },
    });
    await expect(configured.outbound.send(request)).resolves.toMatchObject({
      status: "sent",
      text: { providerMessageId: "9001" },
      voice: { providerMessageId: "9003" },
    });

    expect(adapter.sendText).toHaveBeenCalledTimes(1);
    expect(adapter.sendVoice).toHaveBeenCalledTimes(2);
  });
});
