import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { JudgeRequest, JudgeResponse } from "../../server/judge-contract";
import { createJudgeApp } from "../../server/index";

const servers: Array<ReturnType<ReturnType<typeof createJudgeApp>["listen"]>> = [];

function request(): JudgeRequest {
  return {
    runId: "run-endpoint-1",
    datasetId: "dataset-aircon-ops",
    caseId: "case-aircon-confirm-train",
    caseType: "booking",
    language: "English",
    candidateVersion: 1,
    conversation: [{ role: "patient", text: "I need an appointment." }],
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
}

function response(): JudgeResponse {
  return {
    overallVerdict: "pass",
    judgeScore: 0.9,
    rationale: "The reply gives a grounded booking next step.",
    criterionResults: [
      {
        criterionId: "crit-aircon-confirm",
        verdict: "pass",
        reason: "The candidate says the slot still needs confirmation.",
        evidence: "will confirm the slot",
      },
    ],
    metadata: {
      provider: "openai",
      model: "gpt-5.6-luna",
      promptVersion: "2026-07-12.1",
      rubricVersions: { "crit-aircon-confirm": 1 },
      runId: "run-endpoint-1",
      latencyMs: 25,
      simulated: false,
    },
  };
}

async function start(options?: Parameters<typeof createJudgeApp>[0]) {
  const app = createJudgeApp(options);
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
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

describe("judge endpoint", () => {
  it("validates the request before calling the provider", async () => {
    const judge = vi.fn();
    const baseUrl = await start({ judge });

    const result = await fetch(`${baseUrl}/api/judge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "missing-fields" }),
    });

    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({
      code: "invalid_request",
      error: "Judge request is invalid.",
      retryable: false,
    });
    expect(judge).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON through the shared error contract", async () => {
    const judge = vi.fn();
    const baseUrl = await start({ judge });

    const result = await fetch(`${baseUrl}/api/judge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({
      code: "invalid_request",
      error: "Judge request is invalid.",
      retryable: false,
    });
    expect(judge).not.toHaveBeenCalled();
  });

  it("returns the validated judge result", async () => {
    const judge = vi.fn().mockResolvedValue(response());
    const baseUrl = await start({ judge });

    const result = await fetch(`${baseUrl}/api/judge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request()),
    });

    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(response());
    expect(judge).toHaveBeenCalledOnce();
  });

  it("returns a clear error when the live judge is not configured", async () => {
    vi.stubEnv("LLM_API_KEY", "");
    const baseUrl = await start();

    const result = await fetch(`${baseUrl}/api/judge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request()),
    });

    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({
      code: "feature_disabled",
      error: "The live LLM judge is not configured on this server.",
      retryable: false,
    });
  });

  it("rate limits repeated requests", async () => {
    const baseUrl = await start({
      judge: vi.fn().mockResolvedValue(response()),
      rateLimit: { requests: 1, windowMs: 60_000 },
    });
    const send = () =>
      fetch(`${baseUrl}/api/judge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request()),
      });

    expect((await send()).status).toBe(200);
    const limited = await send();
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({
      code: "provider_failed",
      retryable: true,
    });
  });

  it("maps provider timeouts to the shared error contract", async () => {
    const judge = vi.fn(
      (_request: JudgeRequest, signal?: AbortSignal) =>
        new Promise<JudgeResponse>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    const baseUrl = await start({ judge, requestTimeoutMs: 5 });

    const result = await fetch(`${baseUrl}/api/judge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request()),
    });

    expect(result.status).toBe(504);
    expect(await result.json()).toEqual({
      code: "provider_timeout",
      error: "The judge request timed out.",
      retryable: true,
    });
  });

  it("rejects invalid provider evidence through the shared error contract", async () => {
    const judge = vi.fn().mockResolvedValue({ overallVerdict: "pass" });
    const baseUrl = await start({ judge });

    const result = await fetch(`${baseUrl}/api/judge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request()),
    });

    expect(result.status).toBe(502);
    expect(await result.json()).toEqual({
      code: "provider_failed",
      error: "The model provider returned invalid judge evidence. Retry the run; if it repeats, check the judge model configuration.",
      retryable: true,
    });
  });

  it("maps provider failures without exposing provider details", async () => {
    const judge = vi.fn().mockRejectedValue(new Error("private provider detail"));
    const baseUrl = await start({ judge });

    const result = await fetch(`${baseUrl}/api/judge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request()),
    });

    expect(result.status).toBe(502);
    expect(await result.json()).toEqual({
      code: "provider_failed",
      error: "The model provider did not return a judge result. Retry the run; if it repeats, check the judge model configuration.",
      retryable: true,
    });
  });

  it("rejects request bodies above the endpoint limit", async () => {
    const judge = vi.fn();
    const baseUrl = await start({ judge });

    const result = await fetch(`${baseUrl}/api/judge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ oversized: "x".repeat(70_000) }),
    });

    expect(result.status).toBe(413);
    expect(await result.json()).toEqual({
      code: "invalid_request",
      error: "Judge request exceeds the 64 KiB limit.",
      retryable: false,
    });
    expect(judge).not.toHaveBeenCalled();
  });
});
