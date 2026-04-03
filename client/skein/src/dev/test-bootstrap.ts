import { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel";
import { counterSchema } from "../../widgets/counter";
import { createTestRegistry } from "../../widgets/index";
import type { SkeinCanvas } from "../canvas/init";
import { initCanvas } from "../canvas/init";
import { PresenceManager } from "../canvas/presence-manager";
import { Viewport } from "../canvas/viewport";
import { createWidgetDoc } from "../widgets/widget-doc";

interface TestInitOptions {
  canvasDocId?: string | null;
}

interface TestInitResult {
  canvasDocId: string;
}

/**
 * initialize a skein canvas for playwright tests.
 * this module is loaded by test-harness.html via a <script type="module"> tag,
 * so vite resolves all bare package specifiers properly.
 *
 * exposes window.__initSkeinForTest(options) for the playwright fixture to call
 * via page.evaluate(), and window.__skein for test assertions.
 */
async function initSkeinForTest(options: TestInitOptions = {}): Promise<TestInitResult> {
  const canvas: SkeinCanvas = await initCanvas({
    mountElement: document.getElementById("canvas-root")!,
    canvasDocId: options.canvasDocId ?? null,
    registry: createTestRegistry(),
    networkAdapter: new BroadcastChannelNetworkAdapter(),
  });

  (window as any).__skein = canvas;

  return {
    canvasDocId: canvas.store.handle.documentId,
  };
}

// expose on window for playwright's page.evaluate() to call
(window as any).__initSkeinForTest = initSkeinForTest;

// expose internals for detailed playwright tests
(window as any).__skeinHelpers = { createWidgetDoc, counterSchema, Viewport, PresenceManager };
