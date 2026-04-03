import { expect, test } from "./fixtures/canvas-page";

test("canvas mounts with empty document", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  // verify a canvas element was created by pixi
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();

  // verify the canvas is inside our mount point
  const canvasParent = page.locator("#canvas-root canvas");
  await expect(canvasParent).toBeVisible();

  // verify the document was created with zero widgets
  const widgetCount = await page.evaluate(() => {
    const skein = (window as any).__skein;
    return Object.keys(skein.store.doc().widgets).length;
  });
  expect(widgetCount).toBe(0);
});

test("canvas document has correct initial structure", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const doc = await page.evaluate(() => {
    return (window as any).__skein.store.doc();
  });

  expect(doc.version).toBe(1);
  expect(doc.widgets).toEqual({});
});

test("canvasDocId is returned and is a non-empty string", async ({ canvasPage }) => {
  const handle = await canvasPage();
  expect(handle.canvasDocId).toBeTruthy();
  expect(typeof handle.canvasDocId).toBe("string");
  expect(handle.canvasDocId.length).toBeGreaterThan(0);
});

test("store.addWidget writes to the document", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const widgetId = await page.evaluate(() => {
    const skein = (window as any).__skein;
    return skein.store.addWidget({
      id: "test-widget-1",
      type: "hello-world",
      x: 100,
      y: 200,
      width: 150,
      height: 80,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  expect(widgetId).toBe("test-widget-1");

  const widget = await page.evaluate(() => {
    return (window as any).__skein.store.getWidget("test-widget-1");
  });

  expect(widget).not.toBeNull();
  expect(widget.type).toBe("hello-world");
  expect(widget.x).toBe(100);
  expect(widget.y).toBe(200);
});

test("store.removeWidget removes from the document", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "to-remove",
      type: "hello-world",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  // confirm it's there
  const countBefore = await page.evaluate(() => {
    return (window as any).__skein.store.widgetCount();
  });
  expect(countBefore).toBe(1);

  // remove it
  await page.evaluate(() => {
    (window as any).__skein.store.removeWidget("to-remove");
  });

  const countAfter = await page.evaluate(() => {
    return (window as any).__skein.store.widgetCount();
  });
  expect(countAfter).toBe(0);
});

test("store.moveWidget updates position", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "movable",
      type: "hello-world",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
    skein.store.moveWidget("movable", 300, 450);
  });

  const pos = await page.evaluate(() => {
    const w = (window as any).__skein.store.getWidget("movable");
    return { x: w.x, y: w.y };
  });

  expect(pos).toEqual({ x: 300, y: 450 });
});

test("registry contains the expected widget types", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const types = await page.evaluate(() => {
    return (window as any).__skein.registry.types();
  });

  expect(types).toContain("hello-world");
  expect(types).toContain("counter");
  expect(types).toContain("label");
  expect(types).toContain("notepad");
  expect(types).toHaveLength(4);
});

test("canvas persists widgets across sessions via IndexedDB", async ({ browser }) => {
  // persistence needs both sessions to share the same browser context
  // so they share the same IndexedDB storage
  const context = await browser.newContext();

  // session 1: create a canvas and add a widget
  const page1 = await context.newPage();
  await page1.goto("/test-harness.html");
  await page1.waitForFunction(() => typeof (window as any).__initSkeinForTest === "function", {
    timeout: 10000,
  });

  const { canvasDocId } = await page1.evaluate(async () => {
    return (window as any).__initSkeinForTest({ canvasDocId: null });
  });

  await page1.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "persistent-widget",
      type: "counter",
      x: 42,
      y: 77,
      width: 200,
      height: 150,
      zIndex: 3,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  // confirm it's there before we close
  const countInFirstSession = await page1.evaluate(() => {
    return (window as any).__skein.store.widgetCount();
  });
  expect(countInFirstSession).toBe(1);

  // give IndexedDB a moment to flush
  await page1.waitForTimeout(500);
  await page1.close();

  // session 2: new page in the SAME context (shares IndexedDB)
  const page2 = await context.newPage();
  await page2.goto("/test-harness.html");
  await page2.waitForFunction(() => typeof (window as any).__initSkeinForTest === "function", {
    timeout: 10000,
  });

  await page2.evaluate(async (docId) => {
    return (window as any).__initSkeinForTest({ canvasDocId: docId });
  }, canvasDocId);

  // the widget should have survived the round-trip
  const countInSecondSession = await page2.evaluate(() => {
    return (window as any).__skein.store.widgetCount();
  });
  expect(countInSecondSession).toBe(1);

  const widget = await page2.evaluate(() => {
    return (window as any).__skein.store.getWidget("persistent-widget");
  });

  expect(widget).not.toBeNull();
  expect(widget.type).toBe("counter");
  expect(widget.x).toBe(42);
  expect(widget.y).toBe(77);
  expect(widget.zIndex).toBe(3);

  await context.close();
});

test("destroy removes the canvas from the DOM", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  // canvas should be present
  await expect(page.locator("#canvas-root canvas")).toBeVisible();

  // destroy the skein instance
  await page.evaluate(() => {
    (window as any).__skein.destroy();
  });

  // canvas should be gone
  await expect(page.locator("#canvas-root canvas")).toHaveCount(0);
});

test("counter widget state round-trip via createWidgetDoc", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const result = await page.evaluate(async () => {
    const { createWidgetDoc, counterSchema } = (window as any).__skeinHelpers;
    const repo = (window as any).__skein.repo;

    // create a fresh doc handle for the counter state
    const handle = repo.create();
    const defaults = counterSchema.parse({});
    handle.change((doc: any) => Object.assign(doc, defaults));

    // create the validated facade
    const widgetDoc = createWidgetDoc(counterSchema, handle);

    // verify defaults
    const initial = { ...widgetDoc.current };

    // mutate via the facade
    widgetDoc.change((draft: any) => {
      draft.count = 42;
    });
    const afterChange = { ...widgetDoc.current };

    // subscribe to changes and mutate via the raw handle (simulates remote peer)
    let listenerState: any = null;
    widgetDoc.on("change", (state: any) => {
      listenerState = { ...state };
    });

    handle.change((doc: any) => {
      doc.count = 99;
    });

    // give the listener a tick to fire
    await new Promise((r) => setTimeout(r, 50));

    return {
      initial,
      afterChange,
      listenerState,
    };
  });

  expect(result.initial).toEqual({ count: 0, step: 1, label: "counter" });
  expect(result.afterChange).toEqual({ count: 42, step: 1, label: "counter" });
  expect(result.listenerState).toEqual({ count: 99, step: 1, label: "counter" });
});
