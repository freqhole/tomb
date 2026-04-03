import { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel";
import { createTestRegistry } from "../../widgets/index";
import { initCanvas } from "../canvas/init";

/**
 * dev canvas app — boots a full interactive skein canvas on page load.
 *
 * this is the manual playground for testing the toolbar, widgets,
 * pan/zoom, edit/view mode, etc. in a browser. it uses
 * BroadcastChannel for networking so you can open two tabs
 * and see them sync.
 *
 * the canvas document id is stored in the URL hash so you can
 * reload the page and get back the same canvas, or share the
 * URL between tabs to test multiplayer.
 */
async function boot(): Promise<void> {
  const mountElement = document.getElementById("canvas-root")!;

  // pull the canvas doc id from the URL hash if present
  const hash = window.location.hash.slice(1);
  const canvasDocId = hash.length > 0 ? hash : null;

  const canvas = await initCanvas({
    mountElement,
    canvasDocId,
    registry: createTestRegistry(),
    networkAdapter: new BroadcastChannelNetworkAdapter(),
  });

  // write the doc id into the hash so reloads and new tabs can rejoin
  if (!canvasDocId) {
    window.location.hash = canvas.store.handle.documentId;
  }

  // expose on window for console debugging
  (window as any).__skein = canvas;

  // log a few helpful hints
  const docId = canvas.store.handle.documentId;
  console.log(
    `%cskein canvas ready%c\n` +
      `  doc: ${docId}\n` +
      `  press 'e' to toggle edit mode\n` +
      `  scroll to pan, ctrl+scroll to zoom\n` +
      `  open another tab with the same URL to test sync\n` +
      `  window.__skein is available for console poking`,
    "color: #6366f1; font-weight: bold",
    "color: #888"
  );
}

boot().catch((err) => {
  console.error("skein canvas boot failed:", err);
  const root = document.getElementById("canvas-root");
  if (root) {
    root.style.display = "flex";
    root.style.alignItems = "center";
    root.style.justifyContent = "center";
    root.style.color = "#ef4444";
    root.style.fontFamily = "system-ui, sans-serif";
    root.style.fontSize = "14px";
    root.textContent = `failed to initialize canvas: ${err instanceof Error ? err.message : String(err)}`;
  }
});
