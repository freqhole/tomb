// E2E test for the texture lifecycle bug where Assets.unload() in the
// property tray's image control destroys a texture still in use by the
// canvas-card's preview sprite, causing a PixiJS render crash.

import { expect, test } from "@playwright/test";
import fs from "fs";
import path from "path";

async function waitForNarthex(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForFunction(() => (window as any).__skein != null, { timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const skein = (window as any).__skein;
      return skein?.widgetManager?.getLiveWidgets()?.size > 0;
    },
    { timeout: 15_000 }
  );
}

async function createCanvasAndWaitForNavigation(
  page: import("@playwright/test").Page,
  detail: { title: string; color: number }
): Promise<string> {
  const hashBefore = await page.evaluate(() => window.location.hash);

  await page.evaluate((d) => {
    window.dispatchEvent(new CustomEvent("skein:create-canvas", { detail: d }));
  }, detail);

  await page.waitForFunction(
    (prevHash) => window.location.hash !== prevHash && window.location.hash.length > 1,
    hashBefore,
    { timeout: 10_000 }
  );

  return page.evaluate(() => window.location.hash.slice(1));
}

async function navigateBackToNarthex(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = "";
  });
  await page.waitForFunction(
    () => {
      const skein = (window as any).__skein;
      return skein?.widgetManager?.getLiveWidgets()?.size > 0;
    },
    { timeout: 10_000 }
  );
  await page.waitForTimeout(500);
}

test.describe("texture lifecycle — property tray shared asset unload", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/skein.html");

    // clear all IndexedDB state for a clean first-boot
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
    });
    await page.waitForTimeout(200);

    await page.goto("/skein.html");
    await waitForNarthex(page);
  });

  test("deselecting a canvas-card with a preview image does not crash the renderer", async ({
    page,
  }) => {
    // collect console errors during the test
    const errors: string[] = [];
    page.on("pageerror", (err) => {
      errors.push(err.message);
    });

    // step 1: create a canvas so we get a canvas-card on the narthex
    await createCanvasAndWaitForNavigation(page, {
      title: "texture lifecycle test",
      color: 0xd946ef,
    });
    await navigateBackToNarthex(page);

    // step 2: set a preview image on the canvas-card via its widgetDoc
    const imgBuffer = fs.readFileSync(path.join(__dirname, "fixtures", "freqhole.png"));
    const base64 = imgBuffer.toString("base64");
    const fakeDataUrl = `data:image/png;base64,${base64}`;

    await page.evaluate((dataUrl) => {
      const skein = (window as any).__skein;
      const live = skein.widgetManager.getLiveWidgets();
      for (const [_id, widget] of live.entries()) {
        const entry = (widget as any).entry;
        if (entry?.type === "canvas-card") {
          const doc = (widget as any).widgetDoc;
          if (doc) {
            doc.change((d: any) => {
              d.previewUrl = dataUrl;
            });
          }
          break;
        }
      }
    }, fakeDataUrl);

    // wait for the preview sprite to load
    await page.waitForTimeout(1500);

    // step 3: select the canvas-card widget (which opens the property tray
    // with an image control that loads the same data URL)
    const cardWidgetId = await page.evaluate(() => {
      const skein = (window as any).__skein;
      const live = skein.widgetManager.getLiveWidgets();
      for (const [id, widget] of live.entries()) {
        const entry = (widget as any).entry;
        if (entry?.type === "canvas-card") {
          return id;
        }
      }
      return null;
    });
    expect(cardWidgetId).not.toBeNull();

    await page.evaluate((widgetId) => {
      const skein = (window as any).__skein;
      skein.inputRouter.selectWidget(widgetId);
    }, cardWidgetId);

    // wait for the property tray to mount and load its preview texture
    await page.waitForTimeout(1000);

    // step 5: deselect the card (this hides the property tray, which
    // previously would call Assets.unload on the shared texture)
    await page.evaluate(() => {
      const skein = (window as any).__skein;
      skein.inputRouter.selectWidget(null);
    });

    // wait several frames for the render loop to process
    await page.waitForTimeout(1000);

    // step 6: verify no crashes occurred
    const alphaModeCrashes = errors.filter(
      (e) => e.includes("alphaMode") || e.includes("Cannot read properties of null")
    );
    expect(alphaModeCrashes).toEqual([]);
  });

  test("resizing a canvas-card with a preview image does not crash the renderer", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => {
      errors.push(err.message);
    });

    // create a canvas + go back to narthex
    await createCanvasAndWaitForNavigation(page, {
      title: "resize texture test",
      color: 0x06b6d4,
    });
    await navigateBackToNarthex(page);

    // set a preview image
    const imgBuffer = fs.readFileSync(path.join(__dirname, "fixtures", "freqhole.png"));
    const base64 = imgBuffer.toString("base64");
    const fakeDataUrl = `data:image/png;base64,${base64}`;

    await page.evaluate((dataUrl) => {
      const skein = (window as any).__skein;
      const live = skein.widgetManager.getLiveWidgets();
      for (const [_id, widget] of live.entries()) {
        const entry = (widget as any).entry;
        if (entry?.type === "canvas-card") {
          const doc = (widget as any).widgetDoc;
          if (doc) {
            doc.change((d: any) => {
              d.previewUrl = dataUrl;
            });
          }
          break;
        }
      }
    }, fakeDataUrl);
    await page.waitForTimeout(1500);

    // select the canvas-card
    const cardId = await page.evaluate(() => {
      const skein = (window as any).__skein;
      const live = skein.widgetManager.getLiveWidgets();
      for (const [id, widget] of live.entries()) {
        const entry = (widget as any).entry;
        if (entry?.type === "canvas-card") return id;
      }
      return null;
    });
    expect(cardId).not.toBeNull();

    await page.evaluate((widgetId) => {
      const skein = (window as any).__skein;
      skein.inputRouter.selectWidget(widgetId);
    }, cardId);
    await page.waitForTimeout(1000);

    // resize the card via the store (simulates drag-resize)
    await page.evaluate((widgetId) => {
      const skein = (window as any).__skein;
      skein.store.resizeWidget(widgetId, 350, 250);
    }, cardId);
    await page.waitForTimeout(500);

    // deselect
    await page.evaluate(() => {
      const skein = (window as any).__skein;
      skein.inputRouter.selectWidget(null);
    });
    await page.waitForTimeout(1000);

    // verify no crashes
    const crashes = errors.filter(
      (e) => e.includes("alphaMode") || e.includes("Cannot read properties of null")
    );
    expect(crashes).toEqual([]);
  });
});
