import { test, expect } from "@playwright/test";

// basic smoke test: page loads, node initializes, node id + pairing pin render.
test("player page boots a midden node and shows pairing info", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("node-id")).toHaveText(/^[0-9a-f]{64}$/, { timeout: 15_000 });
  await expect(page.getByTestId("pairing-pin")).toHaveText(/^[0-9a-f]{6}$/);
  await expect(page.getByTestId("pairing-qr")).toBeVisible();
});
