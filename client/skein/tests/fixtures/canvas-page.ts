import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";

interface CanvasTestHandle {
  page: Page;
  context: BrowserContext;
  canvasDocId: string;
  close: () => Promise<void>;
}

type CanvasPageFactory = (options?: { canvasDocId?: string }) => Promise<CanvasTestHandle>;

/**
 * custom playwright fixture that provides a factory for creating
 * canvas pages with a running skein instance.
 *
 * the test-harness.html page loads src/dev/test-bootstrap.ts via a
 * <script type="module"> tag, which exposes window.__initSkeinForTest().
 * this fixture calls that function via page.evaluate() — no dynamic
 * imports needed, vite resolves all bare specifiers at module load time.
 *
 * usage:
 *   const peer = await canvasPage();           // new canvas
 *   const peer2 = await canvasPage({ canvasDocId: peer.canvasDocId }); // join existing
 */
export const test = base.extend<{
  canvasPage: CanvasPageFactory;
}>({
  canvasPage: async ({ browser }, use) => {
    const handles: CanvasTestHandle[] = [];

    const factory: CanvasPageFactory = async (options) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto("/test-harness.html");

      // wait for the bootstrap module to load and expose the init function
      await page.waitForFunction(() => typeof (window as any).__initSkeinForTest === "function", {
        timeout: 10000,
      });

      // initialize skein inside the browser page
      const result = await page.evaluate(async (opts) => {
        return (window as any).__initSkeinForTest({
          canvasDocId: opts?.canvasDocId ?? null,
        });
      }, options ?? {});

      const handle: CanvasTestHandle = {
        page,
        context,
        canvasDocId: result.canvasDocId,
        close: async () => {
          await context.close();
        },
      };

      handles.push(handle);
      return handle;
    };

    await use(factory);

    // auto-cleanup all handles created during the test
    for (const handle of handles) {
      await handle.close().catch(() => {});
    }
  },
});

export { expect };
