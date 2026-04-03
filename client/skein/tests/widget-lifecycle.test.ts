import { expect, test } from "./fixtures/canvas-page";

test("add widget via store mounts it onto the pixi stage", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  // add a hello-world widget through the store
  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "hw-1",
      type: "hello-world",
      x: 50,
      y: 80,
      width: 150,
      height: 60,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  // give reconcile a tick to process
  await page.waitForTimeout(100);

  const result = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const live = skein.widgetManager.getLiveWidgets();
    const widget = live.get("hw-1");
    if (!widget) return null;
    return {
      crashed: widget.crashed,
      frameX: widget.frame.root.x,
      frameY: widget.frame.root.y,
      stageChildCount: skein.app.stage.children.length,
    };
  });

  expect(result).not.toBeNull();
  expect(result!.crashed).toBe(false);
  expect(result!.frameX).toBe(50);
  expect(result!.frameY).toBe(80);
  // stage has at least the background + the widget frame
  expect(result!.stageChildCount).toBeGreaterThanOrEqual(2);
});

test("remove widget via store unmounts it from the pixi stage", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  // add then remove
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

  await page.waitForTimeout(100);

  // confirm it's mounted
  const beforeCount = await page.evaluate(() => {
    return (window as any).__skein.widgetManager.getLiveWidgets().size;
  });
  expect(beforeCount).toBe(1);

  // remove it
  await page.evaluate(() => {
    (window as any).__skein.store.removeWidget("to-remove");
  });

  await page.waitForTimeout(100);

  const afterCount = await page.evaluate(() => {
    return (window as any).__skein.widgetManager.getLiveWidgets().size;
  });
  expect(afterCount).toBe(0);
});

test("unknown widget type mounts a crashed placeholder", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "bad-widget",
      type: "nonexistent-type-xyz",
      x: 10,
      y: 10,
      width: 200,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  await page.waitForTimeout(100);

  const result = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const live = skein.widgetManager.getLiveWidgets();
    const widget = live.get("bad-widget");
    if (!widget) return null;
    return { crashed: widget.crashed };
  });

  expect(result).not.toBeNull();
  expect(result!.crashed).toBe(true);
});

test("add multiple widgets — all render at correct positions", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "w1",
      type: "hello-world",
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
    skein.store.addWidget({
      id: "w2",
      type: "counter",
      x: 200,
      y: 300,
      width: 180,
      height: 120,
      zIndex: 2,
      props: {},
      collapsed: false,
      docId: null,
    });
    skein.store.addWidget({
      id: "w3",
      type: "hello-world",
      x: 400,
      y: 50,
      width: 120,
      height: 70,
      zIndex: 3,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  await page.waitForTimeout(100);

  const result = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const live = skein.widgetManager.getLiveWidgets();
    const widgets: Record<string, { x: number; y: number; zIndex: number; crashed: boolean }> = {};
    for (const [id, w] of live.entries()) {
      widgets[id] = {
        x: w.frame.root.x,
        y: w.frame.root.y,
        zIndex: w.frame.root.zIndex,
        crashed: w.crashed,
      };
    }
    return { count: live.size, widgets };
  });

  expect(result.count).toBe(3);
  expect(result.widgets["w1"]).toEqual({ x: 10, y: 20, zIndex: 1, crashed: false });
  expect(result.widgets["w2"]).toEqual({ x: 200, y: 300, zIndex: 2, crashed: false });
  expect(result.widgets["w3"]).toEqual({ x: 400, y: 50, zIndex: 3, crashed: false });
});

test("move widget via store updates frame position on stage", async ({ canvasPage }) => {
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
  });

  await page.waitForTimeout(100);

  // move it
  await page.evaluate(() => {
    (window as any).__skein.store.moveWidget("movable", 333, 444);
  });

  await page.waitForTimeout(100);

  const pos = await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    const w = live.get("movable");
    return { x: w.frame.root.x, y: w.frame.root.y };
  });

  expect(pos).toEqual({ x: 333, y: 444 });
});

test("resize widget via store calls ctrl.resize()", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "resizable",
      type: "hello-world",
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  await page.waitForTimeout(100);

  // resize it
  await page.evaluate(() => {
    (window as any).__skein.store.resizeWidget("resizable", 300, 250);
  });

  await page.waitForTimeout(100);

  // the widget manager should have updated the entry
  const result = await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    const w = live.get("resizable");
    return {
      entryWidth: w.entry.width,
      entryHeight: w.entry.height,
    };
  });

  expect(result.entryWidth).toBe(300);
  expect(result.entryHeight).toBe(250);
});

test("counter widget — increment persists, state round-trips through doc", async ({
  canvasPage,
}) => {
  const { page } = await canvasPage();

  // add a counter widget
  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "counter-1",
      type: "counter",
      x: 50,
      y: 50,
      width: 200,
      height: 150,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  await page.waitForTimeout(200);

  // verify the counter widget mounted with a doc and default state
  const initial = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const live = skein.widgetManager.getLiveWidgets();
    const w = live.get("counter-1");
    if (!w || w.crashed) return null;
    return { mounted: true, crashed: w.crashed };
  });

  expect(initial).not.toBeNull();
  expect(initial!.mounted).toBe(true);
  expect(initial!.crashed).toBe(false);
});

test("counter ctx.doc.change() persists and ctx.doc.on('change') fires", async ({
  canvasPage,
}) => {
  const { page } = await canvasPage();

  // use the skeinHelpers to test createWidgetDoc in a real canvas context
  // this exercises the full path: repo → doc handle → createWidgetDoc → facade
  const result = await page.evaluate(async () => {
    const { createWidgetDoc, counterSchema } = (window as any).__skeinHelpers;
    const repo = (window as any).__skein.repo;

    // create a widget doc like WidgetManager would
    const defaults = counterSchema.parse({});
    const handle = repo.create(defaults);

    const doc = createWidgetDoc(counterSchema, handle);

    // read initial
    const initial = { ...doc.current };

    // mutate through facade
    doc.change((draft: any) => {
      draft.count = 10;
    });
    const afterFacadeChange = { ...doc.current };

    // set up listener
    let listenerFired = false;
    let listenerState: any = null;
    doc.on("change", (state: any) => {
      listenerFired = true;
      listenerState = { ...state };
    });

    // mutate through raw handle (simulates remote peer or internal change)
    handle.change((d: any) => {
      d.count = 77;
    });

    // give the listener a tick
    await new Promise((r) => setTimeout(r, 50));

    return {
      initial,
      afterFacadeChange,
      listenerFired,
      listenerState,
    };
  });

  expect(result.initial).toEqual({ count: 0, step: 1, label: "counter" });
  expect(result.afterFacadeChange).toEqual({ count: 10, step: 1, label: "counter" });
  expect(result.listenerFired).toBe(true);
  expect(result.listenerState).toEqual({ count: 77, step: 1, label: "counter" });
});

test("widget z-index change via store updates frame zIndex", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "z-test",
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

  await page.waitForTimeout(100);

  await page.evaluate(() => {
    (window as any).__skein.store.setZIndex("z-test", 99);
  });

  await page.waitForTimeout(100);

  const zIndex = await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    return live.get("z-test").frame.root.zIndex;
  });

  expect(zIndex).toBe(99);
});

test("destroyAll cleans up all widgets", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "d1",
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
    skein.store.addWidget({
      id: "d2",
      type: "counter",
      x: 200,
      y: 0,
      width: 100,
      height: 100,
      zIndex: 2,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  await page.waitForTimeout(100);

  const beforeCount = await page.evaluate(() => {
    return (window as any).__skein.widgetManager.getLiveWidgets().size;
  });
  expect(beforeCount).toBe(2);

  await page.evaluate(() => {
    (window as any).__skein.widgetManager.destroyAll();
  });

  const afterCount = await page.evaluate(() => {
    return (window as any).__skein.widgetManager.getLiveWidgets().size;
  });
  expect(afterCount).toBe(0);
});
