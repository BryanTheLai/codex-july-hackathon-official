import { z, type ZodType } from "zod";

import {
  agentRunCreateRequestSchema,
  agentRunResultSchema,
  type AgentRunCreateRequest,
  type AgentRunResult,
} from "../contracts/agent";
import {
  apiErrorSchema,
  outboundReconcileRequestSchema,
  outboundReconcileResultSchema,
  outboundSendRequestSchema,
  outboundSendResultSchema,
  outboundVoicePrepareRequestSchema,
  outboundVoicePrepareResultSchema,
  outboundVoiceRecordingResultSchema,
  calendarDispatchRequestSchema,
  calendarDispatchResultSchema,
  bookingCommandRequestSchema,
  bookingCommandResultSchema,
  manualSpeechTranscriptRequestSchema,
  saveWorkspaceResultSchema,
  telegramAgentModeRequestSchema,
  telegramReplyNowRequestSchema,
  workspaceEnvelopeSchema,
  type ApiErrorCode,
  type OutboundReconcileRequest,
  type OutboundReconcileResult,
  type OutboundSendRequest,
  type OutboundSendResult,
  type OutboundVoicePrepareRequest,
  type OutboundVoicePrepareResult,
  type OutboundVoiceRecordingResult,
  type CalendarDispatchRequest,
  type CalendarDispatchResult,
  type BookingCommandRequest,
  type BookingCommandResult,
  type ManualSpeechTranscriptRequest,
  type SaveWorkspaceResult,
  type WorkspaceEnvelope,
} from "../contracts/api";
import {
  inboundTranscriptionResultSchema,
  type InboundTranscriptionResult,
} from "../contracts/speech";
import {
  evalCaseRunRequestSchema,
  evalCaseRunResultSchema,
  evalExecutionCapabilitySchema,
  evalSuiteCreateRequestSchema,
  evalSuiteCreateResultSchema,
  type EvalCaseRunRequest,
  type EvalCaseRunResult,
  type EvalExecutionCapability,
  type EvalSuiteCreateRequest,
  type EvalSuiteCreateResult,
} from "../contracts/eval";
import {
  workspaceCommandRequestSchema,
  workspaceCommandResultSchema,
  type WorkspaceCommandRequest,
  type WorkspaceCommandResult,
} from "../contracts/workflow";
import { isAbortError } from "../shared/errors";

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class ApiClientError extends Error {
  readonly code: ApiErrorCode;
  readonly retryable: boolean;

  constructor(code: ApiErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface WorkspaceClient {
  load(signal?: AbortSignal): Promise<WorkspaceEnvelope>;
  setTelegramAgentMode?(
    conversationId: string,
    request: {
      agentMode: "live_agent" | "staff_only";
      expectedConversationRevision: number;
      expectedWorkspaceRevision: number;
    },
    signal?: AbortSignal,
  ): Promise<SaveWorkspaceResult>;
  replyToLatestTelegramMessage?(
    conversationId: string,
    request: {
      expectedConversationRevision: number;
      expectedWorkspaceRevision: number;
    },
    signal?: AbortSignal,
  ): Promise<SaveWorkspaceResult>;
  reset?(
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<SaveWorkspaceResult>;
}

export interface WorkspaceCommandClient {
  execute(
    request: WorkspaceCommandRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceCommandResult>;
}

export interface BookingClient {
  execute(
    request: BookingCommandRequest,
    signal?: AbortSignal,
  ): Promise<BookingCommandResult>;
}

export interface AgentClient {
  run(
    request: AgentRunCreateRequest,
    signal?: AbortSignal,
  ): Promise<AgentRunResult>;
}

export interface EvalClient {
  executionCapability?(signal?: AbortSignal): Promise<EvalExecutionCapability>;
  createSuite(
    request: EvalSuiteCreateRequest,
    signal?: AbortSignal,
  ): Promise<EvalSuiteCreateResult>;
  runCase(
    request: EvalCaseRunRequest,
    signal?: AbortSignal,
  ): Promise<EvalCaseRunResult>;
}

export interface TelegramOutboundClient {
  sendCalendar?(
    request: CalendarDispatchRequest,
    signal?: AbortSignal,
  ): Promise<CalendarDispatchResult>;
  prepareVoice?(
    request: OutboundVoicePrepareRequest,
    signal?: AbortSignal,
  ): Promise<OutboundVoicePrepareResult>;
  reconcile(
    deliveryId: string,
    request: OutboundReconcileRequest,
    signal?: AbortSignal,
  ): Promise<OutboundReconcileResult>;
  send(
    request: OutboundSendRequest,
    signal?: AbortSignal,
  ): Promise<OutboundSendResult>;
  uploadRecordedVoice?(
    deliveryId: string,
    recording: Blob,
    signal?: AbortSignal,
  ): Promise<OutboundVoiceRecordingResult>;
  retrySpeech?(
    messageId: string,
    signal?: AbortSignal,
  ): Promise<InboundTranscriptionResult | { status: "failed" | "idle" }>;
  saveManualTranscript?(
    messageId: string,
    request: ManualSpeechTranscriptRequest,
    signal?: AbortSignal,
  ): Promise<InboundTranscriptionResult>;
  translate?(
    request: { text: string; sourceLanguage?: string; targetLanguage: string },
    signal?: AbortSignal,
  ): Promise<{ translatedText: string; targetLanguage: string; model: string }>;
}

type JsonRequest<Result> = {
  fetcher: Fetcher;
  input: RequestInfo | URL;
  init: RequestInit;
  schema: ZodType<Result>;
  networkError: string;
  invalidResponseError: string;
  requestError: string;
  acceptNonOkResult?: (result: Result) => boolean;
};

async function requestJson<Result>({
  fetcher,
  input,
  init,
  schema,
  networkError,
  invalidResponseError,
  requestError,
  acceptNonOkResult,
}: JsonRequest<Result>): Promise<Result> {
  let response: Response;
  try {
    response = await fetcher(input, init);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw new ApiClientError("provider_failed", networkError, true);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    const message = response.status >= 500
      ? `${requestError} Upstream returned HTTP ${response.status} without a valid API response.`
      : invalidResponseError;
    throw new ApiClientError(
      "provider_failed",
      message,
      response.status >= 500,
    );
  }

  if (!response.ok) {
    if (acceptNonOkResult) {
      const parsedResult = schema.safeParse(body);
      if (
        parsedResult.success &&
        acceptNonOkResult(parsedResult.data)
      ) {
        return parsedResult.data;
      }
    }
    const parsedError = apiErrorSchema.safeParse(body);
    if (parsedError.success) {
      throw new ApiClientError(
        parsedError.data.code,
        parsedError.data.error,
        parsedError.data.retryable,
      );
    }
    throw new ApiClientError(
      "provider_failed",
      requestError,
      response.status === 429 || response.status >= 500,
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiClientError(
      "provider_failed",
      invalidResponseError,
      true,
    );
  }
  return parsed.data;
}

export function createHttpWorkspaceClient(
  fetcher: Fetcher = fetch,
): WorkspaceClient {
  return {
    load(signal) {
      return requestJson({
        fetcher,
        input: "/api/workspace/state",
        init: { method: "GET", signal },
        schema: workspaceEnvelopeSchema,
        networkError: "The workspace server could not be reached.",
        invalidResponseError:
          "The workspace server returned invalid state.",
        requestError: "The workspace request failed.",
      });
    },
    setTelegramAgentMode(conversationId, input, signal) {
      const request = telegramAgentModeRequestSchema.parse(input);
      return requestJson({
        fetcher,
        input: `/api/telegram/conversations/${encodeURIComponent(conversationId)}/agent-mode`,
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal,
        },
        schema: saveWorkspaceResultSchema,
        networkError: "The workspace server could not be reached.",
        invalidResponseError:
          "The workspace server returned invalid state.",
        requestError: "The workspace update failed.",
        acceptNonOkResult: (result) => !result.ok,
      });
    },
    replyToLatestTelegramMessage(conversationId, input, signal) {
      const request = telegramReplyNowRequestSchema.parse(input);
      return requestJson({
        fetcher,
        input: `/api/telegram/conversations/${encodeURIComponent(conversationId)}/reply-now`,
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal,
        },
        schema: saveWorkspaceResultSchema,
        networkError: "The Telegram reply-now server could not be reached.",
        invalidResponseError:
          "The Telegram reply-now server returned invalid state.",
        requestError: "The waiting Telegram message could not be answered.",
        acceptNonOkResult: (result) => !result.ok,
      });
    },
    reset(expectedRevision, signal) {
      return requestJson({
        fetcher,
        input: "/api/demo/reset",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedRevision }),
          signal,
        },
        schema: saveWorkspaceResultSchema,
        networkError: "The demo reset server could not be reached.",
        invalidResponseError:
          "The demo reset server returned invalid state.",
        requestError: "The demo reset request failed.",
        acceptNonOkResult: (result) => !result.ok,
      });
    },
  };
}

export function createHttpWorkspaceCommandClient(
  fetcher: Fetcher = fetch,
): WorkspaceCommandClient {
  return {
    execute(input, signal) {
      const request = workspaceCommandRequestSchema.parse(input);
      return requestJson({
        fetcher,
        input: "/api/workspace/commands",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal,
        },
        schema: workspaceCommandResultSchema,
        networkError: "The Knowledge release server could not be reached.",
        invalidResponseError: "The Knowledge release server returned invalid state.",
        requestError: "The Knowledge release request failed.",
      });
    },
  };
}

export function createHttpBookingClient(
  fetcher: Fetcher = fetch,
): BookingClient {
  return {
    execute(input, signal) {
      const request = bookingCommandRequestSchema.parse(input);
      return requestJson({
        fetcher,
        input: "/api/bookings/commands",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal,
        },
        schema: bookingCommandResultSchema,
        networkError: "The booking server could not be reached.",
        invalidResponseError: "The booking server returned an invalid response.",
        requestError: "The booking update failed.",
      });
    },
  };
}

export function createHttpAgentClient(
  fetcher: Fetcher = fetch,
): AgentClient {
  return {
    run(input, signal) {
      const request = agentRunCreateRequestSchema.parse(input);
      return requestJson({
        fetcher,
        input: "/api/agent/runs",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal,
        },
        schema: agentRunResultSchema,
        networkError: "The agent server could not be reached.",
        invalidResponseError:
          "The agent server returned an invalid draft.",
        requestError: "The agent request failed.",
      });
    },
  };
}

export function createHttpEvalClient(
  fetcher: Fetcher = fetch,
): EvalClient {
  return {
    executionCapability(signal) {
      return requestJson({
        fetcher,
        input: "/api/eval/capability",
        init: { signal },
        schema: evalExecutionCapabilitySchema,
        networkError: "The Eval server could not be reached.",
        invalidResponseError: "The Eval server returned an invalid capability response.",
        requestError: "The Eval capability check failed.",
      });
    },

    createSuite(input, signal) {
      const request = evalSuiteCreateRequestSchema.parse(input);
      return requestJson({
        fetcher,
        input: "/api/eval/suites",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal,
        },
        schema: evalSuiteCreateResultSchema,
        networkError: "The Eval server could not be reached.",
        invalidResponseError:
          "The Eval server returned an invalid suite.",
        requestError: "The Eval suite request failed.",
      });
    },

    runCase(input, signal) {
      const request = evalCaseRunRequestSchema.parse(input);
      return requestJson({
        fetcher,
        input: `/api/eval/suites/${encodeURIComponent(request.suiteId)}/cases/${encodeURIComponent(request.caseId)}/run`,
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal,
        },
        schema: evalCaseRunResultSchema,
        networkError: "The Eval server could not be reached.",
        invalidResponseError:
          "The Eval server returned invalid case evidence.",
        requestError: "The Eval case request failed.",
      });
    },
  };
}

export function createHttpTelegramOutboundClient(
  fetcher: Fetcher = fetch,
): TelegramOutboundClient {
  return {
    sendCalendar(request, signal) {
      const body = calendarDispatchRequestSchema.parse(request);
      return requestJson({
        fetcher,
        input: "/api/calendar-deliveries",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal,
        },
        schema: calendarDispatchResultSchema,
        networkError: "The calendar delivery server could not be reached.",
        invalidResponseError: "The calendar delivery server returned an invalid response.",
        requestError: "The calendar delivery request failed.",
      });
    },
    prepareVoice(input, signal) {
      const request = outboundVoicePrepareRequestSchema.parse(input);
      return requestJson({
        fetcher,
        input: "/api/outbound/voice/prepare",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal,
        },
        schema: outboundVoicePrepareResultSchema,
        networkError: "The Telegram voice preparation server could not be reached.",
        invalidResponseError: "The Telegram voice preparation server returned an invalid response.",
        requestError: "The Telegram voice preparation request failed.",
      });
    },
    reconcile(deliveryId, input, signal) {
      const request = outboundReconcileRequestSchema.parse(input);
      return requestJson({
        fetcher,
        input: `/api/outbound/deliveries/${encodeURIComponent(deliveryId)}/reconcile`,
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal,
        },
        schema: outboundReconcileResultSchema,
        networkError:
          "The Telegram reconciliation server could not be reached.",
        invalidResponseError:
          "The Telegram reconciliation server returned an invalid response.",
        requestError: "The Telegram reconciliation request failed.",
      });
    },

    send(input, signal) {
      const request = outboundSendRequestSchema.parse(input);
      return requestJson({
        fetcher,
        input: "/api/outbound/send",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal,
        },
        schema: outboundSendResultSchema,
        networkError: "The Telegram send server could not be reached.",
        invalidResponseError:
          "The Telegram send server returned an invalid response.",
        requestError: "The Telegram send request failed.",
      });
    },

    uploadRecordedVoice(deliveryId, recording, signal) {
      return requestJson({
        fetcher,
        input: `/api/outbound/deliveries/${encodeURIComponent(deliveryId)}/voice/recording`,
        init: {
          method: "POST",
          headers: { "content-type": recording.type || "audio/webm" },
          body: recording,
          signal,
        },
        schema: outboundVoiceRecordingResultSchema,
        networkError: "The recorded voice upload server could not be reached.",
        invalidResponseError: "The recorded voice upload server returned an invalid response.",
        requestError: "The recorded voice upload failed.",
      });
    },

    retrySpeech(messageId, signal) {
      return requestJson({
        fetcher,
        input: `/api/telegram/speech/${encodeURIComponent(messageId)}/retry`,
        init: { method: "POST", signal },
        schema: inboundTranscriptionResultSchema.or(
          z.object({ status: z.enum(["failed", "idle"]) }).strict(),
        ),
        networkError: "The speech retry server could not be reached.",
        invalidResponseError: "The speech retry server returned an invalid response.",
        requestError: "The speech retry failed.",
      });
    },

    saveManualTranscript(messageId, input, signal) {
      const request = manualSpeechTranscriptRequestSchema.parse(input);
      return requestJson({
        fetcher,
        input: `/api/telegram/speech/${encodeURIComponent(messageId)}/manual-transcript`,
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal,
        },
        schema: inboundTranscriptionResultSchema,
        networkError: "The manual transcript server could not be reached.",
        invalidResponseError: "The manual transcript server returned an invalid response.",
        requestError: "The manual transcript could not be saved.",
      });
    },

    translate(input, signal) {
      return requestJson({
        fetcher,
        input: "/api/translation",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
          signal,
        },
        schema: z
          .object({
            translatedText: z.string().trim().min(1).max(4096),
            targetLanguage: z.string().trim().min(1).max(64),
            model: z.string().trim().min(1).max(256),
          })
          .strict(),
        networkError: "The translation server could not be reached.",
        invalidResponseError: "The translation server returned an invalid response.",
        requestError: "The translation request failed.",
      });
    },
  };
}
