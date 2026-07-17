import { expect, test } from "@playwright/test";

import { createCanonicalServerState } from "../src/domain";
import { resetE2eWorkspace } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetE2eWorkspace(page);
  await page.addInitScript(() => {
    localStorage.clear();
  });
});

test("visitor generates an editable Knowledge-grounded draft without sending", async ({
  page,
}) => {
  const state = await createCanonicalServerState();
  const conversation = state.conversations[0];
  if (!conversation) {
    throw new Error("Canonical state is missing a conversation");
  }
  let agentRequest: unknown;
  let outboundRequests = 0;
  await page.route("**/api/workspace/state", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({
        workspaceId: "demo",
        revision: 4,
        state,
      }),
    });
  });
  await page.route("**/api/agent/runs", async (route) => {
    agentRequest = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({
        runId: "agent-run-e2e",
        draft: {
          englishText:
            "Based on the playbook, general service is RM99 per unit.",
          patientLanguage: "English",
          patientText: "General service is RM99 per unit.",
        },
        proposedAction: "reply",
        handoffReason: null,
        evidence: [
          {
            fileId: "file-aircon-service-selection",
            versionId: "knowledge-v1",
            contentHash:
              "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            excerpt: "Escalate urgent symptoms.",
          },
        ],
        toolCalls: [],
        stopReason: "completed",
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
        },
        latencyMs: 250,
      }),
    });
  });
  await page.route("**/api/outbound/send", async (route) => {
    outboundRequests += 1;
    await route.abort();
  });

  await page.goto("/");
  if ((page.viewportSize()?.width ?? 1440) <= 759) {
    await page
      .getByRole("button", {
        name: "Open conversation with Aina Demo",
      })
      .click();
  }
  const selected = page.getByRole("region", {
    name: "Selected conversation",
  });

  await selected
    .getByRole("button", { name: "Generate draft" })
    .click();

  await expect(selected.getByText("Agent ready")).toBeVisible();
  await expect(
    selected.getByText(
      "Based on the playbook, general service is RM99 per unit.",
    ),
  ).toBeVisible();
  await expect(
    selected.getByText("Escalate urgent symptoms."),
  ).toBeVisible();
  const message = selected.getByRole("textbox", { name: "Message" });
  await expect(message).toHaveValue("General service is RM99 per unit.");
  await message.fill("Edited draft; still not sent.");

  expect(agentRequest).toEqual({
    kind: "manual",
    conversationId: conversation.id,
    expectedConversationRevision: conversation.revision,
  });
  expect(outboundRequests).toBe(0);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
