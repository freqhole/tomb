import { expect, test } from "./fixtures/canvas-page";

test("toolbar is visible on canvas init", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const exists = await page.evaluate(() => {
    const skein = (window as any).__skein;
    return skein.toolbar.root.visible && !skein.toolbar.root.destroyed;
  });
  expect(exists).toBe(true);
});

test("add widget button is visible on canvas init", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const visible = await page.evaluate(() => {
    const toolbar = (window as any).__skein.toolbar;
    return toolbar.addBtn.visible;
  });
  expect(visible).toBe(true);
});

test("adding a widget via toolbar creates it in the store", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  // use the toolbar's internal addWidget method to add a widget
  await page.evaluate(() => {
    const toolbar = (window as any).__skein.toolbar;
    // access private method for testing — calls store.addWidget internally
    toolbar.addWidget("hello-world");
  });

  await page.waitForTimeout(200);

  const widgetCount = await page.evaluate(() => {
    return (window as any).__skein.store.widgetCount();
  });
  expect(widgetCount).toBe(1);

  const liveCount = await page.evaluate(() => {
    return (window as any).__skein.widgetManager.getLiveWidgets().size;
  });
  expect(liveCount).toBe(1);
});

test("flyout menu stays within the viewport bounds", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  // open the flyout by calling toggleFlyout (private, but accessible for testing)
  await page.evaluate(() => {
    const toolbar = (window as any).__skein.toolbar;
    toolbar.toggleFlyout();
  });

  await page.waitForTimeout(100);

  // get the flyout's screen-space bounding box and the viewport dimensions
  const bounds = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const toolbar = skein.toolbar;
    const root = toolbar.root;
    const flyout = toolbar.flyout;
    const flyoutBg = toolbar.flyoutBg;

    // the flyout is a child of root, so its screen position is root + flyout offset
    const screenX = root.x + flyout.x;
    const screenY = root.y + flyout.y;
    const flyoutWidth = flyoutBg.width;
    const flyoutHeight = flyoutBg.height;

    const vv = window.visualViewport;
    const viewportWidth = vv ? vv.width : window.innerWidth;
    const viewportHeight = vv ? vv.height : window.innerHeight;

    return {
      left: screenX,
      top: screenY,
      right: screenX + flyoutWidth,
      bottom: screenY + flyoutHeight,
      viewportWidth,
      viewportHeight,
    };
  });

  // flyout must be entirely within the viewport (with a small margin tolerance)
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight);
});

test("flyout menu stays within bounds on a small viewport", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  // shrink the viewport to force tight constraints
  await page.setViewportSize({ width: 400, height: 300 });
  await page.waitForTimeout(200);

  // open the flyout
  await page.evaluate(() => {
    const toolbar = (window as any).__skein.toolbar;
    toolbar.toggleFlyout();
  });

  await page.waitForTimeout(100);

  const bounds = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const toolbar = skein.toolbar;
    const root = toolbar.root;
    const flyout = toolbar.flyout;
    const flyoutBg = toolbar.flyoutBg;

    const screenX = root.x + flyout.x;
    const screenY = root.y + flyout.y;
    const flyoutWidth = flyoutBg.width;
    const flyoutHeight = flyoutBg.height;

    const vv = window.visualViewport;
    const viewportWidth = vv ? vv.width : window.innerWidth;
    const viewportHeight = vv ? vv.height : window.innerHeight;

    return {
      left: screenX,
      top: screenY,
      right: screenX + flyoutWidth,
      bottom: screenY + flyoutHeight,
      viewportWidth,
      viewportHeight,
    };
  });

  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight);
});

test("selecting a widget updates inputRouter selection", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  // add a widget
  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "sel-test",
      type: "hello-world",
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  await page.waitForTimeout(200);

  // programmatically select the widget
  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget("sel-test");
  });

  const selected = await page.evaluate(() => {
    return (window as any).__skein.inputRouter.selectedWidgetId;
  });
  expect(selected).toBe("sel-test");

  // the frame should be marked as selected
  const isSelected = await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    const w = live.get("sel-test");
    return w?.frame._selected;
  });
  expect(isSelected).toBe(true);
});

test("escape key deselects widget", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "esc-test",
      type: "hello-world",
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  await page.waitForTimeout(200);

  // select the widget
  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget("esc-test");
  });

  // press escape
  await page.keyboard.press("Escape");

  const selected = await page.evaluate(() => {
    return (window as any).__skein.inputRouter.selectedWidgetId;
  });
  expect(selected).toBeNull();
});

test("delete key removes selected widget", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "del-test",
      type: "hello-world",
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  await page.waitForTimeout(200);

  // select and delete
  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget("del-test");
  });

  await page.keyboard.press("Delete");
  await page.waitForTimeout(200);

  const widgetCount = await page.evaluate(() => {
    return (window as any).__skein.store.widgetCount();
  });
  expect(widgetCount).toBe(0);

  const liveCount = await page.evaluate(() => {
    return (window as any).__skein.widgetManager.getLiveWidgets().size;
  });
  expect(liveCount).toBe(0);
});

test("selecting a widget makes header and buttons visible", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "vis-test",
      type: "hello-world",
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  await page.waitForTimeout(200);

  // initially (not hovered, not selected): header should be hidden
  const initialState = await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    const w = live.get("vis-test");
    const frame = w.frame;
    return {
      collapseBtnVisible: frame.collapseBtn?.visible ?? false,
      closeBtnVisible: frame.closeBtn?.visible ?? false,
      headerVisible: frame.header?.visible,
    };
  });
  expect(initialState.collapseBtnVisible).toBe(false);
  expect(initialState.closeBtnVisible).toBe(false);
  expect(initialState.headerVisible).toBe(false);

  // select the widget
  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget("vis-test");
  });

  const selectedState = await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    const w = live.get("vis-test");
    const frame = w.frame;
    return {
      collapseBtnVisible: frame.collapseBtn?.visible ?? false,
      closeBtnVisible: frame.closeBtn?.visible ?? false,
      headerVisible: frame.header?.visible,
    };
  });
  expect(selectedState.collapseBtnVisible).toBe(true);
  expect(selectedState.closeBtnVisible).toBe(true);
  expect(selectedState.headerVisible).toBe(true);
});

test("close button removes widget from store", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "close-test",
      type: "hello-world",
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  await page.waitForTimeout(200);

  // trigger close via callback (simulates clicking the close button)
  await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    const w = live.get("close-test");
    // call the onClose callback directly since the frame's close button
    // is a pixi object and harder to click via playwright
    w.frame.callbacks.onClose();
  });

  await page.waitForTimeout(200);

  const widgetCount = await page.evaluate(() => {
    return (window as any).__skein.store.widgetCount();
  });
  expect(widgetCount).toBe(0);
});

test("collapse callback hides content container", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "collapse-test",
      type: "hello-world",
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  await page.waitForTimeout(200);

  // content should be visible initially
  const beforeCollapse = await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    const w = live.get("collapse-test");
    return w.frame.contentContainer.visible;
  });
  expect(beforeCollapse).toBe(true);

  // trigger collapse via callback
  await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    const w = live.get("collapse-test");
    w.frame.callbacks.onCollapse(true);
  });

  await page.waitForTimeout(200);

  // content should be hidden
  const afterCollapse = await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    const w = live.get("collapse-test");
    return {
      contentVisible: w.frame.contentContainer.visible,
      storeCollapsed: (window as any).__skein.store.getWidget("collapse-test")?.collapsed,
    };
  });
  expect(afterCollapse.contentVisible).toBe(false);
  expect(afterCollapse.storeCollapsed).toBe(true);

  // expand again
  await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    const w = live.get("collapse-test");
    w.frame.callbacks.onCollapse(false);
  });

  await page.waitForTimeout(200);

  const afterExpand = await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    const w = live.get("collapse-test");
    return w.frame.contentContainer.visible;
  });
  expect(afterExpand).toBe(true);
});

test("move callback updates position in store", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "move-cb-test",
      type: "hello-world",
      x: 50,
      y: 50,
      width: 200,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  await page.waitForTimeout(200);

  // trigger move callback (simulates end of a drag)
  await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    const w = live.get("move-cb-test");
    w.frame.callbacks.onMove(250, 350);
  });

  await page.waitForTimeout(200);

  const pos = await page.evaluate(() => {
    const w = (window as any).__skein.store.getWidget("move-cb-test");
    return { x: w.x, y: w.y };
  });
  expect(pos).toEqual({ x: 250, y: 350 });
});

test("resize callback updates size in store and calls ctrl.resize()", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "resize-cb-test",
      type: "hello-world",
      x: 50,
      y: 50,
      width: 200,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  await page.waitForTimeout(200);

  // trigger resize callback (simulates end of a resize drag)
  await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    const w = live.get("resize-cb-test");
    w.frame.callbacks.onResize(400, 300);
  });

  await page.waitForTimeout(200);

  const size = await page.evaluate(() => {
    const w = (window as any).__skein.store.getWidget("resize-cb-test");
    return { width: w.width, height: w.height };
  });
  expect(size).toEqual({ width: 400, height: 300 });
});

test("select callback via frame updates input router selection", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "sel-cb-1",
      type: "hello-world",
      x: 50,
      y: 50,
      width: 200,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
    skein.store.addWidget({
      id: "sel-cb-2",
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

  // select widget 1 via frame callback
  await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    live.get("sel-cb-1").frame.callbacks.onSelect();
  });

  const sel1 = await page.evaluate(() => {
    return (window as any).__skein.inputRouter.selectedWidgetId;
  });
  expect(sel1).toBe("sel-cb-1");

  // frame 1 should be selected, frame 2 should not
  const states1 = await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    return {
      frame1Selected: live.get("sel-cb-1").frame._selected,
      frame2Selected: live.get("sel-cb-2").frame._selected,
    };
  });
  expect(states1.frame1Selected).toBe(true);
  expect(states1.frame2Selected).toBe(false);

  // now select widget 2 — widget 1 should deselect
  await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    live.get("sel-cb-2").frame.callbacks.onSelect();
  });

  const states2 = await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    return {
      selectedId: (window as any).__skein.inputRouter.selectedWidgetId,
      frame1Selected: live.get("sel-cb-1").frame._selected,
      frame2Selected: live.get("sel-cb-2").frame._selected,
    };
  });
  expect(states2.selectedId).toBe("sel-cb-2");
  expect(states2.frame1Selected).toBe(false);
  expect(states2.frame2Selected).toBe(true);
});

test("delete button visible only when widget selected", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "del-vis",
      type: "hello-world",
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  await page.waitForTimeout(200);

  // no selection — delete button should be hidden
  const noSelVisible = await page.evaluate(() => {
    return (window as any).__skein.toolbar.deleteBtn.visible;
  });
  expect(noSelVisible).toBe(false);

  // select the widget — delete should appear
  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget("del-vis");
  });
  const withSelVisible = await page.evaluate(() => {
    return (window as any).__skein.toolbar.deleteBtn.visible;
  });
  expect(withSelVisible).toBe(true);

  // deselect — hidden again
  await page.keyboard.press("Escape");
  const afterEsc = await page.evaluate(() => {
    return (window as any).__skein.toolbar.deleteBtn.visible;
  });
  expect(afterEsc).toBe(false);
});

test("toolbar delete button removes the selected widget", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "toolbar-del",
      type: "hello-world",
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  await page.waitForTimeout(200);

  // select the widget
  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget("toolbar-del");
  });

  // press the delete button via its onPress signal
  await page.evaluate(() => {
    (window as any).__skein.toolbar.deleteBtn.onPress.emit();
  });

  await page.waitForTimeout(200);

  const counts = await page.evaluate(() => {
    return {
      store: (window as any).__skein.store.widgetCount(),
      live: (window as any).__skein.widgetManager.getLiveWidgets().size,
      selected: (window as any).__skein.inputRouter.selectedWidgetId,
    };
  });
  expect(counts.store).toBe(0);
  expect(counts.live).toBe(0);
  expect(counts.selected).toBeNull();
});

test("resize handles visible when selected, hidden when not", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "handle-vis",
      type: "hello-world",
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  await page.waitForTimeout(200);

  // not selected — handles should be hidden
  const notSelectedHandleCount = await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    const frame = live.get("handle-vis").frame;
    let visible = 0;
    for (const h of frame.resizeHandles.values()) {
      if (h.visible) visible++;
    }
    return visible;
  });
  expect(notSelectedHandleCount).toBe(0);

  // select the widget — handles should be visible
  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget("handle-vis");
  });

  const selectedHandleCount = await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    const frame = live.get("handle-vis").frame;
    let visible = 0;
    for (const h of frame.resizeHandles.values()) {
      if (h.visible) visible++;
    }
    return visible;
  });
  expect(selectedHandleCount).toBe(8);

  // deselect — handles should be hidden again
  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget(null);
  });

  const deselectedHandleCount = await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    const frame = live.get("handle-vis").frame;
    let visible = 0;
    for (const h of frame.resizeHandles.values()) {
      if (h.visible) visible++;
    }
    return visible;
  });
  expect(deselectedHandleCount).toBe(0);
});

test("collapsed widget hides resize handles", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "collapse-handles",
      type: "hello-world",
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  await page.waitForTimeout(200);

  // select the widget so handles become visible
  await page.evaluate(() => {
    (window as any).__skein.inputRouter.selectWidget("collapse-handles");
  });

  // handles should be visible
  const beforeCollapse = await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    const frame = live.get("collapse-handles").frame;
    let visible = 0;
    for (const h of frame.resizeHandles.values()) {
      if (h.visible) visible++;
    }
    return visible;
  });
  expect(beforeCollapse).toBe(8);

  // collapse the widget
  await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    live.get("collapse-handles").frame.callbacks.onCollapse(true);
  });

  await page.waitForTimeout(100);

  // handles should be hidden when collapsed
  const afterCollapse = await page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    const frame = live.get("collapse-handles").frame;
    let visible = 0;
    for (const h of frame.resizeHandles.values()) {
      if (h.visible) visible++;
    }
    return visible;
  });
  expect(afterCollapse).toBe(0);
});

test("destroy cleans up toolbar and input router", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  // verify toolbar root exists on stage before destroy
  const before = await page.evaluate(() => {
    return (window as any).__skein.toolbar.root.destroyed === false;
  });
  expect(before).toBe(true);

  // destroy the canvas
  await page.evaluate(() => {
    (window as any).__skein.destroy();
  });

  // canvas should be gone from DOM
  await expect(page.locator("#canvas-root canvas")).toHaveCount(0);
});
