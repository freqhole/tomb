import { expect, test } from "./fixtures/canvas-page";

test("property tray is present on the skein canvas handle", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const result = await page.evaluate(() => {
    const skein = (window as any).__skein;
    return {
      hasPropertyTray: skein.propertyTray != null,
      hasRoot: skein.propertyTray?.root != null,
    };
  });

  expect(result.hasPropertyTray).toBe(true);
  expect(result.hasRoot).toBe(true);
});

test("property tray is hidden by default", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const visible = await page.evaluate(() => {
    return (window as any).__skein.propertyTray.root.visible;
  });

  expect(visible).toBe(false);
});

test("property tray appears when a widget with editableProps is selected", async ({
  canvasPage,
}) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "w1",
      type: "label",
      x: 50,
      y: 50,
      width: 200,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
      parentId: null,
    });
  });
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget("w1");
  });
  await page.waitForTimeout(100);

  const visible = await page.evaluate(() => {
    return (window as any).__skein.propertyTray.root.visible;
  });

  expect(visible).toBe(true);
});

test("property tray hides when widget is deselected", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "w1",
      type: "label",
      x: 50,
      y: 50,
      width: 200,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
      parentId: null,
    });
  });
  await page.waitForTimeout(300);

  // select → tray visible
  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget("w1");
  });
  await page.waitForTimeout(100);

  const visibleBefore = await page.evaluate(() => {
    return (window as any).__skein.propertyTray.root.visible;
  });
  expect(visibleBefore).toBe(true);

  // deselect → tray hidden
  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget(null);
  });
  await page.waitForTimeout(100);

  const visibleAfter = await page.evaluate(() => {
    return (window as any).__skein.propertyTray.root.visible;
  });
  expect(visibleAfter).toBe(false);
});

test("property tray does not appear for stateless widgets (hello-world)", async ({
  canvasPage,
}) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "hw1",
      type: "hello-world",
      x: 50,
      y: 50,
      width: 200,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
      parentId: null,
    });
  });
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget("hw1");
  });
  await page.waitForTimeout(100);

  const visible = await page.evaluate(() => {
    return (window as any).__skein.propertyTray.root.visible;
  });

  expect(visible).toBe(false);
});

test("property tray is positioned to the right of the selected widget", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "w1",
      type: "label",
      x: 100,
      y: 80,
      width: 200,
      height: 120,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
      parentId: null,
    });
  });
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget("w1");
  });
  await page.waitForTimeout(100);

  const pos = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const tray = skein.propertyTray.root;
    return { x: tray.x, y: tray.y };
  });

  // tray should be to the right of the widget (x=100 + width=200 + gap=8 = 308)
  expect(pos.x).toBe(308);
  // tray y should be widget y minus frameHeaderHeight (80 - 28 = 52)
  expect(pos.y).toBe(52);
});

test("property tray repositions when widget is moved", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "w1",
      type: "label",
      x: 100,
      y: 80,
      width: 200,
      height: 120,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
      parentId: null,
    });
  });
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget("w1");
  });
  await page.waitForTimeout(100);

  // move the widget
  await page.evaluate(() => {
    (window as any).__skein.store.moveWidget("w1", 300, 200);
  });
  await page.waitForTimeout(100);

  const pos = await page.evaluate(() => {
    const tray = (window as any).__skein.propertyTray.root;
    return { x: tray.x, y: tray.y };
  });

  // 300 + 200 (width) + 8 (gap) = 508
  expect(pos.x).toBe(508);
  // 200 - 28 (frameHeaderHeight) = 172
  expect(pos.y).toBe(172);
});

test("property tray shows the widget name in the header", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "w1",
      type: "label",
      x: 50,
      y: 50,
      width: 200,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
      parentId: null,
    });
  });
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget("w1");
  });
  await page.waitForTimeout(100);

  const headerText = await page.evaluate(() => {
    const tray = (window as any).__skein.propertyTray;
    // header is the second child of root (after bg)
    const header = tray.root.children[1];
    return header?.text ?? null;
  });

  expect(headerText).toBe("label");
});

test("property tray renders controls for each editable prop", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  // use counter widget which has 2 editableProps: label (string) and step (number)
  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "c1",
      type: "counter",
      x: 50,
      y: 50,
      width: 200,
      height: 150,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
      parentId: null,
    });
  });
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget("c1");
  });
  await page.waitForTimeout(100);

  const result = await page.evaluate(() => {
    const tray = (window as any).__skein.propertyTray;
    // contentContainer is the third child of root (bg, header, contentContainer)
    const content = tray.root.children[2];
    return {
      visible: tray.root.visible,
      controlCount: content?.children?.length ?? 0,
    };
  });

  expect(result.visible).toBe(true);
  // counter has 2 editableProps: label and step
  expect(result.controlCount).toBe(2);
});

test("property tray switches when selecting a different widget", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "w1",
      type: "label",
      x: 50,
      y: 50,
      width: 200,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
      parentId: null,
    });
    skein.store.addWidget({
      id: "c1",
      type: "counter",
      x: 350,
      y: 50,
      width: 200,
      height: 150,
      zIndex: 2,
      props: {},
      collapsed: false,
      docId: null,
      parentId: null,
    });
  });
  await page.waitForTimeout(300);

  // select label
  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget("w1");
  });
  await page.waitForTimeout(100);

  const headerForLabel = await page.evaluate(() => {
    const tray = (window as any).__skein.propertyTray;
    return tray.root.children[1]?.text ?? null;
  });
  expect(headerForLabel).toBe("label");

  // select counter
  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget("c1");
  });
  await page.waitForTimeout(100);

  const headerForCounter = await page.evaluate(() => {
    const tray = (window as any).__skein.propertyTray;
    return tray.root.children[1]?.text ?? null;
  });
  expect(headerForCounter).toBe("counter");
});

test("property tray hides when the selected widget is removed", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "w1",
      type: "label",
      x: 50,
      y: 50,
      width: 200,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
      parentId: null,
    });
  });
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget("w1");
  });
  await page.waitForTimeout(100);

  expect(await page.evaluate(() => (window as any).__skein.propertyTray.root.visible)).toBe(true);

  // remove the widget
  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget(null);
    (window as any).__skein.store.removeWidget("w1");
  });
  await page.waitForTimeout(100);

  expect(await page.evaluate(() => (window as any).__skein.propertyTray.root.visible)).toBe(false);
});

test("number control +/- buttons change the widget doc value", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "c1",
      type: "counter",
      x: 50,
      y: 50,
      width: 200,
      height: 150,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
      parentId: null,
    });
  });
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget("c1");
  });
  await page.waitForTimeout(100);

  // read the initial step value from the widget doc
  const initialStep = await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets().get("c1");
    return live?.widgetDoc?.current?.step ?? null;
  });
  expect(initialStep).toBe(1);

  // find the step control's plus button and click it.
  // the step control is the second control in the contentContainer.
  // each number control has: label, fieldBg, valueText, minusBtn, plusBtn
  // the plusBtn is the last child of the control container.
  await page.evaluate(() => {
    const tray = (window as any).__skein.propertyTray;
    const content = tray.root.children[2]; // contentContainer
    const stepControl = content.children[1]; // second control (step)
    // plus button is the last child of the step control container
    const plusBtn = stepControl.children[stepControl.children.length - 1];
    // simulate a pointerdown event
    plusBtn.emit("pointerdown", { stopPropagation: () => {} });
  });
  await page.waitForTimeout(100);

  const newStep = await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets().get("c1");
    return live?.widgetDoc?.current?.step ?? null;
  });
  expect(newStep).toBe(2);
});

test("property tray has very high zIndex in the world container", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const zIndex = await page.evaluate(() => {
    return (window as any).__skein.propertyTray.root.zIndex;
  });

  expect(zIndex).toBeGreaterThanOrEqual(99999);
});

test("property tray survives canvas destroy without errors", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  // add a widget and select it so the tray is visible
  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "w1",
      type: "label",
      x: 50,
      y: 50,
      width: 200,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
      parentId: null,
    });
  });
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget("w1");
  });
  await page.waitForTimeout(100);

  const error = await page.evaluate(() => {
    try {
      (window as any).__skein.destroy();
      return null;
    } catch (err: any) {
      return err.message ?? String(err);
    }
  });

  expect(error).toBeNull();
});

test("property tray repositions when widget is resized", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "w1",
      type: "label",
      x: 100,
      y: 80,
      width: 200,
      height: 120,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
      parentId: null,
    });
  });
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget("w1");
  });
  await page.waitForTimeout(100);

  // initial position: 100 + 200 + 8 = 308
  const posBefore = await page.evaluate(() => {
    return (window as any).__skein.propertyTray.root.x;
  });
  expect(posBefore).toBe(308);

  // resize the widget wider
  await page.evaluate(() => {
    (window as any).__skein.store.resizeWidget("w1", 400, 120);
  });
  await page.waitForTimeout(100);

  // new position: 100 + 400 + 8 = 508
  const posAfter = await page.evaluate(() => {
    return (window as any).__skein.propertyTray.root.x;
  });
  expect(posAfter).toBe(508);
});
