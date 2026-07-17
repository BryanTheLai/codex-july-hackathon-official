import { expect, test } from "@playwright/test";

import {
  expectMobileTargets,
  expectNoDocumentOverflow,
  expectNoSeriousAxeViolations,
  resetE2eWorkspace,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetE2eWorkspace(page);
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
  await expect(page.getByText("Combined symptoms need chemical wash", { exact: true })).toBeVisible();

  const mobile = testInfo.project.name !== "desktop-1440";
  if (mobile) {
    await expect(page.getByRole("table", { name: "Evaluation cases" })).toHaveCount(0);
    const firstCard = page.getByRole("article", { name: "Combined symptoms need chemical wash" });
    await expect(firstCard).toBeVisible();
    const cardBox = await firstCard.boundingBox();
    expect(cardBox).not.toBeNull();
    expect((cardBox?.y ?? 0) + (cardBox?.height ?? 0)).toBeLessThanOrEqual(
      testInfo.project.name === "mobile-320" ? 568 : 844,
    );
    await expectMobileTargets(page);
  } else {
    await expect(page.getByRole("table", { name: "Evaluation cases" })).toBeVisible();
    const supportRail = page.getByRole("complementary", { name: "Evaluation support" });
    await expect(supportRail).toBeVisible();
    expect(Math.round((await supportRail.boundingBox())?.width ?? 0)).toBe(280);
    await expect(supportRail.getByRole("region", { name: "Evaluation summary" })).toBeVisible();
    await expect(supportRail.getByRole("region", { name: "Suite history" })).toBeVisible();
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
    await page.locator(".eval-split .glossary-term__trigger").first().hover();
    const tooltip = page.getByRole("tooltip", {
      name: /failure here can produce a reviewable knowledge sop proposal/i,
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

  await page.getByRole("button", { name: "Run Combined symptoms need chemical wash" }).click();
  const emergencySurface = mobile
    ? page.getByRole("article", { name: "Combined symptoms need chemical wash" })
    : page.getByRole("row", { name: /Combined symptoms need chemical wash/i });
  await expect(emergencySurface.getByText("Fail", { exact: true })).toBeVisible();
  await emergencySurface.click();
  const firstRunDetails = page.getByRole("dialog", { name: "Case details" });
  await expect(firstRunDetails.getByText("Agent reply", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close case details" }).click();

  await page.getByRole("button", { name: "Run all cases" }).click();
  if (mobile) {
    const cancelSuite = page.getByRole("button", { name: "Cancel active suite operation" });
    await expect(cancelSuite).toBeVisible();
    const cancelBox = await cancelSuite.boundingBox();
    expect(cancelBox?.height).toBeGreaterThanOrEqual(44);
  }

  await expect(page.getByRole("button", { name: "Run all cases" })).toBeVisible();

  if (mobile) {
    await page.getByRole("button", { name: "More evaluation actions" }).click();
    await page.getByRole("menuitem", { name: "History" }).click();
    const historyDrawer = page.getByRole("complementary", { name: "Evaluation history" });
    await expect(historyDrawer).toBeVisible();
    await expect(historyDrawer.getByRole("region", { name: "Suite history" })).not.toContainText(
      "Run all cases to create history.",
    );
    await expectMobileTargets(page);
    await page.getByRole("button", { name: "Close history" }).click();
  } else {
    const supportRail = page.getByRole("complementary", { name: "Evaluation support" });
    await expect(supportRail.getByRole("region", { name: "Suite history" })).not.toContainText(
      "Run all cases to create history.",
    );
  }
  if (mobile) {
    await page.getByRole("article", { name: "Combined symptoms need chemical wash" }).click();
  } else {
    await page.getByRole("row", { name: /Combined symptoms need chemical wash/i }).click();
  }

  const caseEvidence = page.getByRole("dialog", { name: "Case details" });
  await expect(caseEvidence).toBeVisible();
  await expect(caseEvidence.getByText("Staff-approved reply", { exact: true })).toBeVisible();
  await caseEvidence.getByText("Run details", { exact: true }).click();
  await expect(caseEvidence.getByText("Simulated", { exact: true })).toBeVisible();
  if (mobile) {
    await expectMobileTargets(page);
  }
  await page.getByRole("button", { name: "Close case details" }).click();

  await page.getByRole("button", { name: "New manual test" }).click();
  await expect(page.getByRole("dialog", { name: "New manual test" })).toBeVisible();
  if (mobile) {
    await expectMobileTargets(page);
  }
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  if (mobile) {
    await page.getByRole("button", { name: "More evaluation actions" }).click();
    await page.getByRole("menuitem", { name: "Import resolved conversations" }).click();
    const importDialog = page.getByRole("dialog", { name: "Import resolved conversations" });
    await expect(importDialog.getByRole("combobox")).toHaveCount(0);
    await expect(importDialog.getByRole("checkbox", { name: /Mei Demo, Ready/ })).toBeEnabled();
    await expect(
      importDialog.getByRole("checkbox", { name: /Aina Demo, Resolve in Chat/ }),
    ).toBeDisabled();
    await expectNoSeriousAxeViolations(page);
    await expectMobileTargets(page);
    await page.screenshot({
      fullPage: true,
      path: `test-results/screenshots/eval-${testInfo.project.name}-import.png`,
    });
    await importDialog.getByRole("checkbox", { name: /Mei Demo, Ready/ }).click();
    await importDialog.getByRole("button", { name: "Import 1 conversation" }).click();
    await expect(page.getByRole("dialog", { name: "Case details" })).toContainText(
      "HITL Mei Demo",
    );
    await page.getByRole("button", { name: "Close case details" }).click();

    await page.getByRole("button", { name: "More evaluation actions" }).click();
    await page.getByRole("menuitem", { name: "Import resolved conversations" }).click();
    const reopenedImport = page.getByRole("dialog", { name: "Import resolved conversations" });
    await expect(
      reopenedImport.getByRole("checkbox", { name: /Mei Demo, Already imported/ }),
    ).toBeDisabled();
    await reopenedImport.getByRole("button", { name: "Cancel", exact: true }).click();
  }

  await page.getByRole("button", { name: "Analyze failures" }).click();
  const analysis = page.getByRole("complementary", { name: "Analyze failures" });
  await expect(analysis).toContainText(
    "The configured correction proposer creates one reviewable SOP diff from committed train failures. It never reruns, activates, or improves the agent on its own.",
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
