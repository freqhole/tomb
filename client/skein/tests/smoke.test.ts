import { expect, test } from "@playwright/test";

test("test harness page loads", async ({ page }) => {
  await page.goto("/test-harness.html");
  const root = page.locator("#canvas-root");
  await expect(root).toBeVisible();
});

test("test harness page has correct title", async ({ page }) => {
  await page.goto("/test-harness.html");
  await expect(page).toHaveTitle("skein test harness");
});
