import { expect, test } from "@playwright/test";

import {
  expectNoDocumentOverflow,
  resetE2eWorkspace,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetE2eWorkspace(page);
  await page.addInitScript(() => {
    localStorage.clear();
  });
});

test("Chat HITL evidence reaches human-approved Knowledge text verification", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "Cross-route flow runs once on desktop.");
  const runtimeErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await page.goto("/");
  await page.getByRole("button", { name: "Open conversation with Aina Demo" }).click();
  await page.getByRole("textbox", { name: "Message" }).fill(
    "Bring your identity card fifteen minutes before arrival.",
  );
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page
      .getByLabel("Conversation messages")
      .getByText("Bring your identity card fifteen minutes before arrival."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await page.getByRole("button", { name: "Resolve conversation" }).click();
  await page.getByRole("button", { name: "Add resolved conversation to Evals" }).click();
  const importDialog = page.getByRole("dialog", { name: "Import resolved conversations" });
  await expect(
    importDialog.getByRole("checkbox", { name: /Aina Demo, Ready/ }),
  ).toBeChecked();
  await importDialog.getByRole("button", { name: "Import 1 conversation" }).click();

  let evidence = page.getByRole("dialog", { name: "Case details" });
  await expect(evidence).toContainText("HITL Aina Demo");
  await expect(evidence).toContainText("The agent never sees this reply during replay.");
  await evidence.getByRole("button", { name: "Run case" }).click();
  await expect(evidence).toContainText("Fail");
  await evidence.getByRole("button", { name: "Close case details" }).click();

  await page.getByRole("button", { name: "Analyze failures" }).click();
  const analysis = page.getByRole("complementary", { name: "Analyze failures" });
  await expect(analysis).toContainText("HITL Aina Demo");
  await analysis.getByRole("button", { name: "Start analysis" }).click();
  await expect(analysis).toContainText("Analysis complete.");
  await analysis.getByRole("button", { name: "Close analysis" }).click();

  await page.getByRole("row", { name: /HITL Aina Demo/ }).click();
  evidence = page.getByRole("dialog", { name: "Case details" });
  const linkedCorrection = evidence.locator(".eval-linked-correction");
  await expect(linkedCorrection).toContainText("pending");
  await expect(evidence).toContainText(
    "This case produced review evidence, not an active playbook change.",
  );
  await linkedCorrection.click();

  await expect(page.getByRole("heading", { name: "Knowledge" })).toBeVisible();
  const focusedCorrection = page.locator(".knowledge-correction--focused");
  await expect(focusedCorrection).toContainText("pending");
  const proposedText = (await focusedCorrection.locator(".knowledge-diff--new code").textContent())
    ?.replace(/^\+\s*/, "") ?? "";
  await focusedCorrection.getByRole("button", { name: "Approve correction" }).click();
  await expect(focusedCorrection).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Proposed changes" })).toHaveCount(0);
  await expect(page.locator(".cm-correction-gutter--approved")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Playbook Markdown editor" })).toContainText(
    proposedText,
  );

  await page.getByRole("button", { name: "Check saved text" }).click();
  const dock = page.getByRole("region", { name: "Saved text check results" });
  await expect(dock).toContainText("1 passed");
  await expect(dock).toContainText("Evaluation Lab scores stay separate");
  await expectNoDocumentOverflow(page);
  expect(runtimeErrors).toEqual([]);
});

test("mobile cross-route workbenches restore their last focused pane", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "desktop-1440", "Mobile pane restoration only.");

  await page.goto("/");
  await page.getByRole("button", { name: "Open conversation with Aina Demo" }).click();
  await page.getByRole("button", { name: "Details" }).click();
  await page.getByRole("button", { name: "Open routed playbook" }).click();

  await expect(page.getByRole("heading", { name: "Knowledge" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Editor" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("link", { name: "Chat Control" }).click();
  await expect(page.getByRole("complementary", { name: "Customer context" })).toBeVisible();

  await page.getByRole("button", { name: "Reset Demo" }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Customer context" })).toBeVisible();
  await page.getByRole("button", { name: "Reset Demo" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("region", { name: "Conversation queue" })).toBeVisible();

  await page.goto("/knowledge?correction=corr-aircon-selection");
  await expect(page.getByRole("tab", { name: "Changes" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Eval case case-aircon-selection-train" }).click();
  await expect(page.getByRole("dialog", { name: "Case details" })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("tab", { name: "Changes" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".knowledge-correction--focused")).toContainText(
    "If a wall-mounted 1.0-1.5 HP unit has both poor cooling and a musty smell, recommend the RM160 chemical wash. Do not quote the RM99 general service.",
  );
});
