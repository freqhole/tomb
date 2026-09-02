import { test, expect } from "@playwright/test";
import { getPlayerNodeId } from "./helpers";

// real two-node p2p pairing handshake: one page is the player-under-test,
// a second page drives a raw midden test peer (window.__playerTest, see
// src/dev/testBridge.ts) that dials the player directly - no mocking.
test("pairing handshake accepts the correct pin and rejects the wrong one @p2p", async ({
  browser,
}) => {
  test.setTimeout(60_000);

  const playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();
  await playerPage.goto("/");

  const nodeId = await getPlayerNodeId(playerPage);

  const controllerContext = await browser.newContext();
  const controllerPage = await controllerContext.newPage();
  await controllerPage.goto("/");
  await controllerPage.waitForFunction(() => typeof window.__playerTest !== "undefined");

  // wrong pin is rejected
  const wrongResult = await controllerPage.evaluate(
    async ({ nodeId }) => window.__playerTest!.dialAndPair(nodeId, "000000", "test controller"),
    { nodeId },
  );
  expect(wrongResult?.ok).toBe(false);
  expect(wrongResult?.reason).toBe("invalid_pin");

  // correct pin is accepted
  const pin = await playerPage.evaluate(() => window.__playerTest!.getPin());
  const correctResult = await controllerPage.evaluate(
    async ({ nodeId, pin }) => window.__playerTest!.dialAndPair(nodeId, pin, "test controller"),
    { nodeId, pin },
  );
  expect(correctResult?.ok).toBe(true);

  // now-trusted controller can send a control command and gets an ack back
  const commandAck = await controllerPage.evaluate(
    async ({ nodeId }) =>
      window.__playerTest!.dialCommand(
        nodeId,
        JSON.stringify({ type: "control", command: "pause" }),
      ),
    { nodeId },
  );
  expect((commandAck as { ok?: boolean })?.ok).toBe(true);

  await playerContext.close();
  await controllerContext.close();
});
