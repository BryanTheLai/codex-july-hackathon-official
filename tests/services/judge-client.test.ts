import { describe, expect, it, vi } from "vitest";

import type { JudgeRequest, JudgeResponse } from "../../src/contracts/judge";
import {
  createHttpJudgeClient,
  JudgeClientError,
} from "../../src/services/judge-client";

const request: JudgeRequest = {
  runId: "client-run-1",
  datasetId: "dataset-aircon-ops",
  caseId: "case-aircon-confirm-train",
  caseType: "booking",
  language: "Malay",
  candidateVersion: 1,
  conversation: [{ role: "patient", text: "Saya mahu buat temujanji." }],
  candidateResponse: "We received your request and will confirm the slot.",
  expectedResponse: "Confirm the next available appointment slot.",
  rubrics: [
    {
      id: "crit-aircon-confirm",
      label: "Booking next step",
      instruction: "Explain the next booking step without inventing a confirmed slot.",
      required: true,
      version: 1,
    },
  ],
};

const judgeResponse: JudgeResponse = {
  overallVerdict: "pass",
  judgeScore: 0.9,
  rationale: "The reply gives the next step.",
  criterionResults: [
    {
      criterionId: "crit-aircon-confirm",
      verdict: "pass",
      reason: "The reply says confirmation is still pending.",
      evidence: "will confirm the slot",
    },
  ],
  metadata: {
    provider: "openai",
    model: "gpt-5.6-luna",
    promptVersion: "2026-07-12.1",
    rubricVersions: { "crit-aircon-confirm": 1 },
    runId: "client-run-1",
    latencyMs: 20,
    simulated: false,
  },
};

describe("HTTP judge client", () => {
  it("posts a bounded request and validates the response", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(judgeResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createHttpJudgeClient(fetcher);

    const result = await client.judge(request);

    expect(result).toEqual(judgeResponse);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/judge",
      expect.objectContaining({
        body: JSON.stringify(request),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
  });

  it("maps typed server errors without exposing response bodies", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "feature_disabled",
          error: "The live LLM judge is not configured on this server.",
          retryable: false,
        }),
        {
          status: 503,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const client = createHttpJudgeClient(fetcher);

    await expect(client.judge(request)).rejects.toMatchObject({
      code: "feature_disabled",
      message: "The live LLM judge is not configured on this server.",
      retryable: false,
    });
  });

  it("rejects malformed success responses", async () => {
    const client = createHttpJudgeClient(
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ overallVerdict: "pass" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const error = await client.judge(request).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(JudgeClientError);
    expect(error).toMatchObject({
      code: "provider_failed",
      retryable: true,
    });
  });

  it("maps malformed server error bodies to a bounded provider failure", async () => {
    const client = createHttpJudgeClient(
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ provider: "private detail" }), {
          status: 502,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(client.judge(request)).rejects.toMatchObject({
      code: "provider_failed",
      message: "The judge request failed.",
      retryable: true,
    });
  });

  it("preserves runtime-neutral abort errors", async () => {
    const abortError = new Error("Aborted");
    abortError.name = "AbortError";
    const client = createHttpJudgeClient(vi.fn().mockRejectedValue(abortError));

    await expect(client.judge(request)).rejects.toBe(abortError);
  });
});
