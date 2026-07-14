import type { ApiErrorCode } from "../contracts/api";
import { API_ERROR_CODES, apiErrorSchema } from "../contracts/api";
import type { JudgeClient as JudgeClientContract } from "../contracts/judge";
import {
  judgeRequestSchema,
  judgeResponseSchema,
} from "../contracts/judge";
import { isAbortError } from "../shared/errors";

export type { JudgeClient } from "../contracts/judge";

export const JUDGE_CLIENT_ERROR_CODES = API_ERROR_CODES;

export type JudgeClientErrorCode = ApiErrorCode;

export class JudgeClientError extends Error {
  readonly code: JudgeClientErrorCode;
  readonly retryable: boolean;

  constructor(code: JudgeClientErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = "JudgeClientError";
    this.code = code;
    this.retryable = retryable;
  }
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createHttpJudgeClient(fetcher: Fetcher = fetch): JudgeClientContract {
  return {
    async judge(request, signal) {
      const boundedRequest = judgeRequestSchema.parse(request);
      let response: Response;
      try {
        response = await fetcher("/api/judge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(boundedRequest),
          signal,
        });
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        throw new JudgeClientError(
          "provider_failed",
          "The judge server could not be reached.",
          true,
        );
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new JudgeClientError(
          "provider_failed",
          "The judge server returned an unreadable response.",
          true,
        );
      }

      if (!response.ok) {
        const parsedError = apiErrorSchema.safeParse(body);
        if (parsedError.success) {
          const error = parsedError.data;
          throw new JudgeClientError(error.code, error.error, error.retryable);
        }
        throw new JudgeClientError(
          "provider_failed",
          "The judge request failed.",
          response.status === 429 || response.status >= 500,
        );
      }

      const parsed = judgeResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw new JudgeClientError(
          "provider_failed",
          "The judge server returned invalid structured evidence.",
          true,
        );
      }
      return parsed.data;
    },
  };
}
