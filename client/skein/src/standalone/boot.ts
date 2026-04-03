import { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel";
import { createTestRegistry } from "../../widgets/index";
import { initCanvas } from "../canvas/init";

async function boot(): Promise<void> {
  const mountElement = document.getElementById("canvas-root");
  if (!mountElement) {
    throw new Error("mount element #canvas-root not found");
  }

  // canvas doc id is stored in the URL hash for persistence
  const hash = window.location.hash.slice(1);
  const canvasDocId = hash.length > 0 ? hash : null;

  const canvas = await initCanvas({
    mountElement,
    canvasDocId,
    registry: createTestRegistry(),
    networkAdapter: new BroadcastChannelNetworkAdapter(),
  });

  // persist the doc id in the hash for reload and tab sharing
  if (!canvasDocId) {
    window.location.hash = canvas.store.handle.documentId;
  }

  // expose for console access
  (window as any).__skein = canvas;
}

boot().catch((err) => {
  console.error("skein boot failed:", err);
  const root = document.getElementById("canvas-root");
  if (root) {
    root.className = "boot-error";
    root.textContent = `failed to start: ${err instanceof Error ? err.message : String(err)}`;
  }
});
