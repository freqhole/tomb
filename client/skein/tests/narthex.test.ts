// narthex navigation E2E tests
//
// these tests exercise the full skein router (skein.html) and verify that
// canvas-card widgets on the narthex survive navigate-away / navigate-back
// cycles. the underlying bug: destroyAll() calls unmountWidget() which
// deletes per-widget automerge docs from the repo. on navigate-back the
// canvas-card entry still has its docId but the doc is gone, so repo.find()
// fails and the card renders as "crashed."
//
// we expect these tests to FAIL until the bug is fixed. they document the
// desired behavior so we can verify the fix.

import { expect, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** navigate to skein.html and wait for the narthex to be ready */
async function waitForNarthex(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForFunction(() => (window as any).__skein != null, { timeout: 30_000 });

  // additionally wait for the widget manager to exist and be populated
  // (the narthex has at least the seed "narthex" label widget)
  await page.waitForFunction(
    () => {
      const skein = (window as any).__skein;
      return skein?.widgetManager?.getLiveWidgets()?.size > 0;
    },
    { timeout: 15_000 }
  );
}

/** dispatch `skein:create-canvas` and wait for the hash to change (navigation to new canvas) */
async function createCanvasAndWaitForNavigation(
  page: import("@playwright/test").Page,
  detail: { title: string; color: number }
): Promise<string> {
  // record current hash before creation
  const hashBefore = await page.evaluate(() => window.location.hash);

  await page.evaluate((d) => {
    window.dispatchEvent(new CustomEvent("skein:create-canvas", { detail: d }));
  }, detail);

  // wait for the hash to change (router navigates to the new canvas)
  await page.waitForFunction(
    (prevHash) => window.location.hash !== prevHash && window.location.hash.length > 1,
    hashBefore,
    { timeout: 10_000 }
  );

  // return the new canvas doc id (hash without the leading #)
  const newHash = await page.evaluate(() => window.location.hash.slice(1));
  return newHash;
}

/** navigate back to narthex by clearing the hash, then wait for re-initialization */
async function navigateBackToNarthex(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = "";
  });

  // __skein gets re-assigned when the narthex canvas is created.
  // wait for it to be a fresh instance with live widgets.
  await page.waitForFunction(
    () => {
      const skein = (window as any).__skein;
      return skein?.widgetManager?.getLiveWidgets()?.size > 0;
    },
    { timeout: 10_000 }
  );

  // extra settle time for reconciliation
  await page.waitForTimeout(500);
}

/** collect all canvas-card live widgets from the narthex */
async function getCanvasCards(
  page: import("@playwright/test").Page
): Promise<Array<{ id: string; crashed: boolean; type: string }>> {
  return page.evaluate(() => {
    const skein = (window as any).__skein;
    const live = skein.widgetManager.getLiveWidgets();
    const cards: Array<{ id: string; crashed: boolean; type: string }> = [];
    for (const [id, widget] of live.entries()) {
      if ((widget as any).entry?.type === "canvas-card") {
        cards.push({
          id,
          crashed: (widget as any).crashed,
          type: (widget as any).entry.type,
        });
      }
    }
    return cards;
  });
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

test.describe("narthex navigation", () => {
  test.beforeEach(async ({ page }) => {
    // explicitly clear IndexedDB state for a clean slate — each test should
    // be independent even though playwright gives us a fresh context.
    await page.goto("/skein.html");

    await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
    });

    // small delay to let IDB deletions settle before reload
    await page.waitForTimeout(200);

    // reload after clearing so we start from true first-boot state
    await page.goto("/skein.html");
    await waitForNarthex(page);
  });

  test("canvas-card is not crashed after navigate-back", async ({ page }) => {
    // create a canvas from the narthex
    await createCanvasAndWaitForNavigation(page, {
      title: "e2e test canvas",
      color: 0xd946ef,
    });

    // navigate back to the narthex
    await navigateBackToNarthex(page);

    // find all canvas-card widgets and assert none are crashed
    const cards = await getCanvasCards(page);
    expect(cards.length).toBeGreaterThanOrEqual(1);

    for (const card of cards) {
      expect(card.crashed, `canvas-card ${card.id} should not be crashed`).toBe(false);
    }
  });

  test("canvas-card canvasDocId is populated after navigate-back", async ({ page }) => {
    // create a canvas and record its doc id
    const newDocId = await createCanvasAndWaitForNavigation(page, {
      title: "e2e docid test",
      color: 0xd946ef,
    });

    expect(newDocId).toBeTruthy();

    // navigate back to narthex
    await navigateBackToNarthex(page);

    // find the canvas-card and verify its widgetDoc has the correct canvasDocId
    const result = await page.evaluate((expectedDocId) => {
      const skein = (window as any).__skein;
      const live = skein.widgetManager.getLiveWidgets();
      for (const [id, widget] of live.entries()) {
        const entry = (widget as any).entry;
        if (entry?.type === "canvas-card") {
          const widgetDoc = (widget as any).widgetDoc;
          if (widgetDoc) {
            const current = widgetDoc.current;
            if (current?.canvasDocId === expectedDocId) {
              return {
                found: true,
                widgetId: id,
                canvasDocId: current.canvasDocId,
                crashed: (widget as any).crashed,
              };
            }
          }
        }
      }
      // fallback: return info about all canvas-cards for debugging
      const allCards: Array<{
        id: string;
        crashed: boolean;
        hasWidgetDoc: boolean;
        canvasDocId: string | null;
      }> = [];
      for (const [id, widget] of live.entries()) {
        const entry = (widget as any).entry;
        if (entry?.type === "canvas-card") {
          const wd = (widget as any).widgetDoc;
          allCards.push({
            id,
            crashed: (widget as any).crashed,
            hasWidgetDoc: wd != null,
            canvasDocId: wd?.current?.canvasDocId ?? null,
          });
        }
      }
      return { found: false, allCards };
    }, newDocId);

    expect(result.found, `expected a canvas-card with canvasDocId=${newDocId}`).toBe(true);
    if (result.found) {
      expect(result.canvasDocId).toBe(newDocId);
      expect(result.crashed).toBe(false);
    }
  });

  test("click-to-open navigates to canvas", async ({ page }) => {
    // create a canvas so we have a canvas-card on the narthex
    const newDocId = await createCanvasAndWaitForNavigation(page, {
      title: "e2e click test",
      color: 0xd946ef,
    });

    // navigate back to the narthex
    await navigateBackToNarthex(page);

    // find the canvas-card's world position from the live widget entry
    const cardPos = await page.evaluate(() => {
      const skein = (window as any).__skein;
      const live = skein.widgetManager.getLiveWidgets();
      for (const [id, widget] of live.entries()) {
        const entry = (widget as any).entry;
        if (entry?.type === "canvas-card") {
          return { x: entry.x, y: entry.y, width: entry.width, height: entry.height };
        }
      }
      return null;
    });

    expect(cardPos, "should find a canvas-card widget on the narthex").not.toBeNull();

    // click within the card area (offset 50px from top-left to avoid edges)
    await page.mouse.click(cardPos!.x + 50, cardPos!.y + 50);

    // wait for hash to change — indicates navigation occurred
    await page.waitForFunction(() => window.location.hash.length > 1, { timeout: 10_000 });

    const hash = await page.evaluate(() => window.location.hash.slice(1));
    expect(hash).toBe(newDocId);
  });

  test("canvas-card survives page reload", async ({ page }) => {
    // create a canvas from the narthex
    await createCanvasAndWaitForNavigation(page, {
      title: "e2e reload test",
      color: 0xd946ef,
    });

    // navigate back to the narthex
    await navigateBackToNarthex(page);

    // reload the page entirely
    await page.reload();
    await waitForNarthex(page);

    // the canvas-card should still be present and not crashed
    const cards = await getCanvasCards(page);
    expect(cards.length).toBeGreaterThanOrEqual(1);

    for (const card of cards) {
      expect(card.crashed, `canvas-card ${card.id} should not be crashed after reload`).toBe(false);
    }
  });

  test("multiple canvas-cards survive navigate-back", async ({ page }) => {
    // create the first canvas
    const docId1 = await createCanvasAndWaitForNavigation(page, {
      title: "e2e multi test 1",
      color: 0xd946ef,
    });

    // navigate back to narthex
    await navigateBackToNarthex(page);

    // create the second canvas
    const docId2 = await createCanvasAndWaitForNavigation(page, {
      title: "e2e multi test 2",
      color: 0x3b82f6,
    });

    expect(docId1).not.toBe(docId2);

    // navigate back to narthex again
    await navigateBackToNarthex(page);

    // both canvas-cards should be present and not crashed
    const cards = await getCanvasCards(page);
    expect(cards.length).toBeGreaterThanOrEqual(2);

    const crashedCards = cards.filter((c) => c.crashed);
    expect(
      crashedCards.length,
      `expected 0 crashed cards but found ${crashedCards.length}: ${JSON.stringify(crashedCards)}`
    ).toBe(0);
  });
});
