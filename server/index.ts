import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { createServer as createViteServer } from "vite";
import { ZodError } from "zod";

import {
  agentRunCreateRequestSchema,
  agentRunResultSchema,
  type AgentRunRequest,
  type AgentRunResult,
} from "../src/contracts/agent";
import type { ServerDomainStatePayload } from "../src/contracts/app-state";
import {
  workspaceCommandRequestSchema,
  workspaceCommandResultSchema,
} from "../src/contracts/workflow";
import {
  evalCaseRunRequestSchema,
  evalCaseRunResultSchema,
  evalSuiteCreateRequestSchema,
  evalSuiteCreateResultSchema,
} from "../src/contracts/eval";
import {
  createCanonicalServerState,
  mergeSyntheticReset,
  telegramInboundMessageId,
} from "../src/domain";
import { AGENT_PROMPT_VERSION } from "./agent-prompt";
import {
  AgentProviderError,
  createAgentConfigVersion,
  createAgentProviderAdapter,
  readAgentProviderConfig,
  readJudgeProviderConfig,
  type AgentProviderConfig,
} from "./agent-provider";
import { AgentServiceError, createAgentService } from "./agent-service";
import {
  autonomousBookingTools,
  createAutonomousBookingToolExecutor,
} from "./autonomous-booking-tools";
import {
  AgentWorkspaceError,
  buildLiveAgentRunRequest,
} from "./agent-workspace";
import {
  createEvalService,
  EvalServiceError,
  type EvalService,
} from "./eval-service";
import {
  createWorkspaceCommandService,
  WorkspaceCommandServiceError,
  type WorkspaceCommandService,
} from "./workspace-command-service";
import { createCorrectionProposer } from "./correction-proposer";
import type { ApiError } from "./api-contract";
import {
  apiErrorSchema,
  manualSpeechTranscriptRequestSchema,
  calendarDispatchRequestSchema,
  outboundReconcileRequestSchema,
  outboundSendRequestSchema,
  outboundVoicePrepareRequestSchema,
  resetDemoRequestSchema,
  saveWorkspaceRequestSchema,
  saveWorkspaceResultSchema,
  translationRequestSchema,
} from "./api-contract";
import type { JudgeRequest, JudgeResponse } from "./judge-contract";
import { judgeRequestSchema, judgeResponseSchema } from "./judge-contract";
import { createJudgeProviderAdapter } from "./judge-provider";
import { createJudgeService } from "./judge-service";
import { JUDGE_PROMPT_VERSION } from "./judge-prompt";
import {
  createSupabaseServerClient,
  createSupabaseCalendarDeliveryDataSource,
  createSupabaseTelegramDeliveryDataSource,
  createSupabaseTelegramEventDataSource,
  createSupabaseWorkspaceDataSource,
  readSupabaseConfig,
} from "./supabase";
import {
  createSupabaseVoiceArtifactStore,
  VoiceArtifactStoreError,
} from "./voice-artifact-store";
import {
  createTelegramAdapter,
  readTelegramConfig,
} from "./telegram-adapter";
import type { NormalizedInboundEvent } from "../src/contracts/channel";
import {
  createInboundSpeechService,
  InboundSpeechServiceError,
  type InboundSpeechService,
} from "./inbound-speech-service";
import {
  createOpenAiSpeechProvider,
  type SpeechProvider,
} from "./openai-speech-provider";
import {
  createOpenAiTtsProvider,
  TtsProviderError,
  type TtsProvider,
} from "./openai-tts-provider";
import {
  createElevenLabsSpeechProvider,
  createElevenLabsTtsProvider,
  readElevenLabsSpeechConfig,
  readElevenLabsTtsConfig,
  readVoiceProviderSelection,
} from "./elevenlabs-voice-provider";
import {
  createTranslationService,
  type TranslationService,
} from "./translation-service";
import { createVoiceConverter } from "./voice-converter";
import { log, requestLogging } from "./structured-log";
import {
  createTelegramInboundService,
  TelegramInboundError,
  type TelegramInboundService,
} from "./telegram-inbound-service";
import {
  createTelegramDeliveryRepository,
  createTelegramEventRepository,
} from "./telegram-repository";
import {
  createTelegramOutboundService,
  TelegramOutboundError,
  type TelegramOutboundService,
} from "./telegram-outbound-service";
import {
  CalendarDispatchError,
  createCalendarDispatchService,
  type CalendarDispatchService,
} from "./calendar-dispatch-service";
import { readCalendarDispatchConfig } from "./calendar-config";
import { createCalendarDeliveryRepository } from "./calendar-repository";
import {
  createWorkspaceRepository,
  WorkspaceRepositoryError,
  type WorkspaceRepository,
} from "./workspace-repository";

if (process.env.NODE_ENV !== "test") {
  try {
    process.loadEnvFile();
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
}

type Judge = (request: JudgeRequest, signal?: AbortSignal) => Promise<JudgeResponse>;

type AgentRunner = {
  agentConfigVersion: string;
  apiMode?: "responses" | "chat_completions";
  liveEnabled?: boolean;
  modelId?: string;
  run(
    request: AgentRunRequest,
    signal?: AbortSignal,
  ): Promise<AgentRunResult>;
};

type RateLimitOptions = {
  requests: number;
  windowMs: number;
};

type JudgeAppOptions = {
  agent?: AgentRunner | null;
  agentTimeoutMs?: number;
  eval?: EvalService | null;
  workflow?: WorkspaceCommandService | null;
  judge?: Judge;
  rateLimit?: RateLimitOptions;
  requestTimeoutMs?: number;
  now?: () => number;
  workspace?: WorkspaceAppOptions | null;
  telegram?: TelegramAppOptions | null;
  translation?: TranslationService | null;
};

type WorkspaceAppOptions = {
  workspaceId: string;
  repository: WorkspaceRepository;
  createCanonicalState: () => Promise<ServerDomainStatePayload>;
};

type TelegramAppOptions = {
  autoReplyEnabled?: boolean;
  webhookSecret: string;
  liveEnabled?: boolean;
  inbound: TelegramInboundService;
  normalizeInbound?: (payload: unknown) => NormalizedInboundEvent | null;
  outbound?: TelegramOutboundService;
  calendar?: CalendarDispatchService;
  speech?: InboundSpeechService;
};

class JudgeConfigurationError extends Error {}

function sendApiError(
  response: Response,
  status: number,
  error: ApiError,
): void {
  const body = apiErrorSchema.parse(error);
  response.status(status).json(body);
}

function configuredWorkspace(): WorkspaceAppOptions | null {
  const variables = [
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.KAUNTER_WORKSPACE_ID,
  ];
  if (variables.every((value) => value === undefined)) {
    return null;
  }
  let config: ReturnType<typeof readSupabaseConfig>;
  try {
    config = readSupabaseConfig();
  } catch {
    return null;
  }
  const client = createSupabaseServerClient(config);
  return {
    workspaceId: config.workspaceId,
    repository: createWorkspaceRepository(
      createSupabaseWorkspaceDataSource(client),
    ),
    createCanonicalState: createCanonicalServerState,
  };
}

function configuredAgent(workspace: WorkspaceAppOptions | null): AgentRunner | null {
  if (!process.env.LLM_API_KEY) {
    return null;
  }
  const config = readAgentProviderConfig();
  const createResponse = createAgentProviderAdapter(config);
  return {
    agentConfigVersion: createAgentConfigVersion(config),
    apiMode: config.apiMode,
    liveEnabled: config.liveEnabled,
    modelId: config.model,
    run: createAgentService({
      createResponse,
      ...(workspace
        ? {
            toolExecutor: createAutonomousBookingToolExecutor({
              workspaceId: workspace.workspaceId,
              workspaceRepository: workspace.repository,
            }),
            tools: autonomousBookingTools,
          }
        : {}),
      liveEnabled: config.liveEnabled,
      model: config.model,
    }),
  };
}

type ConfiguredVoiceProviders = {
  speech: SpeechProvider;
  speechModel: string;
  tts: TtsProvider;
};

function configuredVoiceProviders(
  agentConfig: AgentProviderConfig,
): ConfiguredVoiceProviders {
  const selection = readVoiceProviderSelection();
  const speechConfig =
    selection.speechProvider === "elevenlabs"
      ? readElevenLabsSpeechConfig()
      : null;
  const ttsConfig =
    selection.ttsProvider === "elevenlabs" ? readElevenLabsTtsConfig() : null;
  return {
    speech: speechConfig
      ? createElevenLabsSpeechProvider({
          config: speechConfig,
          translation: createTranslationService(agentConfig),
        })
      : createOpenAiSpeechProvider(agentConfig),
    speechModel: speechConfig?.model ?? "whisper-1",
    tts: ttsConfig
      ? createElevenLabsTtsProvider({ config: ttsConfig })
      : createOpenAiTtsProvider(agentConfig),
  };
}

function configuredTelegram(
  workspace: WorkspaceAppOptions | null,
  agent: AgentRunner | null,
): TelegramAppOptions | null {
  if (!workspace) {
    return null;
  }
  const variables = [
    process.env.TELEGRAM_BOT_TOKEN,
    process.env.TELEGRAM_WEBHOOK_SECRET,
    process.env.LIVE_TELEGRAM_ENABLED,
  ];
  if (variables.every((value) => value === undefined)) {
    return null;
  }
  try {
    const telegram = readTelegramConfig();
    const supabase = readSupabaseConfig();
    const client = createSupabaseServerClient(supabase);
    const adapter = createTelegramAdapter({ botToken: telegram.botToken });
    const calendar = createCalendarDispatchService({
      adapter,
      config: readCalendarDispatchConfig(),
      deliveryRepository: createCalendarDeliveryRepository(
        createSupabaseCalendarDeliveryDataSource(client),
      ),
      workspaceId: workspace.workspaceId,
      workspaceRepository: workspace.repository,
    });
    const agentConfig = process.env.LLM_API_KEY
      ? readAgentProviderConfig()
      : null;
    const voiceProviders = agentConfig
      ? configuredVoiceProviders(agentConfig)
      : null;
    const speech = agentConfig
      ? createInboundSpeechService({
          workspaceId: workspace.workspaceId,
          workspaceRepository: workspace.repository,
          voiceDownloader: adapter,
          converter: createVoiceConverter(),
          speechProvider: voiceProviders!.speech,
          speechProviderModel: voiceProviders!.speechModel,
        })
      : undefined;
    return {
      webhookSecret: telegram.webhookSecret,
      autoReplyEnabled: telegram.liveEnabled && Boolean(agent?.liveEnabled),
      liveEnabled: telegram.liveEnabled,
      inbound: createTelegramInboundService({
        adapter,
        eventRepository: createTelegramEventRepository(
          createSupabaseTelegramEventDataSource(client),
        ),
        workspaceId: workspace.workspaceId,
        workspaceRepository: workspace.repository,
      }),
      normalizeInbound: adapter.normalizeInbound,
      outbound: createTelegramOutboundService({
        adapter,
        deliveryRepository: createTelegramDeliveryRepository(
          createSupabaseTelegramDeliveryDataSource(client),
        ),
        liveEnabled: telegram.liveEnabled,
        workspaceId: workspace.workspaceId,
        workspaceRepository: workspace.repository,
        voice: voiceProviders
          ? {
              artifactStore: createSupabaseVoiceArtifactStore(client),
              converter: createVoiceConverter(),
              tts: voiceProviders.tts,
            }
          : undefined,
      }),
      calendar,
      speech,
    };
  } catch (error) {
    log.error("telegram_configuration_failed", errorLogFields(error));
    return null;
  }
}

function errorLogFields(error: unknown): Record<string, string | undefined> {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : undefined;
  return {
    errorCode: code,
    errorMessage: error instanceof Error ? error.message : "Unknown error",
    errorType: error instanceof Error ? error.name : typeof error,
  };
}

function automaticReplyRequestId(event: NormalizedInboundEvent): string {
  const identity = `${event.externalEventId}:${event.externalMessageId}`;
  return `agent-auto-${createHash("sha256").update(identity).digest("hex").slice(0, 48)}`;
}

function autonomousActionRevision(
  result: AgentRunResult,
): { calendar: boolean; conversationRevision: number } | null {
  const mutation = [...result.toolCalls]
    .reverse()
    .find(
      (call) =>
        call.status === "completed" &&
        call.conversationRevision !== null &&
        call.name !== "list_available_slots",
    );
  if (!mutation || mutation.conversationRevision === null) {
    return null;
  }
  return {
    calendar:
      mutation.name === "create_booking" || mutation.name === "reschedule_booking",
    conversationRevision: mutation.conversationRevision,
  };
}

async function runTelegramAutoReply(input: {
  agent: AgentRunner | null;
  agentTimeoutMs: number;
  event: NormalizedInboundEvent;
  telegram: TelegramAppOptions;
  webhookRequestId?: string;
  workspace: WorkspaceAppOptions | null;
}): Promise<void> {
  const { agent, agentTimeoutMs, event, telegram, webhookRequestId, workspace } = input;
  const logContext = {
    externalEventId: event.externalEventId,
    externalMessageId: event.externalMessageId,
    messageKind: event.message.kind,
    webhookRequestId,
  };
  if (!telegram.autoReplyEnabled || !agent || !telegram.outbound || !workspace) {
    log.info("telegram_auto_reply_skipped", {
      ...logContext,
      reason: !telegram.autoReplyEnabled
        ? "disabled"
        : !agent
          ? "agent_unconfigured"
          : !telegram.outbound
            ? "outbound_unconfigured"
            : "workspace_unconfigured",
    });
    return;
  }
  try {
    const loaded = await workspace.repository.load(workspace.workspaceId);
    const conversation = loaded?.state.conversations.find(
      (candidate) =>
        candidate.channel === "telegram" &&
        candidate.source === "telegram" &&
        candidate.externalConversationId === event.externalConversationId,
    );
    if (!loaded || !conversation) {
      log.error("telegram_auto_reply_failed", {
        ...logContext,
        reason: "conversation_not_persisted",
        workspaceId: workspace.workspaceId,
      });
      return;
    }
    if (conversation.workflowStatus === "resolved" || conversation.agentMode !== "live_agent") {
      log.info("telegram_auto_reply_skipped", {
        ...logContext,
        conversationId: conversation.id,
        reason:
          conversation.workflowStatus === "resolved"
            ? "conversation_resolved"
            : "agent_mode_disabled",
      });
      return;
    }
    if (event.message.kind === "voice") {
      const artifact = loaded.state.speechArtifacts.find(
        (candidate) => candidate.messageId === telegramInboundMessageId(event),
      );
      if (!artifact || artifact.status !== "ready") {
        log.info("telegram_auto_reply_skipped", {
          ...logContext,
          conversationId: conversation.id,
          reason: "voice_transcript_not_ready",
        });
        return;
      }
    }

    const startedAt = performance.now();
    log.info("telegram_auto_reply_started", {
      ...logContext,
      conversationId: conversation.id,
      conversationRevision: conversation.revision,
      workspaceId: workspace.workspaceId,
    });
    const result = await agent.run(
      buildLiveAgentRunRequest(
        loaded.state,
        {
          conversationId: conversation.id,
          expectedConversationRevision: conversation.revision,
        },
        agent.agentConfigVersion,
      ),
      AbortSignal.timeout(agentTimeoutMs),
    );
    log.info("telegram_auto_reply_agent_completed", {
      ...logContext,
      conversationId: conversation.id,
      latencyMs: Math.round(performance.now() - startedAt),
      proposedAction: result.proposedAction,
      runId: result.runId,
      totalTokens: result.usage.totalTokens,
    });
    if (result.proposedAction === "staff_handoff") {
      log.info("telegram_auto_reply_handoff", {
        ...logContext,
        conversationId: conversation.id,
        runId: result.runId,
      });
    }

    const autonomousAction = autonomousActionRevision(result);
    let expectedConversationRevision =
      autonomousAction?.conversationRevision ?? conversation.revision;
    if (autonomousAction?.calendar && telegram.calendar) {
      try {
        const calendar = await telegram.calendar.send({
          conversationId: conversation.id,
          expectedConversationRevision,
        });
        expectedConversationRevision = calendar.conversationRevision;
        log.info("telegram_auto_reply_calendar_sent", {
          ...logContext,
          conversationId: conversation.id,
          requestId: calendar.requestId,
          runId: result.runId,
        });
      } catch (error) {
        log.error("telegram_auto_reply_calendar_failed", {
          ...logContext,
          conversationId: conversation.id,
          runId: result.runId,
          ...errorLogFields(error),
        });
      }
    }

    const requestId = automaticReplyRequestId(event);
    let mode: "text" | "both" = "text";
    if (event.message.kind === "voice") {
      try {
        await telegram.outbound.prepareVoice({
          requestId,
          conversationId: conversation.id,
          expectedConversationRevision,
          targetLanguage: result.draft.patientLanguage,
          approvedPatientText: result.draft.patientText,
          source: "tts",
        });
        mode = "both";
      } catch (error) {
        log.error("telegram_auto_reply_voice_prepare_failed", {
          ...logContext,
          conversationId: conversation.id,
          requestId,
          runId: result.runId,
          ...errorLogFields(error),
        });
      }
    }

    const delivery = await telegram.outbound.send({
      requestId,
      conversationId: conversation.id,
      expectedConversationRevision,
      targetLanguage: result.draft.patientLanguage,
      approvedPatientText: result.draft.patientText,
      mode,
      ...(mode === "both" ? { voiceSource: "tts" as const } : {}),
    });
    if (delivery.status === "sent") {
      log.info("telegram_auto_reply_sent", {
        ...logContext,
        conversationId: conversation.id,
        providerMessageId: delivery.text?.providerMessageId,
        voiceProviderMessageId: delivery.voice?.providerMessageId,
        mode,
        requestId,
        runId: result.runId,
      });
      return;
    }
    log.error("telegram_auto_reply_delivery_failed", {
      ...logContext,
      conversationId: conversation.id,
      failedParts: delivery.failedParts.join(","),
      requestId,
      runId: result.runId,
    });
  } catch (error) {
    log.error("telegram_auto_reply_failed", {
      ...logContext,
      workspaceId: workspace.workspaceId,
      ...errorLogFields(error),
    });
  }
}

async function runTelegramVoiceAutoReply(input: {
  agent: AgentRunner | null;
  agentTimeoutMs: number;
  event: NormalizedInboundEvent;
  telegram: TelegramAppOptions;
  webhookRequestId?: string;
  workspace: WorkspaceAppOptions | null;
}): Promise<void> {
  const { event, telegram, webhookRequestId } = input;
  if (event.message.kind !== "voice") {
    return;
  }
  if (!telegram.speech) {
    log.info("telegram_voice_auto_reply_skipped", {
      externalEventId: event.externalEventId,
      externalMessageId: event.externalMessageId,
      webhookRequestId,
      reason: "speech_unconfigured",
    });
    return;
  }

  const messageId = telegramInboundMessageId(event);
  try {
    const speech = await telegram.speech.retry(messageId);
    log.info("telegram_speech_auto_transcription", {
      externalEventId: event.externalEventId,
      messageId,
      status: speech.status,
      webhookRequestId,
    });
    if (speech.status === "ready") {
      await runTelegramAutoReply(input);
    }
  } catch (error) {
    log.error("telegram_speech_auto_transcription_failed", {
      externalEventId: event.externalEventId,
      messageId,
      webhookRequestId,
      ...errorLogFields(error),
    });
  }
}

function secretsMatch(received: unknown, expected: string): boolean {
  if (typeof received !== "string") {
    return false;
  }
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function sendTelegramOutboundFailure(
  response: Response,
  error: unknown,
): void {
  log.error("telegram_outbound_failure", {
    errorCode:
      error instanceof TelegramOutboundError || error instanceof TtsProviderError
        ? error.code
        : "provider_failed",
    errorType: error instanceof Error ? error.name : "unknown",
  });
  if (error instanceof TelegramOutboundError) {
    const status =
      error.code === "invalid_request"
        ? 400
        : error.code === "not_found"
          ? 404
          : error.code === "revision_conflict" ||
              error.code === "duplicate"
            ? 409
            : 503;
    sendApiError(response, status, {
      code: error.code,
      error: error.message,
      retryable: error.retryable,
    });
    return;
  }
  sendApiError(response, 503, {
    code: "provider_failed",
    error: "Telegram delivery failed.",
    retryable: true,
  });
}

function sendCalendarDispatchFailure(response: Response, error: unknown): void {
  if (error instanceof CalendarDispatchError) {
    const status =
      error.code === "invalid_request"
        ? 400
        : error.code === "not_found"
          ? 404
          : error.code === "revision_conflict" || error.code === "duplicate"
            ? 409
            : error.code === "provider_timeout"
              ? 504
              : 503;
    sendApiError(response, status, {
      code: error.code,
      error: error.message,
      retryable: error.retryable,
    });
    return;
  }
  sendApiError(response, 503, {
    code: "provider_failed",
    error: "Calendar delivery failed.",
    retryable: true,
  });
}

function requireWorkspace(
  workspace: WorkspaceAppOptions | null,
  response: Response,
): workspace is WorkspaceAppOptions {
  if (workspace) {
    return true;
  }
  sendApiError(response, 503, {
    code: "feature_disabled",
    error: "Workspace persistence is not configured.",
    retryable: false,
  });
  return false;
}

function sendWorkspaceFailure(response: Response, error: unknown): void {
  if (error instanceof WorkspaceRepositoryError) {
    if (error.code === "not_found") {
      sendApiError(response, 404, {
        code: "not_found",
        error: "Workspace not found.",
        retryable: false,
      });
      return;
    }
    if (error.code === "invalid_input") {
      sendApiError(response, 400, {
        code: "invalid_request",
        error: "Workspace request is invalid.",
        retryable: false,
      });
      return;
    }
  }
  sendApiError(response, 503, {
    code: "provider_failed",
    error: "Workspace persistence failed.",
    retryable: true,
  });
}

function sendAgentFailure(response: Response, error: unknown): void {
  if (error instanceof AgentWorkspaceError) {
    const status =
      error.code === "not_found"
        ? 404
        : error.code === "revision_conflict"
          ? 409
          : error.code === "invalid_request"
            ? 400
            : 503;
    sendApiError(response, status, {
      code: error.code,
      error: error.message,
      retryable: error.retryable,
    });
    return;
  }
  if (error instanceof AgentServiceError) {
    sendApiError(
      response,
      error.code === "feature_disabled" ? 503 : 502,
      {
        code: error.code,
        error: error.message,
        retryable: error.retryable,
      },
    );
    return;
  }
  if (error instanceof AgentProviderError) {
    sendApiError(
      response,
      error.code === "provider_timeout" ? 504 : 502,
      {
        code: error.code,
        error: error.message,
        retryable: error.retryable,
      },
    );
    return;
  }
  if (error instanceof WorkspaceRepositoryError) {
    sendWorkspaceFailure(response, error);
    return;
  }
  sendApiError(response, 502, {
    code: "provider_failed",
    error: "The model provider did not return an agent result.",
    retryable: true,
  });
}

function sendEvalFailure(response: Response, error: unknown): void {
  if (error instanceof EvalServiceError) {
    const status =
      error.code === "invalid_request"
        ? 400
        : error.code === "not_found"
          ? 404
          : error.code === "revision_conflict"
            ? 409
            : 502;
    sendApiError(response, status, {
      code: error.code,
      error: error.message,
      retryable: error.retryable,
    });
    return;
  }
  if (error instanceof JudgeConfigurationError) {
    sendApiError(response, 503, {
      code: "feature_disabled",
      error: "The live LLM judge is not configured on this server.",
      retryable: false,
    });
    return;
  }
  if (
    error instanceof AgentServiceError ||
    error instanceof AgentProviderError ||
    error instanceof WorkspaceRepositoryError
  ) {
    sendAgentFailure(response, error);
    return;
  }
  if (error instanceof ZodError) {
    sendApiError(response, 502, {
      code: "provider_failed",
      error: "Eval evidence failed validation.",
      retryable: true,
    });
    return;
  }
  sendApiError(response, 502, {
    code: "provider_failed",
    error: "Eval execution failed.",
    retryable: true,
  });
}

function sendInboundSpeechFailure(response: Response, error: unknown): void {
  if (error instanceof InboundSpeechServiceError) {
    const status =
      error.code === "not_found"
        ? 404
        : error.code === "revision_conflict"
          ? 409
          : 503;
    sendApiError(response, status, {
      code: error.code,
      error: error.message,
      retryable: error.code !== "not_found",
    });
    return;
  }
  if (error instanceof TtsProviderError) {
    sendApiError(response, error.code === "provider_timeout" ? 504 : 502, {
      code: error.code,
      error: error.message,
      retryable: true,
    });
    return;
  }
  if (error instanceof VoiceArtifactStoreError) {
    sendApiError(response, 502, {
      code: "provider_failed",
      error: "Voice artifact storage failed.",
      retryable: true,
    });
    return;
  }
  sendApiError(response, 503, {
    code: "provider_failed",
    error: "Speech processing failed.",
    retryable: true,
  });
}

function configuredTranslation(): TranslationService | null {
  if (!process.env.LLM_API_KEY) {
    return null;
  }
  try {
    return createTranslationService(readAgentProviderConfig());
  } catch {
    return null;
  }
}

function sendWorkspaceCommandFailure(response: Response, error: unknown): void {
  if (error instanceof WorkspaceCommandServiceError) {
    const status =
      error.code === "feature_disabled"
        ? 503
        : error.code === "invalid_request"
        ? 400
        : error.code === "not_found"
          ? 404
          : error.code === "revision_conflict"
            ? 409
            : 422;
    sendApiError(response, status, {
      code: error.code,
      error: error.message,
      retryable: error.retryable,
    });
    return;
  }
  sendEvalFailure(response, error);
}

function configuredJudgeModel(): string {
  if (!process.env.LLM_API_KEY) {
    return "gpt-5.5";
  }
  return readJudgeProviderConfig().model;
}

function configuredJudge(): Judge {
  if (!process.env.LLM_API_KEY) {
    return async () => {
      throw new JudgeConfigurationError("LLM provider is not configured");
    };
  }
  const config = readJudgeProviderConfig();
  return createJudgeService({
    model: config.model,
    createResponse: createJudgeProviderAdapter(config),
  });
}

function configuredEval(
  workspace: WorkspaceAppOptions | null,
  agent: AgentRunner | null,
  judge: Judge,
  now: () => number,
): EvalService | null {
  if (!workspace || !agent?.apiMode || !agent.modelId) {
    return null;
  }
  return createEvalService({
    workspaceId: workspace.workspaceId,
    repository: workspace.repository,
    agent: {
      config: {
        modelId: agent.modelId,
        apiMode: agent.apiMode,
        agentConfigVersion: agent.agentConfigVersion,
        promptVersion: AGENT_PROMPT_VERSION,
        toolPolicyVersion: "demo-no-tools-v1",
      },
      run: agent.run,
    },
    judge: {
      config: {
        modelId: configuredJudgeModel(),
        promptVersion: JUDGE_PROMPT_VERSION,
      },
      run: judge,
    },
    createSuiteId: randomUUID,
    createEvalRunId: randomUUID,
    now: () => new Date(now()).toISOString(),
  });
}

function configuredWorkspaceCommands(
  workspace: WorkspaceAppOptions | null,
  evalService: EvalService | null,
): WorkspaceCommandService | null {
  if (!workspace || !evalService) {
    return null;
  }
  return createWorkspaceCommandService({
    workspaceId: workspace.workspaceId,
    repository: workspace.repository,
    evalService,
    createId: randomUUID,
    now: () => new Date().toISOString(),
    proposer: process.env.LLM_API_KEY
      ? createCorrectionProposer(readAgentProviderConfig())
      : null,
  });
}

function rateLimiter(
  { requests, windowMs }: RateLimitOptions,
  now: () => number,
) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (request: Request, response: Response, next: NextFunction) => {
    const key = request.ip || request.socket.remoteAddress || "unknown";
    const currentTime = now();
    const current = buckets.get(key);
    if (!current || current.resetAt <= currentTime) {
      buckets.set(key, { count: 1, resetAt: currentTime + windowMs });
      next();
      return;
    }
    if (current.count >= requests) {
      sendApiError(response, 429, {
        code: "provider_failed",
        error: "Request limit reached. Try again after the window resets.",
        retryable: true,
      });
      return;
    }
    current.count += 1;
    next();
  };
}

export function createJudgeApp(options: JudgeAppOptions = {}) {
  const {
    agentTimeoutMs = 45_000,
    judge = configuredJudge(),
    rateLimit = { requests: 20, windowMs: 60_000 },
    requestTimeoutMs = 30_000,
    now = Date.now,
  } = options;
  const workspace = options.workspace ?? configuredWorkspace();
  const agent = options.agent === undefined ? configuredAgent(workspace) : options.agent;
  const telegram =
    options.telegram === undefined
      ? configuredTelegram(workspace, agent)
      : options.telegram;
  const translation =
    options.translation === undefined
      ? configuredTranslation()
      : options.translation;
  const evalService =
    options.eval === undefined
      ? configuredEval(workspace, agent, judge, now)
      : options.eval;
  const workflow =
    options.workflow === undefined
      ? configuredWorkspaceCommands(workspace, evalService)
      : options.workflow;
  const app = express();
  app.disable("x-powered-by");
  app.use(requestLogging);
  app.use(express.json({ limit: "64kb" }));
  app.get("/healthz", (_request: Request, response: Response) => {
    response.status(200).json({
      ok: true,
      configured: {
        telegram: Boolean(telegram),
        telegramAutoReply: telegram?.autoReplyEnabled ?? false,
        telegramCalendar: Boolean(telegram?.calendar),
        telegramLiveDelivery: telegram?.liveEnabled ?? false,
        telegramSpeech: Boolean(telegram?.speech),
        translation: Boolean(translation),
        workspace: Boolean(workspace),
      },
    });
  });
  app.get("/readyz", async (_request: Request, response: Response) => {
    if (!workspace) {
      sendApiError(response, 503, {
        code: "feature_disabled",
        error: "Workspace storage is not configured.",
        retryable: false,
      });
      return;
    }
    try {
      const loaded = await workspace.repository.load(workspace.workspaceId);
      if (!loaded) {
        sendApiError(response, 503, {
          code: "not_found",
          error: "Workspace is not ready.",
          retryable: true,
        });
        return;
      }
      response.status(200).json({ ok: true, workspaceRevision: loaded.revision });
    } catch {
      sendApiError(response, 503, {
        code: "provider_failed",
        error: "Workspace readiness check failed.",
        retryable: true,
      });
    }
  });
  app.post(
    "/api/telegram/webhook",
    async (request: Request, response: Response) => {
      if (!telegram) {
        sendApiError(response, 503, {
          code: "feature_disabled",
          error: "Telegram inbound is not configured.",
          retryable: false,
        });
        return;
      }
      if (
        !secretsMatch(
          request.headers["x-telegram-bot-api-secret-token"],
          telegram.webhookSecret,
        )
      ) {
        sendApiError(response, 401, {
          code: "invalid_request",
          error: "Telegram webhook secret is invalid.",
          retryable: false,
        });
        return;
      }
      try {
        const event = telegram.normalizeInbound?.(request.body) ?? null;
        const result = await telegram.inbound.process(request.body);
        response.status(200).json(result);
        log.info("telegram_webhook_processed", {
          externalEventId: event?.externalEventId,
          messageKind: event?.message.kind,
          status: result.status,
        });
        if (result.status === "processed" && event) {
          const webhookRequestHeader = response.getHeader("x-request-id");
          const autoReplyInput = {
            agent,
            agentTimeoutMs,
            event,
            telegram,
            webhookRequestId:
              typeof webhookRequestHeader === "string"
                ? webhookRequestHeader
                : undefined,
            workspace,
          };
          if (event.message.kind === "voice") {
            void runTelegramVoiceAutoReply(autoReplyInput);
          } else {
            void runTelegramAutoReply(autoReplyInput);
          }
        }
      } catch (error) {
        log.error("telegram_webhook_failed", errorLogFields(error));
        if (error instanceof ZodError) {
          sendApiError(response, 400, {
            code: "invalid_request",
            error: "Telegram update is invalid.",
            retryable: false,
          });
          return;
        }
        if (error instanceof TelegramInboundError) {
          const status =
            error.code === "invalid_request"
              ? 400
              : error.code === "not_found"
                ? 404
                : error.code === "revision_conflict"
                  ? 409
                  : 503;
          sendApiError(response, status, {
            code: error.code,
            error: error.message,
            retryable:
              error.code === "provider_failed" ||
              error.code === "revision_conflict",
          });
          return;
        }
        sendApiError(response, 503, {
          code: "provider_failed",
          error: "Telegram inbound persistence failed.",
          retryable: true,
        });
      }
    },
  );
  app.post(
    "/api/telegram/speech/:messageId/retry",
    async (request: Request, response: Response) => {
      if (!telegram?.speech) {
        sendApiError(response, 503, {
          code: "feature_disabled",
          error: "Telegram speech processing is not configured.",
          retryable: false,
        });
        return;
      }
      try {
        const messageId = Array.isArray(request.params.messageId)
          ? ""
          : (request.params.messageId ?? "");
        const result = await telegram.speech.retry(messageId);
        response.status(200).json(result);
      } catch (error) {
        sendInboundSpeechFailure(response, error);
      }
    },
  );
  app.post(
    "/api/telegram/speech/:messageId/manual-transcript",
    async (request: Request, response: Response) => {
      if (!telegram?.speech) {
        sendApiError(response, 503, {
          code: "feature_disabled",
          error: "Telegram speech processing is not configured.",
          retryable: false,
        });
        return;
      }
      const input = manualSpeechTranscriptRequestSchema.safeParse(request.body);
      if (!input.success) {
        sendApiError(response, 400, {
          code: "invalid_request",
          error: "Manual transcript is invalid.",
          retryable: false,
        });
        return;
      }
      try {
        const messageId = Array.isArray(request.params.messageId)
          ? ""
          : (request.params.messageId ?? "");
        response.status(200).json(
          await telegram.speech.saveManualTranscript(messageId, {
            ...input.data,
            englishGloss: input.data.englishGloss ?? null,
          }),
        );
      } catch (error) {
        sendInboundSpeechFailure(response, error);
      }
    },
  );
  app.get(
    "/api/telegram/speech/:messageId/audio",
    async (request: Request, response: Response) => {
      if (!telegram?.speech) {
        sendApiError(response, 503, {
          code: "feature_disabled",
          error: "Telegram speech processing is not configured.",
          retryable: false,
        });
        return;
      }
      try {
        const messageId = Array.isArray(request.params.messageId)
          ? ""
          : (request.params.messageId ?? "");
        const bytes = await telegram.speech.downloadAudio(messageId);
        response
          .status(200)
          .set("cache-control", "private, no-store")
          .type("audio/ogg")
          .send(Buffer.from(bytes));
      } catch (error) {
        sendInboundSpeechFailure(response, error);
      }
    },
  );
  app.post(
    "/api/translation",
    async (request: Request, response: Response) => {
      if (!translation) {
        sendApiError(response, 503, {
          code: "feature_disabled",
          error: "Translation is not configured.",
          retryable: false,
        });
        return;
      }
      const input = translationRequestSchema.safeParse(request.body);
      if (!input.success) {
        sendApiError(response, 400, {
          code: "invalid_request",
          error: "Translation request is invalid.",
          retryable: false,
        });
        return;
      }
      try {
        response.status(200).json(await translation.translate(input.data));
      } catch (error) {
        sendApiError(response, 503, {
          code: error instanceof AgentProviderError ? error.code : "provider_failed",
          error: error instanceof AgentProviderError
            ? error.message
            : "Translation failed.",
          retryable: true,
        });
      }
    },
  );
  app.post(
    "/api/outbound/voice/prepare",
    async (request: Request, response: Response) => {
      if (!telegram?.outbound) {
        sendApiError(response, 503, {
          code: "feature_disabled",
          error: "Telegram outbound is not configured.",
          retryable: false,
        });
        return;
      }
      const input = outboundVoicePrepareRequestSchema.safeParse(request.body);
      if (!input.success) {
        sendApiError(response, 400, {
          code: "invalid_request",
          error: "Voice preparation request is invalid.",
          retryable: false,
        });
        return;
      }
      try {
        response.status(200).json(await telegram.outbound.prepareVoice(input.data));
      } catch (error) {
        sendTelegramOutboundFailure(response, error);
      }
    },
  );
  app.post(
    "/api/outbound/deliveries/:id/voice/recording",
    express.raw({ type: ["audio/webm", "audio/ogg"], limit: "8mb" }),
    async (request: Request, response: Response) => {
      if (!telegram?.outbound) {
        sendApiError(response, 503, {
          code: "feature_disabled",
          error: "Telegram outbound is not configured.",
          retryable: false,
        });
        return;
      }
      if (!Buffer.isBuffer(request.body) || request.body.byteLength === 0) {
        sendApiError(response, 400, {
          code: "invalid_request",
          error: "Recorded voice audio is required.",
          retryable: false,
        });
        return;
      }
      try {
        const deliveryId = Array.isArray(request.params.id)
          ? ""
          : (request.params.id ?? "");
        response.status(200).json(
          await telegram.outbound.attachRecordedVoice(deliveryId, request.body),
        );
      } catch (error) {
        sendTelegramOutboundFailure(response, error);
      }
    },
  );
  app.get(
    "/api/outbound/deliveries/:id/voice/audio",
    async (request: Request, response: Response) => {
      if (!telegram?.outbound) {
        sendApiError(response, 503, {
          code: "feature_disabled",
          error: "Telegram outbound is not configured.",
          retryable: false,
        });
        return;
      }
      try {
        const deliveryId = Array.isArray(request.params.id)
          ? ""
          : (request.params.id ?? "");
        const bytes = await telegram.outbound.readVoiceAudio(deliveryId);
        response
          .status(200)
          .set("cache-control", "private, no-store")
          .type("audio/ogg")
          .send(Buffer.from(bytes));
      } catch (error) {
        sendTelegramOutboundFailure(response, error);
      }
    },
  );
  app.post(
    "/api/outbound/send",
    async (request: Request, response: Response) => {
      if (!telegram?.outbound) {
        sendApiError(response, 503, {
          code: "feature_disabled",
          error: "Telegram outbound is not configured.",
          retryable: false,
        });
        return;
      }
      const parsed = outboundSendRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        sendApiError(response, 400, {
          code: "invalid_request",
          error: "Telegram send request is invalid.",
          retryable: false,
        });
        return;
      }
      try {
        response.status(200).json(await telegram.outbound.send(parsed.data));
      } catch (error) {
        sendTelegramOutboundFailure(response, error);
      }
    },
  );
  app.post(
    "/api/calendar-deliveries",
    async (request: Request, response: Response) => {
      if (!telegram?.calendar) {
        sendApiError(response, 503, {
          code: "feature_disabled",
          error: "Calendar delivery is not configured.",
          retryable: false,
        });
        return;
      }
      const parsed = calendarDispatchRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        sendApiError(response, 400, {
          code: "invalid_request",
          error: "Calendar delivery request is invalid.",
          retryable: false,
        });
        return;
      }
      try {
        response.status(200).json(await telegram.calendar.send(parsed.data));
      } catch (error) {
        sendCalendarDispatchFailure(response, error);
      }
    },
  );
  app.post(
    "/api/outbound/deliveries/:id/reconcile",
    async (request: Request, response: Response) => {
      if (!telegram?.outbound) {
        sendApiError(response, 503, {
          code: "feature_disabled",
          error: "Telegram outbound is not configured.",
          retryable: false,
        });
        return;
      }
      const parsed = outboundReconcileRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        sendApiError(response, 400, {
          code: "invalid_request",
          error: "Telegram reconcile request is invalid.",
          retryable: false,
        });
        return;
      }
      try {
        const deliveryId = Array.isArray(request.params.id)
          ? ""
          : (request.params.id ?? "");
        response
          .status(200)
          .json(
            await telegram.outbound.reconcile(
              deliveryId,
              parsed.data,
            ),
          );
      } catch (error) {
        sendTelegramOutboundFailure(response, error);
      }
    },
  );
  app.get(
    "/api/workspace/state",
    async (_request: Request, response: Response) => {
      if (!requireWorkspace(workspace, response)) {
        return;
      }
      try {
        const loaded = await workspace.repository.load(workspace.workspaceId);
        if (!loaded) {
          sendApiError(response, 404, {
            code: "not_found",
            error: "Workspace not found.",
            retryable: false,
          });
          return;
        }
        response.status(200).json(loaded);
      } catch (error) {
        sendWorkspaceFailure(response, error);
      }
    },
  );
  app.put(
    "/api/workspace/state",
    async (request: Request, response: Response) => {
      if (!requireWorkspace(workspace, response)) {
        return;
      }
      const parsed = saveWorkspaceRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        sendApiError(response, 400, {
          code: "invalid_request",
          error: "Workspace save request is invalid.",
          retryable: false,
        });
        return;
      }
      try {
        const result = await workspace.repository.save(
          workspace.workspaceId,
          parsed.data.expectedRevision,
          parsed.data.state,
        );
        response.status(result.ok ? 200 : 409).json(result);
      } catch (error) {
        sendWorkspaceFailure(response, error);
      }
    },
  );
  app.post(
    "/api/workspace/commands",
    rateLimiter(rateLimit, now),
    async (request: Request, response: Response) => {
      if (!requireWorkspace(workspace, response)) {
        return;
      }
      if (!workflow) {
        sendApiError(response, 503, {
          code: "feature_disabled",
          error: "Dream release workflows are not configured.",
          retryable: false,
        });
        return;
      }
      const parsed = workspaceCommandRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        sendApiError(response, 400, {
          code: "invalid_request",
          error: "Workspace command request is invalid.",
          retryable: false,
        });
        return;
      }
      const connectionController = new AbortController();
      request.once("aborted", () => connectionController.abort());
      response.once("close", () => {
        if (!response.writableEnded) {
          connectionController.abort();
        }
      });
      const signal = AbortSignal.any([
        connectionController.signal,
        AbortSignal.timeout(agentTimeoutMs + requestTimeoutMs),
      ]);
      try {
        response.status(200).json(
          workspaceCommandResultSchema.parse(
            await workflow.execute(parsed.data, signal),
          ),
        );
      } catch (error) {
        if (connectionController.signal.aborted) {
          return;
        }
        if (signal.aborted) {
          sendApiError(response, 504, {
            code: "provider_timeout",
            error: "The workspace command timed out.",
            retryable: true,
          });
          return;
        }
        sendWorkspaceCommandFailure(response, error);
      }
    },
  );
  app.post(
    "/api/demo/reset",
    async (request: Request, response: Response) => {
      if (!requireWorkspace(workspace, response)) {
        return;
      }
      const parsed = resetDemoRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        sendApiError(response, 400, {
          code: "invalid_request",
          error: "Demo reset request is invalid.",
          retryable: false,
        });
        return;
      }
      try {
        const current = await workspace.repository.load(workspace.workspaceId);
        if (!current) {
          sendApiError(response, 404, {
            code: "not_found",
            error: "Workspace not found.",
            retryable: false,
          });
          return;
        }
        if (current.revision !== parsed.data.expectedRevision) {
          response.status(409).json(
            saveWorkspaceResultSchema.parse({
              ok: false,
              code: "revision_conflict",
              workspace: current,
            }),
          );
          return;
        }
        const canonical = await workspace.createCanonicalState();
        const nextState = mergeSyntheticReset(current.state, canonical);
        const result = await workspace.repository.save(
          workspace.workspaceId,
          parsed.data.expectedRevision,
          nextState,
        );
        response.status(result.ok ? 200 : 409).json(result);
      } catch (error) {
        sendWorkspaceFailure(response, error);
      }
    },
  );
  app.post(
    "/api/agent/runs",
    rateLimiter(rateLimit, now),
    async (request: Request, response: Response) => {
      if (!requireWorkspace(workspace, response)) {
        return;
      }
      if (!agent) {
        sendApiError(response, 503, {
          code: "feature_disabled",
          error: "Live agent generation is not configured.",
          retryable: false,
        });
        return;
      }
      const parsed = agentRunCreateRequestSchema.safeParse(
        request.body,
      );
      if (!parsed.success) {
        sendApiError(response, 400, {
          code: "invalid_request",
          error: "Agent run request is invalid.",
          retryable: false,
        });
        return;
      }

      const connectionController = new AbortController();
      request.once("aborted", () => connectionController.abort());
      response.once("close", () => {
        if (!response.writableEnded) {
          connectionController.abort();
        }
      });
      const signal = AbortSignal.any([
        connectionController.signal,
        AbortSignal.timeout(agentTimeoutMs),
      ]);

      try {
        const loaded = await workspace.repository.load(
          workspace.workspaceId,
        );
        if (!loaded) {
          sendApiError(response, 404, {
            code: "not_found",
            error: "Workspace not found.",
            retryable: false,
          });
          return;
        }
        const runRequest = buildLiveAgentRunRequest(
          loaded.state,
          parsed.data,
          agent.agentConfigVersion,
        );
        const result = agentRunResultSchema.parse(
          await agent.run(runRequest, signal),
        );
        response.status(200).json(result);
      } catch (error) {
        if (connectionController.signal.aborted) {
          return;
        }
        if (signal.aborted) {
          sendApiError(response, 504, {
            code: "provider_timeout",
            error: "The agent request timed out.",
            retryable: true,
          });
          return;
        }
        sendAgentFailure(response, error);
      }
    },
  );
  app.get(
    "/api/eval/capability",
    (_request: Request, response: Response) => {
      if (!requireWorkspace(workspace, response)) {
        return;
      }
      response.status(200).json({
        enabled: Boolean(evalService),
        reason: evalService ? null : "Eval execution is not configured.",
      });
    },
  );
  app.post(
    "/api/eval/suites",
    async (request: Request, response: Response) => {
      if (!requireWorkspace(workspace, response)) {
        return;
      }
      if (!evalService) {
        sendApiError(response, 503, {
          code: "feature_disabled",
          error: "Eval execution is not configured.",
          retryable: false,
        });
        return;
      }
      const parsed = evalSuiteCreateRequestSchema.safeParse(
        request.body,
      );
      if (!parsed.success) {
        sendApiError(response, 400, {
          code: "invalid_request",
          error: "Eval suite request is invalid.",
          retryable: false,
        });
        return;
      }
      try {
        response
          .status(200)
          .json(
            evalSuiteCreateResultSchema.parse(
              await evalService.createSuite(parsed.data),
            ),
          );
      } catch (error) {
        sendEvalFailure(response, error);
      }
    },
  );
  app.post(
    "/api/eval/suites/:id/cases/:caseId/run",
    rateLimiter(rateLimit, now),
    async (request: Request, response: Response) => {
      if (!requireWorkspace(workspace, response)) {
        return;
      }
      if (!evalService) {
        sendApiError(response, 503, {
          code: "feature_disabled",
          error: "Eval execution is not configured.",
          retryable: false,
        });
        return;
      }
      const parsed = evalCaseRunRequestSchema.safeParse(request.body);
      const suiteId = Array.isArray(request.params.id)
        ? ""
        : (request.params.id ?? "");
      const caseId = Array.isArray(request.params.caseId)
        ? ""
        : (request.params.caseId ?? "");
      if (
        !parsed.success ||
        parsed.data.suiteId !== suiteId ||
        parsed.data.caseId !== caseId
      ) {
        sendApiError(response, 400, {
          code: "invalid_request",
          error: "Eval case run request is invalid.",
          retryable: false,
        });
        return;
      }

      const connectionController = new AbortController();
      request.once("aborted", () => connectionController.abort());
      response.once("close", () => {
        if (!response.writableEnded) {
          connectionController.abort();
        }
      });
      const signal = AbortSignal.any([
        connectionController.signal,
        AbortSignal.timeout(agentTimeoutMs + requestTimeoutMs),
      ]);

      try {
        response.status(200).json(
          evalCaseRunResultSchema.parse(
            await evalService.runCase(parsed.data, signal),
          ),
        );
      } catch (error) {
        if (connectionController.signal.aborted) {
          return;
        }
        if (signal.aborted) {
          sendApiError(response, 504, {
            code: "provider_timeout",
            error: "The Eval case request timed out.",
            retryable: true,
          });
          return;
        }
        sendEvalFailure(response, error);
      }
    },
  );
  app.post(
    "/api/judge",
    rateLimiter(rateLimit, now),
    async (request: Request, response: Response) => {
      const parsed = judgeRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        sendApiError(response, 400, {
          code: "invalid_request",
          error: "Judge request is invalid.",
          retryable: false,
        });
        return;
      }

      const connectionController = new AbortController();
      request.once("aborted", () => connectionController.abort());
      const signal = AbortSignal.any([
        connectionController.signal,
        AbortSignal.timeout(requestTimeoutMs),
      ]);

      try {
        const result = judgeResponseSchema.parse(await judge(parsed.data, signal));
        response.status(200).json(result);
      } catch (error) {
        if (error instanceof JudgeConfigurationError) {
          sendApiError(response, 503, {
            code: "feature_disabled",
            error: "The live LLM judge is not configured on this server.",
            retryable: false,
          });
          return;
        }
        if (connectionController.signal.aborted) {
          return;
        }
        if (signal.aborted) {
          sendApiError(response, 504, {
            code: "provider_timeout",
            error: "The judge request timed out.",
            retryable: true,
          });
          return;
        }
        if (error instanceof ZodError) {
          sendApiError(response, 502, {
            code: "provider_failed",
            error: "The model provider returned invalid judge evidence.",
            retryable: true,
          });
          return;
        }
        sendApiError(response, 502, {
          code: "provider_failed",
          error: "The model provider did not return a judge result.",
          retryable: true,
        });
      }
    },
  );

  const jsonErrorHandler: ErrorRequestHandler = (error, request, response, next) => {
    const requestName =
      request.path === "/api/judge" ? "Judge request" : "API request";
    if (error instanceof SyntaxError) {
      sendApiError(response, 400, {
        code: "invalid_request",
        error: `${requestName} is invalid.`,
        retryable: false,
      });
      return;
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "type" in error &&
      error.type === "entity.too.large"
    ) {
      sendApiError(response, 413, {
        code: "invalid_request",
        error: `${requestName} exceeds the 64 KiB limit.`,
        retryable: false,
      });
      return;
    }
    next(error);
  };
  app.use(jsonErrorHandler);
  return app;
}

async function startServer(): Promise<void> {
  const app = createJudgeApp();
  const isProduction =
    process.env.NODE_ENV === "production" || process.argv.includes("--production");
  if (isProduction) {
    const distPath = resolve(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.use((request, response, next) => {
      if (request.method !== "GET" || request.path.startsWith("/api/")) {
        next();
        return;
      }
      response.sendFile(resolve(distPath, "index.html"));
    });
  } else {
    const vite = await createViteServer({
      appType: "spa",
      server: { middlewareMode: true },
    });
    app.use(vite.middlewares);
  }

  const portArgument = process.argv.find((argument) => argument.startsWith("--port="));
  const port = Number(portArgument?.slice("--port=".length) || process.env.PORT || 5173);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  app.listen(port, "0.0.0.0", () => {
    console.log(`KaunterAI listening on port ${port}`);
  });
}

const directRun =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (directRun) {
  await startServer();
}
