import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { CalendarDispatchService } from "../../server/calendar-dispatch-service";
import { createJudgeApp } from "../../server/index";

const servers: Array<ReturnType<ReturnType<typeof createJudgeApp>["listen"]>> = [];

async function start(calendar?: CalendarDispatchService) {
  const app = createJudgeApp({
    telegram: {
      webhookSecret: "webhook-secret",
      inbound: { process: async () => ({ ok: true, status: "ignored" }) },
      calendar,
    },
  });
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function postCalendar(baseUrl: string, body: unknown) {
  return fetch(`${baseUrl}/api/calendar-deliveries`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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

describe("calendar delivery endpoint", () => {
  it("returns a typed response when calendar delivery is unavailable", async () => {
    const baseUrl = await start();

    const response = await postCalendar(baseUrl, {});

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: "feature_disabled",
      error: "Calendar delivery is not configured.",
      retryable: false,
    });
  });

  it("validates the request before invoking a configured calendar sender", async () => {
    const send = vi.fn<CalendarDispatchService["send"]>();
    const baseUrl = await start({ send });

    const response = await postCalendar(baseUrl, {});

    expect(response.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
    const health = await fetch(`${baseUrl}/healthz`);
    await expect(health.json()).resolves.toMatchObject({
      configured: { telegramCalendar: true },
    });
  });
});
