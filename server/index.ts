import { randomUUID, timingSafeEqual } from "node:crypto";
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
  evalCaseRunRequestSchema,
  evalCaseRunResultSchema,
  evalSuiteCreateRequestSchema,
  evalSuiteCreateResultSchema,
} from "../src/contracts/eval";
import {
  createCanonicalServerState,
  mergeSyntheticReset,
} from "../src/domain";
import { AGENT_PROMPT_VERSION } from "./agent-prompt";
import {
  AgentProviderError,
  createAgentConfigVersion,
  createAgentProviderAdapter,
  readAgentProviderConfig,
  readJudgeProviderConfig,
} from "./agent-provider";
import { AgentServiceError, createAgentService } from "./agent-service";
import {
  AgentWorkspaceError,
  buildLiveAgentRunRequest,
} from "./agent-workspace";
import {
  createEvalService,
  EvalServiceError,
  type EvalService,
} from "./eval-service";
import type { ApiError } from "./api-contract";
import {
  apiErrorSchema,
  outboundReconcileRequestSchema,
  outboundSendRequestSchema,
  resetDemoRequestSchema,
  saveWorkspaceRequestSchema,
  saveWorkspaceResultSchema,
} from "./api-contract";
import type { JudgeRequest, JudgeResponse } from "./judge-contract";
import { judgeRequestSchema, judgeResponseSchema } from "./judge-contract";
import { createJudgeProviderAdapter } from "./judge-provider";
import { createJudgeService } from "./judge-service";
import { JUDGE_PROMPT_VERSION } from "./judge-prompt";
import {
  createSupabaseServerClient,
  createSupabaseTelegramDeliveryDataSource,
  createSupabaseTelegramEventDataSource,
  createSupabaseWorkspaceDataSource,
  readSupabaseConfig,
} from "./supabase";
import {
  createTelegramAdapter,
  readTelegramConfig,
} from "./telegram-adapter";
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
  createWorkspaceRepository,
  WorkspaceRepositoryError,
  type WorkspaceRepository,
} from "./workspace-repository";

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

type Judge = (request: JudgeRequest, signal?: AbortSignal) => Promise<JudgeResponse>;

type AgentRunner = {
  agentConfigVersion: string;
  apiMode?: "responses" | "chat_completions";
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
  judge?: Judge;
  rateLimit?: RateLimitOptions;
  requestTimeoutMs?: number;
  now?: () => number;
  workspace?: WorkspaceAppOptions | null;
  telegram?: TelegramAppOptions | null;
};

type WorkspaceAppOptions = {
  workspaceId: string;
  repository: WorkspaceRepository;
  createCanonicalState: () => Promise<ServerDomainStatePayload>;
};

type TelegramAppOptions = {
  webhookSecret: string;
  inbound: TelegramInboundService;
  outbound?: TelegramOutboundService;
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

function configuredAgent(): AgentRunner | null {
  if (!process.env.LLM_API_KEY) {
    return null;
  }
  const config = readAgentProviderConfig();
  const createResponse = createAgentProviderAdapter(config);
  return {
    agentConfigVersion: createAgentConfigVersion(config),
    apiMode: config.apiMode,
    modelId: config.model,
    run: createAgentService({
      createResponse,
      liveEnabled: config.liveEnabled,
      model: config.model,
    }),
  };
}

function configuredTelegram(
  workspace: WorkspaceAppOptions | null,
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
    return {
      webhookSecret: telegram.webhookSecret,
      inbound: createTelegramInboundService({
        adapter,
        eventRepository: createTelegramEventRepository(
          createSupabaseTelegramEventDataSource(client),
        ),
        workspaceId: workspace.workspaceId,
        workspaceRepository: workspace.repository,
      }),
      outbound: createTelegramOutboundService({
        adapter,
        deliveryRepository: createTelegramDeliveryRepository(
          createSupabaseTelegramDeliveryDataSource(client),
        ),
        liveEnabled: telegram.liveEnabled,
        workspaceId: workspace.workspaceId,
        workspaceRepository: workspace.repository,
      }),
    };
  } catch {
    return null;
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
    agent = configuredAgent(),
    agentTimeoutMs = 45_000,
    judge = configuredJudge(),
    rateLimit = { requests: 20, windowMs: 60_000 },
    requestTimeoutMs = 30_000,
    now = Date.now,
    workspace = configuredWorkspace(),
  } = options;
  const telegram =
    options.telegram === undefined
      ? configuredTelegram(workspace)
      : options.telegram;
  const evalService =
    options.eval === undefined
      ? configuredEval(workspace, agent, judge, now)
      : options.eval;
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));
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
        response.status(200).json(await telegram.inbound.process(request.body));
      } catch (error) {
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
  const isProduction = process.env.NODE_ENV === "production";
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

  const port = Number(process.env.PORT || 5173);
  app.listen(port, () => {
    console.log(`KaunterAI listening on http://localhost:${port}`);
  });
}

const directRun =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (directRun) {
  await startServer();
}
