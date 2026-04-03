import { expect, test } from "./fixtures/canvas-page";

test("toolbar has openFlyoutAtPosition method", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const result = await page.evaluate(() => {
    const skein = (window as any).__skein;
    return typeof skein.toolbar.openFlyoutAtPosition;
  });

  expect(result).toBe("function");
});

test("openFlyoutAtPosition opens the flyout", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  // enter edit mode
  await page.keyboard.press("e");

  // open the flyout at a known screen position with world coords
  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.toolbar.openFlyoutAtPosition(400, 300, 200, 150);
  });

  await page.waitForTimeout(100);

  // verify flyout is visible and positioned within viewport
  const result = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const toolbar = skein.toolbar;
    const flyout = toolbar.flyout;
    const flyoutBg = toolbar.flyoutBg;

    if (!flyout || !flyout.visible) return { visible: false };

    const root = toolbar.root;
    const screenX = root.x + flyout.x;
    const screenY = root.y + flyout.y;
    const flyoutWidth = flyoutBg.width;
    const flyoutHeight = flyoutBg.height;

    const vv = window.visualViewport;
    const viewportWidth = vv ? vv.width : window.innerWidth;
    const viewportHeight = vv ? vv.height : window.innerHeight;

    return {
      visible: true,
      left: screenX,
      top: screenY,
      right: screenX + flyoutWidth,
      bottom: screenY + flyoutHeight,
      viewportWidth,
      viewportHeight,
    };
  });

  expect(result.visible).toBe(true);
  expect(result.left).toBeGreaterThanOrEqual(0);
  expect(result.top).toBeGreaterThanOrEqual(0);
  expect(result.right).toBeLessThanOrEqual(result.viewportWidth!);
  expect(result.bottom).toBeLessThanOrEqual(result.viewportHeight!);
});

test("flyout opened at position is clamped to viewport", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  // enter edit mode
  await page.keyboard.press("e");

  // open flyout at extreme coordinates that would push it off-screen
  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.toolbar.openFlyoutAtPosition(2000, 2000, 500, 500);
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

  // the flyout should be clamped so it doesn't extend past the viewport edges
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight);
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
});

test("widget placed via flyout uses the pending placement position", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  // enter edit mode
  await page.keyboard.press("e");

  // open flyout at screen (400, 300) with world coords (250, 175)
  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.toolbar.openFlyoutAtPosition(400, 300, 250, 175);
  });

  await page.waitForTimeout(100);

  // get the widget count before clicking
  const beforeCount = await page.evaluate(() => {
    return (window as any).__skein.store.widgetCount();
  });
  expect(beforeCount).toBe(0);

  // simulate clicking the first item in the flyout to add a widget
  await page.evaluate(() => {
    const skein = (window as any).__skein;
    const toolbar = skein.toolbar;
    // the flyout items are children; find the first clickable item and trigger it
    // toolbar.addWidget is the internal method called by flyout items
    const flyout = toolbar.flyout;
    // iterate flyout children to find the first interactive item and press it
    let clicked = false;
    for (const child of flyout.children) {
      if (child.onPress) {
        child.onPress.emit();
        clicked = true;
        break;
      }
      // some flyouts use nested children
      if (child.children) {
        for (const sub of child.children) {
          if (sub.onPress) {
            sub.onPress.emit();
            clicked = true;
            break;
          }
        }
      }
      if (clicked) break;
    }
    // fallback: if no button found, use addWidget directly with the first registered type
    if (!clicked) {
      toolbar.addWidget("hello-world");
    }
  });

  await page.waitForTimeout(200);

  // verify a widget was added
  const afterCount = await page.evaluate(() => {
    return (window as any).__skein.store.widgetCount();
  });
  expect(afterCount).toBe(1);

  // verify the widget was placed at the world coordinates (250, 175)
  const widget = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const doc = skein.store.doc();
    const widgets = doc.widgets;
    // get the first (only) widget
    const ids = Object.keys(widgets);
    if (ids.length === 0) return null;
    const w = widgets[ids[0]];
    return { x: w.x, y: w.y };
  });

  expect(widget).not.toBeNull();
  expect(widget!.x).toBe(250);
  expect(widget!.y).toBe(175);
});
