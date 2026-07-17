import { expect, test } from "@playwright/test";

import {
  expectMobileTargets,
  expectNoDocumentOverflow,
  expectNoDocumentVerticalScroll,
  expectNoSeriousAxeViolations,
  resetE2eWorkspace,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetE2eWorkspace(page);
  await page.addInitScript(() => {
    localStorage.clear();
  });
});

test("Chat Control satisfies its responsive workbench contract", async ({
  page,
}, testInfo) => {
  const runtimeErrors: string[] = [];
  const requestedUrls: string[] = [];
  page.on("request", (request) => requestedUrls.push(request.url()));
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Chat Control" })).toBeVisible();

  const mobile = testInfo.project.name !== "desktop-1440";
  await expect(
    page.getByText(mobile ? "Demo" : "Synthetic Demo", { exact: true }).first(),
  ).toBeVisible();
  const firstQueueRow = page.getByRole("button", {
    name: "Open conversation with Ahmad bin Hassan",
  });
  expect(Math.round((await firstQueueRow.boundingBox())?.height ?? 0)).toBeLessThanOrEqual(68);
  await expectNoDocumentOverflow(page);
  await expectNoDocumentVerticalScroll(page);
  await expectNoSeriousAxeViolations(page);

  if (mobile) {
    await expect(page.getByRole("region", { name: "Conversation queue" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Selected conversation" })).toHaveCount(0);
    await expectMobileTargets(page);
    await page.screenshot({
      fullPage: true,
      path: `test-results/screenshots/chat-${testInfo.project.name}-list.png`,
    });

    await page
      .getByRole("button", { name: "Open conversation with Ahmad bin Hassan" })
      .click();
    await expect(page.getByRole("region", { name: "Selected conversation" })).toBeVisible();
    await expect(page.getByLabel("Autonomous agent handling")).toBeVisible();
    expect(
      await page
        .getByRole("button", { name: "Send", exact: true })
        .evaluate((element) => window.getComputedStyle(element).borderRadius),
    ).toBe("8px");
    await expectMobileTargets(page);
    await expectNoDocumentOverflow(page);
    await expectNoDocumentVerticalScroll(page);
    await page.screenshot({
      fullPage: true,
      path: `test-results/screenshots/chat-${testInfo.project.name}-thread.png`,
    });

    await page.getByRole("button", { name: "Details" }).click();
    await expect(page.getByRole("complementary", { name: "Patient context" })).toBeVisible();
    await expectMobileTargets(page);
    await expectNoDocumentOverflow(page);
    await page.getByRole("button", { name: "Close details" }).click();
    await page.getByRole("button", { name: "Back to queue" }).click();
  } else {
    await expect(page.getByRole("region", { name: "Conversation queue" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Selected conversation" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Patient context" })).toBeVisible();
    const navBox = await page.getByRole("link", { name: "Chat Control" }).boundingBox();
    const demoBox = await page.locator(".app-shell__demo").boundingBox();
    const resetBox = await page.getByRole("button", { name: "Reset Demo" }).boundingBox();
    expect(Math.round(navBox?.height ?? 0)).toBe(Math.round(demoBox?.height ?? 0));
    expect(Math.round(demoBox?.height ?? 0)).toBe(Math.round(resetBox?.height ?? 0));
    expect(
      await page
        .getByRole("button", { name: "Send", exact: true })
        .evaluate((element) => window.getComputedStyle(element).borderRadius),
    ).toBe("8px");
    const threadBox = await page.getByRole("region", { name: "Selected conversation" }).boundingBox();
    const incomingBubble = page.locator(".message-row--incoming .message-bubble").first();
    const outgoingBubble = page.locator(".message-row--outgoing .message-bubble").first();
    const incomingBox = await incomingBubble.boundingBox();
    const outgoingBox = await outgoingBubble.boundingBox();
    expect((incomingBox?.x ?? 0) - (threadBox?.x ?? 0)).toBeLessThanOrEqual(64);
    expect(
      (threadBox?.x ?? 0) +
        (threadBox?.width ?? 0) -
        ((outgoingBox?.x ?? 0) + (outgoingBox?.width ?? 0)),
    ).toBeLessThanOrEqual(64);
    expect(await incomingBubble.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
      await outgoingBubble.evaluate((element) => getComputedStyle(element).backgroundColor),
    );
    await page.screenshot({
      fullPage: true,
      path: "test-results/screenshots/chat-desktop-1440.png",
    });
    await page
      .getByRole("button", { name: "Open conversation with Mei Lin Tan" })
      .click();
    await expect(page.getByText("我想续开降压药。", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Voice transcript")).toBeVisible();
    await page.screenshot({
      fullPage: true,
      path: "test-results/screenshots/chat-desktop-mandarin.png",
    });
    await page
      .getByRole("button", { name: "Open conversation with Nurul Aisyah" })
      .click();
    const patientContext = page.getByRole("complementary", {
      name: "Patient context",
    });
    await expect(patientContext.getByRole("button", { name: "Approve booking" })).toHaveCount(0);
    await expect(patientContext.getByRole("button", { name: "Reject booking" })).toHaveCount(0);
    await expect(patientContext.getByLabel("Booking status timeline")).toContainText("Requested");
    await expect(patientContext.getByLabel("Booking status timeline")).toContainText(
      "Availability checked",
    );
    await page.getByRole("button", { name: "Generate draft" }).click();
    await expect(page.getByText("Autonomous action trace")).toBeVisible();
    await expect(
      page.getByText(
        "Completed: Checked demo availability; waiting for the patient's preferred date and time.",
      ),
    ).toBeVisible();
  }

  if (mobile) {
    await page.getByRole("button", { name: "More chat actions" }).click();
    await page.getByRole("menuitemradio", { name: "Schedule" }).click();
  } else {
    await page.getByRole("tab", { name: "Schedule" }).click();
  }
  await expect(
    page.getByRole("region", {
      name: mobile ? "Synthetic schedule" : "Appointment schedule",
    }),
  ).toBeVisible();
  await expectNoDocumentOverflow(page);
  if (!mobile) {
    await page.getByRole("button", { name: "Edit booking for Nurul Aisyah" }).click();
    await expect(page.getByRole("dialog", { name: "Edit booking" })).toBeVisible();
    await page.screenshot({
      fullPage: true,
      path: "test-results/screenshots/chat-desktop-booking-dialog.png",
    });
    await page.getByRole("button", { name: "Cancel" }).click();
  }
  await page.getByRole("button", { name: "Open conversation with Nurul Aisyah" }).click();
  if (mobile) {
    await expect(page.getByRole("region", { name: "Selected conversation" })).toBeVisible();
  } else {
    await expect(page.getByRole("tab", { name: "Inbox" })).toHaveAttribute("aria-selected", "true");
  }
  expect(
    requestedUrls.filter((url) =>
      /\/src\/routes\/(?:dream|eval)\/|react-codemirror|recharts|tanstack/i.test(url),
    ),
  ).toEqual([]);
  await expect(runtimeErrors).toEqual([]);
});

test("a synthetic conversation can reset without resetting the demo", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "This control is verified once on desktop.");

  await page.goto("/");
  await page.getByRole("textbox", { name: "Message" }).fill("Temporary staff reply");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByLabel("Conversation messages")).toContainText("Temporary staff reply");

  await page.getByRole("button", { name: "Reset this chat" }).click();
  await page
    .getByRole("button", { name: "Reset this synthetic conversation" })
    .click();

  await expect(page.getByLabel("Conversation messages")).not.toContainText("Temporary staff reply");
  await expectNoDocumentVerticalScroll(page);
});

test("the transcript scrolls inside the chat workbench instead of moving the page", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "This layout contract is verified once on desktop.");

  await page.setViewportSize({ width: 1440, height: 520 });
  await page.goto("/");

  const transcript = page.getByLabel("Conversation messages");
  await expect(transcript).toBeVisible();
  await expect(page.getByLabel("Message composer")).toBeVisible();
  expect(await transcript.evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto");
  await expectNoDocumentVerticalScroll(page);
});
