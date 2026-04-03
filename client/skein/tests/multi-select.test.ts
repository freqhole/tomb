import { expect, test } from "./fixtures/canvas-page";

test("inputRouter.selectedWidgetIds is empty by default", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const size = await page.evaluate(() => {
    return (window as any).__skein.inputRouter.selectedWidgetIds.size;
  });
  expect(size).toBe(0);
});

test("selectWidget sets both selectedWidgetId and selectedWidgetIds", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "w-1",
      type: "counter",
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });
  await page.waitForTimeout(100);

  // enter edit mode
  await page.keyboard.press("e");

  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget("w-1");
  });

  const result = await page.evaluate(() => {
    const router = (window as any).__skein.inputRouter;
    return {
      selectedWidgetId: router.selectedWidgetId,
      selectedWidgetIds: Array.from(router.selectedWidgetIds),
    };
  });

  expect(result.selectedWidgetId).toBe("w-1");
  expect(result.selectedWidgetIds).toEqual(["w-1"]);
});

test("selectWidgets multi-selects multiple widgets", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "w-1",
      type: "hello-world",
      x: 50,
      y: 50,
      width: 150,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
    skein.store.addWidget({
      id: "w-2",
      type: "counter",
      x: 250,
      y: 50,
      width: 150,
      height: 100,
      zIndex: 2,
      props: {},
      collapsed: false,
      docId: null,
    });
    skein.store.addWidget({
      id: "w-3",
      type: "label",
      x: 450,
      y: 50,
      width: 150,
      height: 100,
      zIndex: 3,
      props: {},
      collapsed: false,
      docId: null,
    });
  });
  await page.waitForTimeout(100);

  await page.keyboard.press("e");

  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidgets(["w-1", "w-2"]);
  });

  const result = await page.evaluate(() => {
    const router = (window as any).__skein.inputRouter;
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    return {
      selectedWidgetId: router.selectedWidgetId,
      selectedWidgetIdsSize: router.selectedWidgetIds.size,
      hasW1: router.selectedWidgetIds.has("w-1"),
      hasW2: router.selectedWidgetIds.has("w-2"),
      hasW3: router.selectedWidgetIds.has("w-3"),
      frameW1Selected: live.get("w-1").frame._selected,
      frameW2Selected: live.get("w-2").frame._selected,
      frameW3Selected: live.get("w-3").frame._selected,
    };
  });

  expect(result.selectedWidgetIdsSize).toBe(2);
  // multi-select means no single primary selection
  expect(result.selectedWidgetId).toBeNull();
  expect(result.hasW1).toBe(true);
  expect(result.hasW2).toBe(true);
  expect(result.hasW3).toBe(false);
  expect(result.frameW1Selected).toBe(true);
  expect(result.frameW2Selected).toBe(true);
  expect(result.frameW3Selected).toBe(false);
});

test("toggleWidgetInSelection adds and removes widgets", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "w-1",
      type: "hello-world",
      x: 50,
      y: 50,
      width: 150,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
    skein.store.addWidget({
      id: "w-2",
      type: "counter",
      x: 300,
      y: 50,
      width: 150,
      height: 100,
      zIndex: 2,
      props: {},
      collapsed: false,
      docId: null,
    });
  });
  await page.waitForTimeout(100);

  await page.keyboard.press("e");

  // start by selecting w-1
  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget("w-1");
  });

  // toggle w-2 into the selection
  await page.evaluate(() => {
    (window as any).__skein.inputRouter.toggleWidgetInSelection("w-2");
  });

  const afterAdd = await page.evaluate(() => {
    const router = (window as any).__skein.inputRouter;
    return {
      size: router.selectedWidgetIds.size,
      hasW1: router.selectedWidgetIds.has("w-1"),
      hasW2: router.selectedWidgetIds.has("w-2"),
    };
  });

  expect(afterAdd.size).toBe(2);
  expect(afterAdd.hasW1).toBe(true);
  expect(afterAdd.hasW2).toBe(true);

  // toggle w-1 out of the selection — only w-2 should remain and become primary
  await page.evaluate(() => {
    (window as any).__skein.inputRouter.toggleWidgetInSelection("w-1");
  });

  const afterRemove = await page.evaluate(() => {
    const router = (window as any).__skein.inputRouter;
    return {
      size: router.selectedWidgetIds.size,
      hasW1: router.selectedWidgetIds.has("w-1"),
      hasW2: router.selectedWidgetIds.has("w-2"),
      selectedWidgetId: router.selectedWidgetId,
    };
  });

  expect(afterRemove.size).toBe(1);
  expect(afterRemove.hasW1).toBe(false);
  expect(afterRemove.hasW2).toBe(true);
  // when only one widget remains, it becomes the primary selection
  expect(afterRemove.selectedWidgetId).toBe("w-2");
});

test("multi-select clears when switching to view mode", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "w-1",
      type: "hello-world",
      x: 50,
      y: 50,
      width: 150,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
    skein.store.addWidget({
      id: "w-2",
      type: "counter",
      x: 300,
      y: 50,
      width: 150,
      height: 100,
      zIndex: 2,
      props: {},
      collapsed: false,
      docId: null,
    });
  });
  await page.waitForTimeout(100);

  // enter edit mode and multi-select
  await page.keyboard.press("e");

  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidgets(["w-1", "w-2"]);
  });

  // confirm they're selected
  const beforeSize = await page.evaluate(() => {
    return (window as any).__skein.inputRouter.selectedWidgetIds.size;
  });
  expect(beforeSize).toBe(2);

  // press 'e' to toggle back to view mode
  await page.keyboard.press("e");

  const afterSize = await page.evaluate(() => {
    return (window as any).__skein.inputRouter.selectedWidgetIds.size;
  });
  expect(afterSize).toBe(0);
});

test("delete key removes all selected widgets", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "w-1",
      type: "hello-world",
      x: 50,
      y: 50,
      width: 150,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
    skein.store.addWidget({
      id: "w-2",
      type: "counter",
      x: 250,
      y: 50,
      width: 150,
      height: 100,
      zIndex: 2,
      props: {},
      collapsed: false,
      docId: null,
    });
    skein.store.addWidget({
      id: "w-3",
      type: "label",
      x: 450,
      y: 50,
      width: 150,
      height: 100,
      zIndex: 3,
      props: {},
      collapsed: false,
      docId: null,
    });
  });
  await page.waitForTimeout(100);

  // enter edit mode and multi-select w-1 and w-2
  await page.keyboard.press("e");

  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidgets(["w-1", "w-2"]);
  });

  // press delete to remove the selected widgets
  await page.keyboard.press("Delete");
  await page.waitForTimeout(200);

  const result = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const storeCount = skein.store.widgetCount();
    const liveCount = skein.widgetManager.getLiveWidgets().size;
    const w3Exists = skein.store.getWidget("w-3") !== null;
    const w1Exists = skein.store.getWidget("w-1") !== null;
    const w2Exists = skein.store.getWidget("w-2") !== null;
    return { storeCount, liveCount, w3Exists, w1Exists, w2Exists };
  });

  expect(result.storeCount).toBe(1);
  expect(result.liveCount).toBe(1);
  expect(result.w3Exists).toBe(true);
  expect(result.w1Exists).toBe(false);
  expect(result.w2Exists).toBe(false);
});

test("property tray hides during multi-selection", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "w-1",
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
    skein.store.addWidget({
      id: "w-2",
      type: "counter",
      x: 300,
      y: 50,
      width: 200,
      height: 150,
      zIndex: 2,
      props: {},
      collapsed: false,
      docId: null,
    });
  });
  await page.waitForTimeout(200);

  // enter edit mode and select a single widget — tray should be visible
  await page.keyboard.press("e");

  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget("w-1");
  });
  await page.waitForTimeout(100);

  const visibleSingle = await page.evaluate(() => {
    return (window as any).__skein.propertyTray.root.visible;
  });
  expect(visibleSingle).toBe(true);

  // multi-select both widgets — tray should hide
  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidgets(["w-1", "w-2"]);
  });
  await page.waitForTimeout(100);

  const visibleMulti = await page.evaluate(() => {
    return (window as any).__skein.propertyTray.root.visible;
  });
  expect(visibleMulti).toBe(false);

  // go back to single selection — tray should reappear
  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget("w-1");
  });
  await page.waitForTimeout(100);

  const visibleAgain = await page.evaluate(() => {
    return (window as any).__skein.propertyTray.root.visible;
  });
  expect(visibleAgain).toBe(true);
});

test("multi-selection frames show selected border", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "w-1",
      type: "hello-world",
      x: 50,
      y: 50,
      width: 150,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
    skein.store.addWidget({
      id: "w-2",
      type: "counter",
      x: 250,
      y: 50,
      width: 150,
      height: 100,
      zIndex: 2,
      props: {},
      collapsed: false,
      docId: null,
    });
    skein.store.addWidget({
      id: "w-3",
      type: "label",
      x: 450,
      y: 50,
      width: 150,
      height: 100,
      zIndex: 3,
      props: {},
      collapsed: false,
      docId: null,
    });
  });
  await page.waitForTimeout(100);

  await page.keyboard.press("e");

  // multi-select w-1 and w-3, leaving w-2 unselected
  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidgets(["w-1", "w-3"]);
  });

  const result = await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    return {
      w1Selected: live.get("w-1").frame._selected,
      w2Selected: live.get("w-2").frame._selected,
      w3Selected: live.get("w-3").frame._selected,
    };
  });

  expect(result.w1Selected).toBe(true);
  expect(result.w2Selected).toBe(false);
  expect(result.w3Selected).toBe(true);
});

test("lasso tool is present on the skein canvas handle", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const result = await page.evaluate(() => {
    const skein = (window as any).__skein;
    return {
      exists: !!skein.lassoTool,
      notDestroyed: !skein.lassoTool.destroyed,
    };
  });

  expect(result.exists).toBe(true);
  expect(result.notDestroyed).toBe(true);
});

test("batch drag moves all selected widgets together", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  // add two widgets at known positions
  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "w-1",
      type: "hello-world",
      x: 100,
      y: 100,
      width: 150,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
    skein.store.addWidget({
      id: "w-2",
      type: "counter",
      x: 300,
      y: 200,
      width: 150,
      height: 100,
      zIndex: 2,
      props: {},
      collapsed: false,
      docId: null,
    });
  });
  await page.waitForTimeout(100);

  // enter edit mode and multi-select both widgets
  await page.keyboard.press("e");

  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidgets(["w-1", "w-2"]);
  });

  // simulate a batch drag via w-1's frame callbacks:
  // start drag, apply delta, end drag, commit move
  await page.evaluate(() => {
    const skein = (window as any).__skein;
    const live = skein.widgetManager.getLiveWidgets();
    const w1 = live.get("w-1");
    const callbacks = w1.frame.callbacks;

    callbacks.onDragStart();
    callbacks.onDragDelta(50, 30);
    callbacks.onDragEnd();
    // commit the final position for w-1
    callbacks.onMove(150, 130);
  });
  await page.waitForTimeout(200);

  // read committed positions from the store
  const positions = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const w1 = skein.store.getWidget("w-1");
    const w2 = skein.store.getWidget("w-2");
    return {
      w1x: w1.x,
      w1y: w1.y,
      w2x: w2.x,
      w2y: w2.y,
    };
  });

  // w-1 was at (100, 100), dragged by delta (50, 30) → (150, 130)
  expect(positions.w1x).toBe(150);
  expect(positions.w1y).toBe(130);

  // w-2 was at (300, 200), should have moved by the same delta → (350, 230)
  expect(positions.w2x).toBe(350);
  expect(positions.w2y).toBe(230);
});
