import { expect, test } from "@playwright/test";

import {
  expectMobileTargets,
  expectNoDocumentOverflow,
  expectNoSeriousAxeViolations,
  installMockEval,
  installMockJudge,
  resetE2eWorkspace,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetE2eWorkspace(page);
  await installMockJudge(page);
  await installMockEval(page);
  await page.addInitScript(() => {
    localStorage.clear();
  });
});

test("Evaluation Lab satisfies its responsive workbench contract", async ({
  page,
}, testInfo) => {
  const runtimeErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await page.goto("/eval");
  await expect(page.getByRole("heading", { name: "Evaluation Lab" })).toBeVisible();
  await expect(page.getByText("Emergency chest pain", { exact: true })).toBeVisible();

  const mobile = testInfo.project.name !== "desktop-1440";
  if (mobile) {
    await expect(page.getByRole("table", { name: "Evaluation cases" })).toHaveCount(0);
    const firstCard = page.getByRole("article", { name: "Emergency chest pain" });
    await expect(firstCard).toBeVisible();
    const cardBox = await firstCard.boundingBox();
    expect(cardBox).not.toBeNull();
    expect((cardBox?.y ?? 0) + (cardBox?.height ?? 0)).toBeLessThanOrEqual(
      testInfo.project.name === "mobile-320" ? 568 : 844,
    );
    await expectMobileTargets(page);
  } else {
    await expect(page.getByRole("table", { name: "Evaluation cases" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Evaluation support" })).toBeVisible();
    const rowHeights = await page
      .getByRole("table", { name: "Evaluation cases" })
      .locator("tbody tr")
      .evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().height)));
    expect(new Set(rowHeights).size).toBe(1);
  }

  await expectNoDocumentOverflow(page);
  await expectNoSeriousAxeViolations(page);
  await page.screenshot({
    fullPage: true,
    path: `test-results/screenshots/eval-${testInfo.project.name}.png`,
  });

  if (!mobile) {
    await page
      .locator("th .glossary-term__trigger")
      .filter({ hasText: "Expected HITL" })
      .hover();
    const tooltip = page.getByRole("tooltip", {
      name: /human-approved reply used only as the grading reference/i,
    });
    await expect(tooltip).toBeVisible();
    const tooltipBox = await tooltip.boundingBox();
    expect(tooltipBox).not.toBeNull();
    expect(tooltipBox?.y ?? -1).toBeGreaterThanOrEqual(0);
    await page.getByRole("heading", { name: "Evaluation Lab" }).hover();
  }

  if (testInfo.project.name === "mobile-320") {
    await page.getByRole("button", { name: "Filters" }).click();
    await expect(page.getByRole("complementary", { name: "Evaluation filters" })).toBeVisible();
    await expectMobileTargets(page);
    await page.getByRole("button", { name: "Close filters" }).click();
  }

  await page.getByRole("button", { name: "Run Emergency chest pain" }).click();
  await expect(page.getByText("Synthetic demo response", { exact: false }).first()).toBeVisible();
  const emergencySurface = mobile
    ? page.getByRole("article", { name: "Emergency chest pain" })
    : page.getByRole("row", { name: /Emergency chest pain/i });
  await expect(emergencySurface.getByText("Fail", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Run Suite" }).click();
  if (mobile) {
    const cancelSuite = page.getByRole("button", { name: "Cancel active suite operation" });
    await expect(cancelSuite).toBeVisible();
    const cancelBox = await cancelSuite.boundingBox();
    expect(cancelBox?.height).toBeGreaterThanOrEqual(44);
  }

  if (mobile) {
    await page.getByRole("button", { name: "History" }).click();
    await expect(page.getByRole("complementary", { name: "Evaluation history" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Suite history" })).not.toContainText(
      "Run the suite to create history.",
    );
    await expectMobileTargets(page);
    await page.getByRole("button", { name: "Close history" }).click();
    await page.getByRole("button", { name: "Emergency chest pain", exact: true }).click();
  } else {
    await expect(page.getByRole("region", { name: "Suite history" })).not.toContainText(
      "Run the suite to create history.",
    );
    await page.getByRole("button", { name: "Emergency chest pain", exact: true }).click();
  }

  const caseEvidence = page.getByRole("complementary", { name: "Case evidence" });
  await expect(caseEvidence).toBeVisible();
  await expect(page.getByText("Expected human HITL", { exact: true }).last()).toBeVisible();
  await caseEvidence.getByText("Judge details", { exact: true }).click();
  await expect(caseEvidence.getByText("Simulated", { exact: true })).toBeVisible();
  if (mobile) {
    await expectMobileTargets(page);
  }
  await page.getByRole("button", { name: "Close case evidence" }).click();

  await page.getByRole("button", { name: "New manual test" }).click();
  await expect(page.getByRole("dialog", { name: "New manual test" })).toBeVisible();
  if (mobile) {
    await expectMobileTargets(page);
  }
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  if (mobile) {
    await page.getByRole("button", { name: "More evaluation actions" }).click();
    await page.getByRole("menuitem", { name: "Import resolved conversations" }).click();
  } else {
    await page.getByRole("button", { name: "Import resolved conversations" }).click();
  }
  const importDialog = page.getByRole("dialog", { name: "Import resolved conversations" });
  await expect(importDialog.getByRole("combobox")).toHaveCount(0);
  await expect(importDialog.getByRole("checkbox", { name: /Rajesh Kumar, Ready/ })).toBeEnabled();
  await expect(
    importDialog.getByRole("checkbox", { name: /Nurul Aisyah, Resolve in Chat/ }),
  ).toBeDisabled();
  await expectNoSeriousAxeViolations(page);
  if (mobile) {
    await expectMobileTargets(page);
  }
  await page.screenshot({
    fullPage: true,
    path: `test-results/screenshots/eval-${testInfo.project.name}-import.png`,
  });
  await importDialog.getByRole("checkbox", { name: /Rajesh Kumar, Ready/ }).click();
  await importDialog.getByRole("button", { name: "Import 1 conversation" }).click();
  await expect(page.getByRole("complementary", { name: "Case evidence" })).toContainText(
    "HITL Rajesh Kumar",
  );
  await page.getByRole("button", { name: "Close case evidence" }).click();

  if (mobile) {
    await page.getByRole("button", { name: "More evaluation actions" }).click();
    await page.getByRole("menuitem", { name: "Import resolved conversations" }).click();
  } else {
    await page.getByRole("button", { name: "Import resolved conversations" }).click();
  }
  const reopenedImport = page.getByRole("dialog", { name: "Import resolved conversations" });
  await expect(
    reopenedImport.getByRole("checkbox", { name: /Rajesh Kumar, Already imported/ }),
  ).toBeDisabled();
  await reopenedImport.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.getByRole("button", { name: "Analyze failures" }).click();
  const analysis = page.getByRole("complementary", { name: "Analyze failures" });
  await expect(analysis).toContainText(
    "A configured LLM proposes one reviewable SOP diff from committed train failures. It never reruns, activates, or improves the agent on its own.",
  );
  await expect(analysis.getByRole("spinbutton")).toHaveCount(0);
  const analysisBox = await analysis.boundingBox();
  expect(analysisBox).not.toBeNull();
  if (mobile) {
    expect(analysisBox?.x).toBe(0);
    expect(analysisBox?.width).toBe(testInfo.project.name === "mobile-320" ? 320 : 390);
    await expectMobileTargets(page);
  } else {
    expect(analysisBox?.width).toBe(520);
  }
  await expect(page.locator(".eval-button--primary:visible")).toHaveCount(1);
  await expectNoSeriousAxeViolations(page);
  await page.getByRole("button", { name: "Close analysis" }).click();

  await expectNoDocumentOverflow(page);
  await expect(runtimeErrors).toEqual([]);
});
