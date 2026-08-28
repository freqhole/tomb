import { createResource, createSignal, Show } from "solid-js";
import { getPlayerNode } from "./midden/node";
import { startAcceptLoop } from "./midden/acceptLoop";
import { generatePin } from "./pairing/pin";
import { renderPlayerQr } from "./qr/qrCode";

const DISPLAY_NAME = "freqhole player";

export default function App() {
  const [pin] = createSignal(generatePin());

  const [node] = createResource(async () => {
    const playerNode = await getPlayerNode();
    startAcceptLoop(playerNode);
    return playerNode;
  });

  const [qrDataUrl] = createResource(node, async (playerNode) =>
    renderPlayerQr({
      node_id: playerNode.node_id(),
      name: DISPLAY_NAME,
      role: "player_remote",
    }),
  );

  return (
    <div class="min-h-screen flex flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 class="text-2xl font-semibold">{DISPLAY_NAME}</h1>

      <Show when={node.loading}>
        <p class="text-sm text-neutral-400">initializing p2p node...</p>
      </Show>

      <Show when={node()}>
        {(playerNode) => (
          <>
            <Show when={qrDataUrl()}>
              {(url) => (
                <img src={url()} alt="pairing qr code" class="w-72 h-72" data-testid="pairing-qr" />
              )}
            </Show>
            <p class="text-4xl font-mono tracking-widest" data-testid="pairing-pin">
              {pin()}
            </p>
            <p class="text-xs text-neutral-500 break-all" data-testid="node-id">
              {playerNode().node_id()}
            </p>
          </>
        )}
      </Show>
    </div>
  );
}
