// E2E tests for profile widget features, canvas author auto-population,
// and image upload flows.

import { expect, test } from "@playwright/test";
import path from "path";

// ---------------------------------------------------------------------------
// helpers (same pattern as narthex.test.ts)
// ---------------------------------------------------------------------------

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

/** read the profile widget's per-widget doc state */
async function getProfileState(
  page: import("@playwright/test").Page
): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const skein = (window as any).__skein;
    const live = skein.widgetManager.getLiveWidgets();
    const widget = live.get("skein-profile");
    if (!widget?.widgetDoc) return null;
    return widget.widgetDoc.current;
  });
}

/** dispatch skein:create-canvas and wait for hash navigation */
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

/** navigate back to the narthex and wait for it to be ready */
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

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

test.describe("profile and image features", () => {
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

  // -------------------------------------------------------------------------
  // profile node ID
  // -------------------------------------------------------------------------

  test("profile widget generates a 64-char hex node ID on first boot", async ({ page }) => {
    // settle time for the profile widget to mount and generate the nodeId
    await page.waitForTimeout(1500);

    const state = await getProfileState(page);

    expect(state).not.toBeNull();
    expect(state!.nodeId).toBeTruthy();
    expect(typeof state!.nodeId).toBe("string");
    expect((state!.nodeId as string).length).toBe(64);
    // should be valid hex
    expect(state!.nodeId).toMatch(/^[0-9a-f]{64}$/);
  });

  test("profile node ID persists across page reload", async ({ page }) => {
    await page.waitForTimeout(1500);

    const nodeIdBefore = await page.evaluate(() => {
      const skein = (window as any).__skein;
      const live = skein.widgetManager.getLiveWidgets();
      const widget = live.get("skein-profile");
      return widget?.widgetDoc?.current?.nodeId ?? "";
    });

    expect(nodeIdBefore).toBeTruthy();

    // reload the page
    await page.reload();
    await waitForNarthex(page);
    await page.waitForTimeout(1500);

    const nodeIdAfter = await page.evaluate(() => {
      const skein = (window as any).__skein;
      const live = skein.widgetManager.getLiveWidgets();
      const widget = live.get("skein-profile");
      return widget?.widgetDoc?.current?.nodeId ?? "";
    });

    expect(nodeIdAfter).toBe(nodeIdBefore);
  });

  // -------------------------------------------------------------------------
  // canvas author auto-population
  // -------------------------------------------------------------------------

  test("canvas author is auto-populated from profile username", async ({ page }) => {
    // set a username on the profile widget
    await page.evaluate(() => {
      const skein = (window as any).__skein;
      const live = skein.widgetManager.getLiveWidgets();
      const widget = live.get("skein-profile");
      if (widget?.widgetDoc) {
        widget.widgetDoc.change((d: any) => {
          d.username = "alice";
        });
      }
    });
    await page.waitForTimeout(500);

    // create a canvas
    await createCanvasAndWaitForNavigation(page, {
      title: "author test canvas",
      color: 0xd946ef,
    });

    // navigate back to the narthex
    await navigateBackToNarthex(page);

    // find the canvas-card and check its authorName
    const authorName = await page.evaluate(() => {
      const skein = (window as any).__skein;
      const live = skein.widgetManager.getLiveWidgets();
      for (const [_id, widget] of live.entries()) {
        const entry = (widget as any).entry;
        if (entry?.type === "canvas-card") {
          const doc = (widget as any).widgetDoc;
          if (doc?.current?.authorName) {
            return doc.current.authorName;
          }
        }
      }
      return "";
    });

    expect(authorName).toBe("alice");
  });

  test("canvas author falls back to empty when profile has no username", async ({ page }) => {
    // don't set a username — leave it blank

    await createCanvasAndWaitForNavigation(page, {
      title: "no-author test canvas",
      color: 0x3b82f6,
    });

    await navigateBackToNarthex(page);

    const authorName = await page.evaluate(() => {
      const skein = (window as any).__skein;
      const live = skein.widgetManager.getLiveWidgets();
      for (const [_id, widget] of live.entries()) {
        const entry = (widget as any).entry;
        if (entry?.type === "canvas-card") {
          const doc = (widget as any).widgetDoc;
          return doc?.current?.authorName ?? "__missing__";
        }
      }
      return "__no_card__";
    });

    expect(authorName).toBe("");
  });

  // -------------------------------------------------------------------------
  // profile avatar upload via file chooser
  // -------------------------------------------------------------------------

  test("profile avatar upload via file chooser stores a WebP data URL", async ({ page }) => {
    await page.waitForTimeout(1000);

    // find the profile widget's position on the narthex
    const pos = await page.evaluate(() => {
      const skein = (window as any).__skein;
      const live = skein.widgetManager.getLiveWidgets();
      const widget = live.get("skein-profile");
      if (!widget) return null;
      const entry = (widget as any).entry;
      return { x: entry.x, y: entry.y, width: entry.width, height: entry.height };
    });
    expect(pos).not.toBeNull();

    // the avatar circle is centered horizontally, roughly 80–100px from the
    // widget top (after header + separator). click in the center of that area.
    const clickX = pos!.x + pos!.width / 2;
    const clickY = pos!.y + 95;

    // set up file chooser listener BEFORE clicking
    const fileChooserPromise = page.waitForEvent("filechooser");

    await page.mouse.click(clickX, clickY);

    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(path.join(__dirname, "fixtures", "freqhole.png"));

    // wait for the image to be processed (resize + WebP encode + Automerge write)
    await page.waitForTimeout(3000);

    // verify the avatar data URL was set
    const avatarDataUrl = await page.evaluate(() => {
      const skein = (window as any).__skein;
      const live = skein.widgetManager.getLiveWidgets();
      const widget = live.get("skein-profile");
      return widget?.widgetDoc?.current?.avatarDataUrl ?? "";
    });

    expect(avatarDataUrl).toBeTruthy();
    expect(avatarDataUrl).toMatch(/^data:image\/webp;base64,/);
  });

  test("profile avatar persists across page reload", async ({ page }) => {
    await page.waitForTimeout(1000);

    // find profile widget position
    const pos = await page.evaluate(() => {
      const skein = (window as any).__skein;
      const live = skein.widgetManager.getLiveWidgets();
      const widget = live.get("skein-profile");
      if (!widget) return null;
      const entry = (widget as any).entry;
      return { x: entry.x, y: entry.y, width: entry.width, height: entry.height };
    });
    expect(pos).not.toBeNull();

    // upload an avatar
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.mouse.click(pos!.x + pos!.width / 2, pos!.y + 95);
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(path.join(__dirname, "fixtures", "freqhole.png"));
    await page.waitForTimeout(3000);

    // capture the data URL before reload
    const avatarBefore = await page.evaluate(() => {
      const skein = (window as any).__skein;
      const live = skein.widgetManager.getLiveWidgets();
      const widget = live.get("skein-profile");
      return widget?.widgetDoc?.current?.avatarDataUrl ?? "";
    });
    expect(avatarBefore).toMatch(/^data:image\/webp;base64,/);

    // reload
    await page.reload();
    await waitForNarthex(page);
    await page.waitForTimeout(1500);

    // verify avatar persisted
    const avatarAfter = await page.evaluate(() => {
      const skein = (window as any).__skein;
      const live = skein.widgetManager.getLiveWidgets();
      const widget = live.get("skein-profile");
      return widget?.widgetDoc?.current?.avatarDataUrl ?? "";
    });

    expect(avatarAfter).toBe(avatarBefore);
  });

  // -------------------------------------------------------------------------
  // profile singleton behavior
  // -------------------------------------------------------------------------

  test("profile widget is a singleton and not crashed after navigate-back", async ({ page }) => {
    // create a canvas and navigate there
    await createCanvasAndWaitForNavigation(page, {
      title: "singleton test canvas",
      color: 0xd946ef,
    });

    // navigate back to the narthex
    await navigateBackToNarthex(page);

    // verify the profile widget is present and not crashed
    const result = await page.evaluate(() => {
      const skein = (window as any).__skein;
      const live = skein.widgetManager.getLiveWidgets();
      const widget = live.get("skein-profile");
      if (!widget) return { found: false, crashed: false };
      return {
        found: true,
        crashed: (widget as any).crashed,
      };
    });

    expect(result.found).toBe(true);
    expect(result.crashed).toBe(false);
  });

  // -------------------------------------------------------------------------
  // canvas-card preview image
  // -------------------------------------------------------------------------

  test("canvas-card previewUrl can be set and read back", async ({ page }) => {
    // create a canvas so we get a canvas-card
    await createCanvasAndWaitForNavigation(page, {
      title: "preview test canvas",
      color: 0xef4444,
    });
    await navigateBackToNarthex(page);

    // directly set a previewUrl on the canvas-card via its widgetDoc
    // (simulates what the property tray image upload would do)
    const fs = await import("fs");
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

    await page.waitForTimeout(500);

    // verify it was stored
    const storedUrl = await page.evaluate(() => {
      const skein = (window as any).__skein;
      const live = skein.widgetManager.getLiveWidgets();
      for (const [_id, widget] of live.entries()) {
        const entry = (widget as any).entry;
        if (entry?.type === "canvas-card") {
          const doc = (widget as any).widgetDoc;
          return doc?.current?.previewUrl ?? "";
        }
      }
      return "";
    });

    expect(storedUrl).toBe(fakeDataUrl);
  });
});
