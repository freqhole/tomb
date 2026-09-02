import type { Page } from "@playwright/test";

/** reads the player's node id via the settings panel (not shown on the main page). */
export async function getPlayerNodeId(page: Page): Promise<string> {
  await page.getByTestId("settings-toggle").click();
  const nodeId = await page.getByTestId("settings-node-id").textContent({ timeout: 15_000 });
  await page.getByTestId("settings-close").click();
  if (!nodeId) throw new Error("player node id did not render in settings");
  return nodeId;
}
