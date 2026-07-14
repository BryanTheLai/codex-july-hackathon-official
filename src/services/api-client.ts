import type { ZodType } from "zod";

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
  saveWorkspaceResultSchema,
  workspaceEnvelopeSchema,
  type ApiErrorCode,
  type OutboundReconcileRequest,
  type OutboundReconcileResult,
  type OutboundSendRequest,
  type OutboundSendResult,
  type SaveWorkspaceResult,
  type WorkspaceEnvelope,
} from "../contracts/api";
import {
  evalCaseRunRequestSchema,
  evalCaseRunResultSchema,
  evalSuiteCreateRequestSchema,
  evalSuiteCreateResultSchema,
  type EvalCaseRunRequest,
  type EvalCaseRunResult,
  type EvalSuiteCreateRequest,
  type EvalSuiteCreateResult,
} from "../contracts/eval";
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
  reset?(
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<SaveWorkspaceResult>;
}

export interface AgentClient {
  run(
    request: AgentRunCreateRequest,
    signal?: AbortSignal,
  ): Promise<AgentRunResult>;
}

export interface EvalClient {
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
  reconcile(
    deliveryId: string,
    request: OutboundReconcileRequest,
    signal?: AbortSignal,
  ): Promise<OutboundReconcileResult>;
  send(
    request: OutboundSendRequest,
    signal?: AbortSignal,
  ): Promise<OutboundSendResult>;
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
    throw new ApiClientError(
      "provider_failed",
      invalidResponseError,
      true,
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
  };
}
