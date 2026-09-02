import { test, expect } from "@playwright/test";
import { getPlayerNodeId } from "./helpers";

// phase 4: controller pairs, then sends a real "play" command pointing at a
// blob the controller itself serves - player must fetch it over iroh-blobs
// and start real <audio> playback.
test("play command fetches and plays a controller-served blob @p2p", async ({ browser }) => {
  test.setTimeout(60_000);

  const playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();
  await playerPage.goto("/");

  const nodeId = await getPlayerNodeId(playerPage);
  const pin = await playerPage.evaluate(() => window.__playerTest!.getPin());

  const controllerContext = await browser.newContext();
  const controllerPage = await controllerContext.newPage();
  await controllerPage.goto("/");
  await controllerPage.waitForFunction(() => typeof window.__playerTest !== "undefined");

  const pairResult = await controllerPage.evaluate(
    async ({ nodeId, pin }) => window.__playerTest!.dialAndPair(nodeId, pin, "test controller"),
    { nodeId, pin },
  );
  expect(pairResult?.ok).toBe(true);

  const { peerNodeId: blobPeerNodeId, hash } = await controllerPage.evaluate(() =>
    window.__playerTest!.importTestAudioBlob(),
  );

  const playAck = await controllerPage.evaluate(
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
              title: "test track one",
              artist: "test artist",
            },
            {
              source_peer_addr: blobPeerNodeId,
              blake3_hash: hash,
              mime_type: "audio/wav",
              title: "test track two",
              artist: "test artist",
            },
          ],
        }),
      ),
    { nodeId, blobPeerNodeId, hash },
  );

  const ack = playAck as { ok?: boolean; status?: { state?: string } };
  expect(ack?.ok).toBe(true);
  expect(ack?.status?.state).toBe("now_playing");

  await expect(playerPage.getByTestId("now-playing-title")).toHaveText("test track one");
  await expect(playerPage.getByTestId("queue-list")).toContainText("test track two");

  await playerContext.close();
  await controllerContext.close();
});
