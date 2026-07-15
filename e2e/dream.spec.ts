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

test("Dream satisfies its responsive review workbench contract", async ({ page }, testInfo) => {
  const runtimeErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await page.goto("/dream");
  await expect(page.getByRole("heading", { name: "Dream" })).toBeVisible();
  const mobile = testInfo.project.name !== "desktop-1440";
  const explorerActionBoxes = await Promise.all(
    ["New playbook file", "New playbook folder", "Collapse playbook folders"].map((name) =>
      page.getByRole("button", { name }).boundingBox(),
    ),
  );
  expect(new Set(explorerActionBoxes.map((box) => Math.round(box?.y ?? 0))).size).toBe(1);

  if (mobile) {
    await expect(page.getByRole("navigation", { name: "Playbook files" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Playbook editor" })).toHaveCount(0);
    await expectMobileTargets(page);
    await page.getByRole("treeitem", { name: /triage\.md/i }).click();
  } else {
    const files = page.getByRole("navigation", { name: "Playbook files" });
    const changes = page.getByRole("complementary", { name: "Proposed changes" });
    await expect(files).toBeVisible();
    await expect(page.getByRole("region", { name: "Playbook editor", exact: true })).toBeVisible();
    await expect(changes).toBeVisible();
    expect(Math.round((await files.boundingBox())?.width ?? 0)).toBe(230);
    expect(Math.round((await changes.boundingBox())?.width ?? 0)).toBe(320);
  }

  const editor = page.getByRole("textbox", { name: "Playbook Markdown editor" });
  await expect(editor).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).toHaveCount(1);
  await expect(editor).toContainText("Seek urgent care for chest pain.");
  await expect(page.locator(".cm-correction-preview")).toContainText(
    "- Seek urgent care for chest pain.",
  );
  await expect(page.locator(".cm-correction-preview")).toContainText("+ Call 999 guidance");
  await expect(page.locator(".cm-correction-preview")).not.toContainText("- remove");
  await expect(page.locator(".cm-correction-preview")).not.toContainText("+ add");

  await expectNoDocumentOverflow(page);
  await expectNoSeriousAxeViolations(page);
  await page.screenshot({
    fullPage: true,
    path: `test-results/screenshots/dream-${testInfo.project.name}.png`,
  });

  const content = await editor.textContent();
  await editor.fill(`${content ?? ""}\nDocument escalation context.`);
  await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();

  if (mobile) {
    await page.getByRole("tab", { name: "Changes" }).click();
  }
  const changes = page.getByRole("complementary", { name: "Proposed changes" });
  await expect(changes).not.toContainText("- remove");
  await expect(changes).not.toContainText("+ add");
  await expect(changes.getByRole("button", { name: "Approve correction" })).toBeDisabled();
  if (testInfo.project.name === "mobile-320") {
    const rejectBox = await changes.getByRole("button", { name: "Reject correction" }).boundingBox();
    const approveBox = await changes.getByRole("button", { name: "Approve correction" }).boundingBox();
    expect(Math.round(rejectBox?.y ?? 0)).toBe(Math.round(approveBox?.y ?? 0));
  }

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Inactive candidate", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Discard candidate" }).click();
  await expect(page.getByText("Inactive candidate", { exact: true })).toHaveCount(0);
  await expect(changes.getByRole("button", { name: "Approve correction" })).toBeEnabled();
  await changes.getByRole("button", { name: "Approve correction" }).click();
  await expect(changes).toContainText("approved");
  await expect(
    changes.getByRole("button", { name: /Focus correction at line \d+/ }),
  ).toBeEnabled();

  await page.getByRole("button", { name: "Test Changes" }).click();
  const dock = page.getByRole("region", { name: "Test Changes results" });
  await expect(dock).toContainText("Preparing saved-text verification");
  await expect(dock).toContainText("1 passed");
  await expect(dock).toContainText("Evaluation Lab scores stay separate");
  await expect(dock).toContainText("Before");
  await expect(dock).toContainText("After");
  await expect(dock).toContainText(/Saved line \d+ matches the approved text\./);
  await expect(dock.getByRole("button", { name: "Eval dataset" })).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: `test-results/screenshots/dream-${testInfo.project.name}-test-changes.png`,
  });

  await page.getByRole("button", { name: "More file actions" }).click();
  await page.getByRole("menuitem", { name: "New File" }).click();
  await expect(page.getByRole("dialog", { name: "New playbook file" })).toBeVisible();
  await page.getByLabel("File title").fill("Follow-up guide");
  await expect(page.getByLabel("File name")).toHaveValue("follow-up-guide.md");
  await page.screenshot({
    fullPage: true,
    path: `test-results/screenshots/dream-${testInfo.project.name}-new-file.png`,
  });
  if (mobile) {
    await expectMobileTargets(page);
  }
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await expectNoDocumentOverflow(page);
  await expectNoSeriousAxeViolations(page);
  await expect(runtimeErrors).toEqual([]);
});
