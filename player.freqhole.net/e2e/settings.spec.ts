import { test, expect } from "@playwright/test";
import { getPlayerNodeId } from "./helpers";

// phase 8: pin rotation must invalidate the old pin immediately and make
// the newly-generated one work, driven entirely through the real settings
// panel ui (not the test bridge) - the bridge only drives the *controller*
// side of the p2p handshake.
test("rotating the pairing pin invalidates the old one and accepts the new one @p2p", async ({
  browser,
}) => {
  test.setTimeout(60_000);

  const playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();
  await playerPage.goto("/");

  const nodeId = await getPlayerNodeId(playerPage);

  const oldPin = await playerPage.getByTestId("pairing-pin").textContent();
  if (!oldPin) throw new Error("pairing pin did not render");

  await playerPage.getByTestId("settings-toggle").click();
  await playerPage.getByTestId("rotate-pin-button").click();
  const newPin = await playerPage.getByTestId("settings-pin").textContent();
  if (!newPin) throw new Error("rotated pin did not render");
  expect(newPin).not.toBe(oldPin);
  await playerPage.getByTestId("settings-close").click();

  const controllerContext = await browser.newContext();
  const controllerPage = await controllerContext.newPage();
  await controllerPage.goto("/");
  await controllerPage.waitForFunction(() => typeof window.__playerTest !== "undefined");

  const oldResult = await controllerPage.evaluate(
    async ({ nodeId, oldPin }) =>
      window.__playerTest!.dialAndPair(nodeId, oldPin, "test controller"),
    { nodeId, oldPin },
  );
  expect(oldResult?.ok).toBe(false);

  const newResult = await controllerPage.evaluate(
    async ({ nodeId, newPin }) =>
      window.__playerTest!.dialAndPair(nodeId, newPin, "test controller"),
    { nodeId, newPin },
  );
  expect(newResult?.ok).toBe(true);
});
