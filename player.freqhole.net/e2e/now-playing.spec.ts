import { test, expect } from "@playwright/test";
import { getPlayerNodeId } from "./helpers";

// phase 11: now-playing ui polish - queue auto-advance, connected-controller
// indicator, on-page transport controls, and get_status queue resync. real
// p2p, same pattern as pairing.spec.ts/playback.spec.ts (window.__playerTest
// dials the player-under-test directly, no full spume UI needed).

async function pairController(
  playerPage: import("@playwright/test").Page,
  controllerPage: import("@playwright/test").Page,
  nodeId: string,
  displayName: string,
): Promise<void> {
  const pin = await playerPage.evaluate(() => window.__playerTest!.getPin());
  const result = await controllerPage.evaluate(
    async ({ nodeId, pin, displayName }) =>
      window.__playerTest!.dialAndPair(nodeId, pin, displayName),
    { nodeId, pin, displayName },
  );
  expect(result?.ok).toBe(true);
}

test("queue auto-advances to the next track when the current one ends @p2p", async ({
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
  await pairController(playerPage, controllerPage, nodeId, "test controller");

  const { peerNodeId: blobPeerNodeId, hash } = await controllerPage.evaluate(() =>
    window.__playerTest!.importTestAudioBlob(),
  );

  const ack = await controllerPage.evaluate(
    async ({ nodeId, blobPeerNodeId, hash }) =>
      window.__playerTest!.dialCommand(
        nodeId,
        JSON.stringify({
          type: "control",
          command: "replace_queue",
          items: [
            {
              source_peer_addr: blobPeerNodeId,
              blake3_hash: hash,
              mime_type: "audio/wav",
              title: "track a",
            },
            {
              source_peer_addr: blobPeerNodeId,
              blake3_hash: hash,
              mime_type: "audio/wav",
              title: "track b",
            },
          ],
        }),
      ),
    { nodeId, blobPeerNodeId, hash },
  );
  expect((ack as { ok?: boolean })?.ok).toBe(true);

  await expect(playerPage.getByTestId("now-playing-title")).toHaveText("track a");
  // the test wav is ~90ms of silence - it should finish and auto-advance well
  // within a few seconds, with no further command from the controller.
  await expect(playerPage.getByTestId("now-playing-title")).toHaveText("track b", {
    timeout: 15_000,
  });

  await playerContext.close();
  await controllerContext.close();
});

test("connected-controller indicator and get_status queue resync @p2p", async ({ browser }) => {
  // DISCONNECT_GRACE_MS is now 45s (connectedControllers.ts) - needs a much
  // longer test timeout than the default 30s to leave room for that wait.
  test.setTimeout(90_000);

  const playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();
  await playerPage.goto("/");

  const nodeId = await getPlayerNodeId(playerPage);

  const controllerContext = await browser.newContext();
  const controllerPage = await controllerContext.newPage();
  await controllerPage.goto("/");
  await controllerPage.waitForFunction(() => typeof window.__playerTest !== "undefined");
  await pairController(playerPage, controllerPage, nodeId, "edward's phone");

  // no session open yet - indicator should not be showing.
  await expect(playerPage.getByTestId("connected-controllers")).toHaveCount(0);

  const sessionId = await controllerPage.evaluate(
    async ({ nodeId }) => window.__playerTest!.openSession(nodeId),
    { nodeId },
  );
  // the player's accept loop only observes a stream once bytes actually
  // flow on it - a bare open_bi() alone doesn't reach the player yet.
  await controllerPage.evaluate(
    async ({ sessionId }) =>
      window.__playerTest!.sendOnSession(
        sessionId,
        JSON.stringify({ type: "control", command: "get_status" }),
      ),
    { sessionId },
  );

  await expect(playerPage.getByTestId("connected-controllers")).toContainText("edward's phone");

  const { peerNodeId: blobPeerNodeId, hash } = await controllerPage.evaluate(() =>
    window.__playerTest!.importTestAudioBlob(),
  );
  await controllerPage.evaluate(
    async ({ sessionId, blobPeerNodeId, hash }) =>
      window.__playerTest!.sendOnSession(
        sessionId,
        JSON.stringify({
          type: "control",
          command: "replace_queue",
          items: [
            {
              source_peer_addr: blobPeerNodeId,
              blake3_hash: hash,
              mime_type: "audio/wav",
              title: "queued a",
            },
            {
              source_peer_addr: blobPeerNodeId,
              blake3_hash: hash,
              mime_type: "audio/wav",
              title: "queued b",
            },
          ],
        }),
      ),
    { sessionId, blobPeerNodeId, hash },
  );

  const statusAck = await controllerPage.evaluate(
    async ({ sessionId }) =>
      window.__playerTest!.sendOnSession(
        sessionId,
        JSON.stringify({ type: "control", command: "get_status" }),
      ),
    { sessionId },
  );
  const status = statusAck as { ok?: boolean; status?: { queue?: { title?: string }[] } };
  expect(status?.ok).toBe(true);
  expect(status?.status?.queue?.map((i) => i.title)).toEqual(["queued a", "queued b"]);

  await controllerPage.evaluate(({ sessionId }) => window.__playerTest!.closeSession(sessionId), {
    sessionId,
  });
  // DISCONNECT_GRACE_MS (connectedControllers.ts) is 45s - give the
  // assertion comfortable margin above that instead of relying on
  // playwright's shorter default expect timeout.
  await expect(playerPage.getByTestId("connected-controllers")).toHaveCount(0, {
    timeout: 50_000,
  });

  await playerContext.close();
  await controllerContext.close();
});

test("on-page play/pause and skip controls work @p2p", async ({ browser }) => {
  test.setTimeout(60_000);

  const playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();
  await playerPage.goto("/");

  const nodeId = await getPlayerNodeId(playerPage);

  const controllerContext = await browser.newContext();
  const controllerPage = await controllerContext.newPage();
  await controllerPage.goto("/");
  await controllerPage.waitForFunction(() => typeof window.__playerTest !== "undefined");
  await pairController(playerPage, controllerPage, nodeId, "test controller");

  // long enough (5s) that it won't auto-advance out from under the assertions below.
  const { peerNodeId: blobPeerNodeId, hash } = await controllerPage.evaluate(() =>
    window.__playerTest!.importTestAudioBlob(5_000),
  );
  await controllerPage.evaluate(
    async ({ nodeId, blobPeerNodeId, hash }) =>
      window.__playerTest!.dialCommand(
        nodeId,
        JSON.stringify({
          type: "control",
          command: "replace_queue",
          items: [
            {
              source_peer_addr: blobPeerNodeId,
              blake3_hash: hash,
              mime_type: "audio/wav",
              title: "solo track",
            },
            {
              source_peer_addr: blobPeerNodeId,
              blake3_hash: hash,
              mime_type: "audio/wav",
              title: "next track",
            },
          ],
        }),
      ),
    { nodeId, blobPeerNodeId, hash },
  );

  await expect(playerPage.getByTestId("now-playing-title")).toHaveText("solo track");
  await expect(playerPage.getByTestId("play-pause-button")).toHaveText("⏸");

  await playerPage.getByTestId("play-pause-button").click();
  await expect(playerPage.getByTestId("play-pause-button")).toHaveText("▶");

  await playerPage.getByTestId("play-pause-button").click();
  await expect(playerPage.getByTestId("play-pause-button")).toHaveText("⏸");

  await playerPage.getByTestId("skip-button").click();
  await expect(playerPage.getByTestId("now-playing-title")).toHaveText("next track");

  await playerContext.close();
  await controllerContext.close();
});
