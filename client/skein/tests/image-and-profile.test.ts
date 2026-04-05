// E2E tests for social widget features, canvas author auto-population,
// and image upload flows.

import { expect, test } from "@playwright/test";
import path from "path";

/**
 * get the screen coordinates of the profile avatar circle by querying
 * the PixiJS display tree. this is much more reliable than guessing
 * pixel offsets from the widget entry's world-space position.
 */
async function getAvatarScreenCoords(
  page: import("@playwright/test").Page
): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const skein = (window as any).__skein;
    if (!skein) return null;
    const live = skein.widgetManager.getLiveWidgets();
    const widget = live.get("skein-social");
    if (!widget) return null;

    // the avatar container is the child of the widget's container that
    // has the circle hitArea. walk the display tree to find it.
    const ctrl = widget.ctrl;
    if (!ctrl?.container) return null;

    // the social widget exposes the avatar center position indirectly —
    // the avatarContainer has a hitArea (Circle) whose center gives us
    // the local coords. fall back to a heuristic if we can't find it.
    const container = ctrl.container;

    // look for a child container that has a Circle hitArea
    for (let i = 0; i < container.children.length; i++) {
      const child = container.children[i] as any;
      if (child.hitArea && typeof child.hitArea.radius === "number") {
        const cx = child.hitArea.x ?? 0;
        const cy = child.hitArea.y ?? 0;
        // convert local coords within the child to global (screen) coords
        const global = child.toGlobal({ x: cx, y: cy });
        const canvas = skein.app.canvas as HTMLCanvasElement;
        const rect = canvas.getBoundingClientRect();
        return { x: rect.left + global.x, y: rect.top + global.y };
      }
    }

    // fallback: use the widget entry position + heuristic offset
    const entry = (widget as any).entry;
    const frame = widget.frame;
    if (frame?.root) {
      const globalPos = frame.contentContainer.toGlobal({ x: entry.width / 2, y: 95 });
      const canvas = skein.app.canvas as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + globalPos.x, y: rect.top + globalPos.y };
    }

    return null;
  });
}

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

/** read the social widget's profile sub-object from the per-widget doc state */
async function getProfileState(
  page: import("@playwright/test").Page
): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const skein = (window as any).__skein;
    const live = skein.widgetManager.getLiveWidgets();
    const widget = live.get("skein-social");
    if (!widget?.widgetDoc) return null;
    return widget.widgetDoc.current?.profile ?? null;
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

  test("social widget generates a 64-char hex node ID on first boot", async ({ page }) => {
    // settle time for the social widget to mount and generate the nodeId
    await page.waitForTimeout(1500);

    const state = await getProfileState(page);

    expect(state).not.toBeNull();
    expect(state!.nodeId).toBeTruthy();
    expect(typeof state!.nodeId).toBe("string");
    expect((state!.nodeId as string).length).toBe(64);
    // should be valid hex
    expect(state!.nodeId).toMatch(/^[0-9a-f]{64}$/);
  });

  test("social widget node ID persists across page reload", async ({ page }) => {
    await page.waitForTimeout(1500);

    const nodeIdBefore = await page.evaluate(() => {
      const skein = (window as any).__skein;
      const live = skein.widgetManager.getLiveWidgets();
      const widget = live.get("skein-social");
      return widget?.widgetDoc?.current?.profile?.nodeId ?? "";
    });

    expect(nodeIdBefore).toBeTruthy();

    // reload the page
    await page.reload();
    await waitForNarthex(page);
    await page.waitForTimeout(1500);

    const nodeIdAfter = await page.evaluate(() => {
      const skein = (window as any).__skein;
      const live = skein.widgetManager.getLiveWidgets();
      const widget = live.get("skein-social");
      return widget?.widgetDoc?.current?.profile?.nodeId ?? "";
    });

    expect(nodeIdAfter).toBe(nodeIdBefore);
  });

  // -------------------------------------------------------------------------
  // canvas author auto-population
  // -------------------------------------------------------------------------

  test("canvas author is auto-populated from social widget username", async ({ page }) => {
    // set a username on the social widget
    await page.evaluate(() => {
      const skein = (window as any).__skein;
      const live = skein.widgetManager.getLiveWidgets();
      const widget = live.get("skein-social");
      if (widget?.widgetDoc) {
        widget.widgetDoc.change((d: any) => {
          if (!d.profile) d.profile = {};
          d.profile.username = "alice";
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

  test("canvas author falls back to empty when social widget has no username", async ({ page }) => {
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

  test("social widget avatar upload via file chooser stores a WebP data URL", async ({ page }) => {
    await page.waitForTimeout(1500);

    // get the avatar circle's screen coordinates from the PixiJS display tree
    const coords = await getAvatarScreenCoords(page);
    expect(coords).not.toBeNull();

    // set up file chooser listener BEFORE clicking
    const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 5000 });

    await page.mouse.click(coords!.x, coords!.y);

    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(path.join(__dirname, "fixtures", "freqhole.png"));

    // wait for the image to be processed (resize + WebP encode + Automerge write)
    // poll instead of fixed timeout for more reliable detection
    await page.waitForFunction(
      () => {
        const skein = (window as any).__skein;
        const live = skein?.widgetManager?.getLiveWidgets();
        const widget = live?.get("skein-social");
        const url = widget?.widgetDoc?.current?.profile?.avatarDataUrl ?? "";
        return url.startsWith("data:image/");
      },
      { timeout: 10_000 }
    );

    // verify the avatar data URL was set
    const avatarDataUrl = await page.evaluate(() => {
      const skein = (window as any).__skein;
      const live = skein.widgetManager.getLiveWidgets();
      const widget = live.get("skein-social");
      return widget?.widgetDoc?.current?.profile?.avatarDataUrl ?? "";
    });

    expect(avatarDataUrl).toBeTruthy();
    expect(avatarDataUrl).toMatch(/^data:image\/webp;base64,/);
  });

  test("social widget avatar persists across page reload", async ({ page }) => {
    await page.waitForTimeout(1500);

    // get the avatar circle's screen coordinates from the PixiJS display tree
    const coords = await getAvatarScreenCoords(page);
    expect(coords).not.toBeNull();

    // upload an avatar
    const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 5000 });
    await page.mouse.click(coords!.x, coords!.y);
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(path.join(__dirname, "fixtures", "freqhole.png"));

    // poll until the avatar is stored
    await page.waitForFunction(
      () => {
        const skein = (window as any).__skein;
        const live = skein?.widgetManager?.getLiveWidgets();
        const widget = live?.get("skein-social");
        const url = widget?.widgetDoc?.current?.profile?.avatarDataUrl ?? "";
        return url.startsWith("data:image/");
      },
      { timeout: 10_000 }
    );

    // capture the data URL before reload
    const avatarBefore = await page.evaluate(() => {
      const skein = (window as any).__skein;
      const live = skein.widgetManager.getLiveWidgets();
      const widget = live.get("skein-social");
      return widget?.widgetDoc?.current?.profile?.avatarDataUrl ?? "";
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
      const widget = live.get("skein-social");
      return widget?.widgetDoc?.current?.profile?.avatarDataUrl ?? "";
    });

    expect(avatarAfter).toBe(avatarBefore);
  });

  // -------------------------------------------------------------------------
  // profile singleton behavior
  // -------------------------------------------------------------------------

  test("social widget is a singleton and not crashed after navigate-back", async ({ page }) => {
    // create a canvas and navigate there
    await createCanvasAndWaitForNavigation(page, {
      title: "singleton test canvas",
      color: 0xd946ef,
    });

    // navigate back to the narthex
    await navigateBackToNarthex(page);

    // verify the social widget is present and not crashed
    const result = await page.evaluate(() => {
      const skein = (window as any).__skein;
      const live = skein.widgetManager.getLiveWidgets();
      const widget = live.get("skein-social");
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
