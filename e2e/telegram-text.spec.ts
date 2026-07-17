import { expect, test } from "@playwright/test";

import {
  createCanonicalServerState,
  linkAcceptedTelegramOutboundText,
  mergeTelegramInboundText,
} from "../src/domain";
import { resetE2eWorkspace } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetE2eWorkspace(page);
  await page.addInitScript(() => {
    localStorage.clear();
  });
});

test("visitor refreshes inbound Telegram text and sends exact approved text", async ({
  page,
}) => {
  const inboundResult = mergeTelegramInboundText(
    await createCanonicalServerState(),
    {
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
    },
  );
  if (!inboundResult.ok) {
    throw new Error(inboundResult.error);
  }
  const linkedResult = linkAcceptedTelegramOutboundText(
    inboundResult.state,
    {
      conversationId: "telegram-conversation:-10042",
      messageId: "telegram-delivery:e2e-send:text",
      text: "Klinik akan menghubungi anda.",
      language: "Malay",
      sentAt: "2026-07-13T12:01:00.000Z",
    },
  );
  if (!linkedResult.ok) {
    throw new Error(linkedResult.error);
  }

  let workspaceLoads = 0;
  let outboundRequest: unknown;
  let outboundAccepted = false;
  await page.route("**/api/workspace/state", async (route) => {
    workspaceLoads += 1;
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({
        workspaceId: "demo",
        revision: outboundAccepted ? 2 : 1,
        state: outboundAccepted ? linkedResult.state : inboundResult.state,
      }),
    });
  });
  await page.route("**/api/outbound/send", async (route) => {
    outboundRequest = route.request().postDataJSON();
    outboundAccepted = true;
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({
        deliveryIds: ["e2e-send"],
        status: "sent",
        text: {
          providerMessageId: "9001",
          acceptedAt: "2026-07-13T12:01:00.000Z",
        },
      }),
    });
  });

  await page.goto("/");
  await page
    .getByRole("button", {
      name: "Open conversation with Aina Zulkifli",
    })
    .click();
  const selected = page.getByRole("region", {
    name: "Selected conversation",
  });
  await expect(
    selected.getByText("Boleh saya buat temujanji?"),
  ).toBeVisible();
  await expect(
    page.getByLabel("Telegram inbox: autonomous agent can reply and manage bookings"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Auto-translate" }),
  ).toHaveCount(0);

  await page
    .getByRole("textbox", { name: "Message" })
    .fill("Klinik akan menghubungi anda.");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await expect(
    page
      .locator('[data-message-side="outgoing"]')
      .getByText("Klinik akan menghubungi anda."),
  ).toBeVisible();
  expect(outboundRequest).toMatchObject({
    requestId: expect.any(String),
    conversationId: "telegram-conversation:-10042",
    expectedConversationRevision: 1,
    targetLanguage: "Malay",
    approvedPatientText: "Klinik akan menghubungi anda.",
    mode: "text",
  });
  expect(workspaceLoads).toBeGreaterThanOrEqual(2);
});
