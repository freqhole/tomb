import { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel";
import { z } from "zod";
import { createTestRegistry } from "../../widgets/index";
import type { SkeinCanvas } from "../canvas/init";
import { initCanvas } from "../canvas/init";
import { PresenceManager } from "../canvas/presence-manager";
import { Viewport } from "../canvas/viewport";
import { createWidgetDoc } from "../widgets/widget-doc";

/**
 * a simple zod schema used by playwright tests to exercise createWidgetDoc.
 * not tied to any real widget — just needs defaults so .parse({}) works.
 */
const testWidgetSchema = z.object({
  count: z.number().default(0),
  step: z.number().default(1),
  label: z.string().default("test"),
});

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
(window as any).__skeinHelpers = { createWidgetDoc, testWidgetSchema, Viewport, PresenceManager };
