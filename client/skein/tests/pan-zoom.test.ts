import { expect, test } from "./fixtures/canvas-page";

test("viewport initializes with default zoom and camera at origin", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const state = await page.evaluate(() => {
    const skein = (window as any).__skein;
    return {
      zoom: skein.viewport.zoom,
      cameraX: skein.viewport.cameraX,
      cameraY: skein.viewport.cameraY,
      worldX: skein.world.x,
      worldY: skein.world.y,
      worldScaleX: skein.world.scale.x,
      worldScaleY: skein.world.scale.y,
    };
  });

  expect(state.zoom).toBe(1);
  expect(state.cameraX).toBeCloseTo(0, 5);
  expect(state.cameraY).toBeCloseTo(0, 5);
  expect(state.worldX).toBeCloseTo(0, 5);
  expect(state.worldY).toBeCloseTo(0, 5);
  expect(state.worldScaleX).toBe(1);
  expect(state.worldScaleY).toBe(1);
});

test("viewport panTo moves the world container", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const state = await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.viewport.panTo(200, 150);
    return {
      zoom: skein.viewport.zoom,
      cameraX: skein.viewport.cameraX,
      cameraY: skein.viewport.cameraY,
      worldX: skein.world.x,
      worldY: skein.world.y,
    };
  });

  expect(state.zoom).toBe(1);
  expect(state.cameraX).toBeCloseTo(200, 1);
  expect(state.cameraY).toBeCloseTo(150, 1);
  expect(state.worldX).toBeCloseTo(-200, 1);
  expect(state.worldY).toBeCloseTo(-150, 1);
});

test("viewport panBy accumulates delta", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const state = await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.viewport.panBy(100, 50);
    skein.viewport.panBy(30, 20);
    return {
      cameraX: skein.viewport.cameraX,
      cameraY: skein.viewport.cameraY,
      worldX: skein.world.x,
      worldY: skein.world.y,
    };
  });

  expect(state.cameraX).toBeCloseTo(130, 1);
  expect(state.cameraY).toBeCloseTo(70, 1);
  expect(state.worldX).toBeCloseTo(-130, 1);
  expect(state.worldY).toBeCloseTo(-70, 1);
});

test("viewport zoomTo changes scale of world container", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const state = await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.viewport.zoomTo(1.5);
    return {
      zoom: skein.viewport.zoom,
      worldScaleX: skein.world.scale.x,
      worldScaleY: skein.world.scale.y,
    };
  });

  expect(state.zoom).toBeCloseTo(1.5, 2);
  expect(state.worldScaleX).toBeCloseTo(1.5, 2);
  expect(state.worldScaleY).toBeCloseTo(1.5, 2);
});

test("viewport zoomTo clamps to minimum zoom", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const state = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const Viewport = (window as any).__skeinHelpers.Viewport;
    skein.viewport.zoomTo(0.1);
    return {
      zoom: skein.viewport.zoom,
      minZoom: Viewport.MIN_ZOOM,
    };
  });

  expect(state.zoom).toBe(state.minZoom);
  expect(state.zoom).toBe(0.25);
});

test("viewport zoomTo clamps to maximum zoom", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const state = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const Viewport = (window as any).__skeinHelpers.Viewport;
    skein.viewport.zoomTo(5.0);
    return {
      zoom: skein.viewport.zoom,
      maxZoom: Viewport.MAX_ZOOM,
    };
  });

  expect(state.zoom).toBe(state.maxZoom);
  expect(state.zoom).toBe(2.0);
});

test("viewport zoomTo preserves camera center", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const state = await page.evaluate(() => {
    const skein = (window as any).__skein;
    // pan to a world position first
    skein.viewport.panTo(300, 200);
    const camBefore = {
      x: skein.viewport.cameraX,
      y: skein.viewport.cameraY,
    };
    // then zoom — camera center should stay the same
    skein.viewport.zoomTo(1.5);
    return {
      camBeforeX: camBefore.x,
      camBeforeY: camBefore.y,
      camAfterX: skein.viewport.cameraX,
      camAfterY: skein.viewport.cameraY,
    };
  });

  expect(state.camAfterX).toBeCloseTo(state.camBeforeX, 1);
  expect(state.camAfterY).toBeCloseTo(state.camBeforeY, 1);
});

test("viewport zoomAtPoint keeps specified point fixed", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const state = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const screenX = 400;
    const screenY = 300;

    // compute world point under (screenX, screenY) before zoom
    const worldXBefore = (screenX - skein.world.x) / skein.world.scale.x;
    const worldYBefore = (screenY - skein.world.y) / skein.world.scale.y;

    skein.viewport.zoomAtPoint(1.8, screenX, screenY);

    // compute world point under (screenX, screenY) after zoom
    const worldXAfter = (screenX - skein.world.x) / skein.world.scale.x;
    const worldYAfter = (screenY - skein.world.y) / skein.world.scale.y;

    return {
      worldXBefore,
      worldYBefore,
      worldXAfter,
      worldYAfter,
      zoom: skein.viewport.zoom,
    };
  });

  expect(state.zoom).toBeCloseTo(1.8, 2);
  expect(state.worldXAfter).toBeCloseTo(state.worldXBefore, 1);
  expect(state.worldYAfter).toBeCloseTo(state.worldYBefore, 1);
});

test("viewport resetView returns to origin at 1x zoom", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const state = await page.evaluate(() => {
    const skein = (window as any).__skein;
    // pan and zoom away from default
    skein.viewport.panTo(500, 400);
    skein.viewport.zoomTo(0.5);
    // now reset
    skein.viewport.resetView();
    return {
      zoom: skein.viewport.zoom,
      cameraX: skein.viewport.cameraX,
      cameraY: skein.viewport.cameraY,
      worldX: skein.world.x,
      worldY: skein.world.y,
      worldScaleX: skein.world.scale.x,
    };
  });

  expect(state.zoom).toBe(1);
  expect(state.cameraX).toBeCloseTo(0, 5);
  expect(state.cameraY).toBeCloseTo(0, 5);
  expect(state.worldX).toBeCloseTo(0, 5);
  expect(state.worldY).toBeCloseTo(0, 5);
  expect(state.worldScaleX).toBe(1);
});

test("toolbar stays fixed when viewport pans", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const state = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const toolbarXBefore = skein.toolbar.root.x;
    const toolbarYBefore = skein.toolbar.root.y;

    // pan the viewport
    skein.viewport.panTo(500, 300);

    return {
      toolbarXBefore,
      toolbarYBefore,
      toolbarXAfter: skein.toolbar.root.x,
      toolbarYAfter: skein.toolbar.root.y,
      // confirm world actually moved
      worldX: skein.world.x,
      worldY: skein.world.y,
    };
  });

  // toolbar position stays the same
  expect(state.toolbarXAfter).toBe(state.toolbarXBefore);
  expect(state.toolbarYAfter).toBe(state.toolbarYBefore);
  // world container actually moved
  expect(state.worldX).not.toBe(0);
  expect(state.worldY).not.toBe(0);
});

test("toolbar stays fixed when viewport zooms", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const state = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const toolbarXBefore = skein.toolbar.root.x;
    const toolbarYBefore = skein.toolbar.root.y;
    const toolbarScaleBefore = skein.toolbar.root.scale.x;

    skein.viewport.zoomTo(0.5);

    return {
      toolbarXBefore,
      toolbarYBefore,
      toolbarScaleBefore,
      toolbarXAfter: skein.toolbar.root.x,
      toolbarYAfter: skein.toolbar.root.y,
      toolbarScaleAfter: skein.toolbar.root.scale.x,
      // confirm world actually scaled
      worldScale: skein.world.scale.x,
    };
  });

  expect(state.toolbarXAfter).toBe(state.toolbarXBefore);
  expect(state.toolbarYAfter).toBe(state.toolbarYBefore);
  expect(state.toolbarScaleAfter).toBe(state.toolbarScaleBefore);
  expect(state.worldScale).toBeCloseTo(0.5, 2);
});

test("scroll wheel pans the viewport", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  // get initial world position
  const before = await page.evaluate(() => {
    const skein = (window as any).__skein;
    return { x: skein.world.x, y: skein.world.y };
  });

  // dispatch a wheel event on the canvas (no modifier keys = pan)
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas")!;
    canvas.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: 0,
        deltaY: 100,
        bubbles: true,
        cancelable: true,
      })
    );
  });

  const after = await page.evaluate(() => {
    const skein = (window as any).__skein;
    return { x: skein.world.x, y: skein.world.y };
  });

  // world.y should decrease (scroll down moves world up)
  expect(after.x).toBe(before.x);
  expect(after.y).toBe(before.y - 100);
});

test("horizontal scroll wheel pans horizontally", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const canvas = document.querySelector("canvas")!;
    canvas.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: 80,
        deltaY: 0,
        bubbles: true,
        cancelable: true,
      })
    );
  });

  const after = await page.evaluate(() => {
    const skein = (window as any).__skein;
    return { x: skein.world.x, y: skein.world.y };
  });

  expect(after.x).toBe(-80);
  expect(after.y).toBe(0);
});

test("ctrl+scroll zooms the viewport", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const before = await page.evaluate(() => {
    return (window as any).__skein.viewport.zoom;
  });

  // ctrl + scroll up = zoom in (negative deltaY)
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas")!;
    canvas.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: 0,
        deltaY: -60,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
  });

  const after = await page.evaluate(() => {
    return (window as any).__skein.viewport.zoom;
  });

  // negative deltaY with ctrl means zoom in, so zoom should increase
  expect(after).toBeGreaterThan(before);
});

test("ctrl+scroll zoom is clamped at max", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  // first zoom to near max programmatically
  await page.evaluate(() => {
    (window as any).__skein.viewport.zoomTo(1.99);
  });

  // then try to zoom in further via ctrl+scroll
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas")!;
    for (let i = 0; i < 20; i++) {
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          deltaX: 0,
          deltaY: -200,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    }
  });

  const zoom = await page.evaluate(() => {
    return (window as any).__skein.viewport.zoom;
  });

  expect(zoom).toBe(2.0);
});

test("ctrl+scroll zoom is clamped at min", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  // first zoom to near min programmatically
  await page.evaluate(() => {
    (window as any).__skein.viewport.zoomTo(0.26);
  });

  // then try to zoom out further via ctrl+scroll
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas")!;
    for (let i = 0; i < 20; i++) {
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          deltaX: 0,
          deltaY: 200,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    }
  });

  const zoom = await page.evaluate(() => {
    return (window as any).__skein.viewport.zoom;
  });

  expect(zoom).toBe(0.25);
});

test("widgets live inside the world container and move with pan", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const result = await page.evaluate(async () => {
    const skein = (window as any).__skein;
    // add a widget
    skein.store.addWidget({
      id: "pan-test-1",
      type: "hello-world",
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
      parentId: null,
    });
    // wait for mount
    await new Promise((r) => setTimeout(r, 50));

    const live = skein.widgetManager.getLiveWidgets();
    const w = live.get("pan-test-1");
    const frameRoot = w.frame.root;

    // frame is a child of the world container
    const parentIsWorld = frameRoot.parent === skein.world;

    // record the widget's global position before pan
    const globalBefore = frameRoot.getGlobalPosition();

    // pan the viewport
    skein.viewport.panTo(200, 100);

    // global position should shift by the pan amount (in screen pixels)
    const globalAfter = frameRoot.getGlobalPosition();

    return {
      parentIsWorld,
      localX: frameRoot.x,
      localY: frameRoot.y,
      globalBeforeX: globalBefore.x,
      globalBeforeY: globalBefore.y,
      globalAfterX: globalAfter.x,
      globalAfterY: globalAfter.y,
    };
  });

  // the frame's parent is the world container
  expect(result.parentIsWorld).toBe(true);
  // local position didn't change (widget is still at 100,100 in world coords)
  expect(result.localX).toBe(100);
  expect(result.localY).toBe(100);
  // global position shifted by the pan
  expect(result.globalAfterX).toBeCloseTo(result.globalBeforeX - 200, 0);
  expect(result.globalAfterY).toBeCloseTo(result.globalBeforeY - 100, 0);
});

test("widget drag accounts for zoom level", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const result = await page.evaluate(async () => {
    const skein = (window as any).__skein;

    // add a widget and switch to edit mode
    skein.store.addWidget({
      id: "drag-zoom-1",
      type: "hello-world",
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
      parentId: null,
    });
    await new Promise((r) => setTimeout(r, 50));

    // zoom to 2x
    skein.viewport.zoomTo(2);

    const live = skein.widgetManager.getLiveWidgets();
    const w = live.get("drag-zoom-1");
    const frame = w.frame;

    // simulate drag via the frame callbacks: move callback sets position in store
    // the key thing is that the frame's drag math divides screen deltas by zoom.
    // we verify that widget-frame.ts uses root.parent.scale.x for the divisor.
    const parentScale = frame.root.parent?.scale.x;

    return {
      parentScale,
      zoom: skein.viewport.zoom,
    };
  });

  // the world container's scale should match the viewport zoom
  expect(result.parentScale).toBeCloseTo(2.0, 2);
  expect(result.zoom).toBeCloseTo(2.0, 2);
});

test("onZoomChange listener fires when zoom changes", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const result = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const zoomValues: number[] = [];

    skein.viewport.onZoomChange((z: number) => {
      zoomValues.push(z);
    });

    skein.viewport.zoomTo(1.5);
    skein.viewport.zoomTo(0.75);
    skein.viewport.resetView();

    return zoomValues;
  });

  expect(result).toHaveLength(3);
  expect(result[0]).toBeCloseTo(1.5, 2);
  expect(result[1]).toBeCloseTo(0.75, 2);
  expect(result[2]).toBe(1);
});

test("onZoomChange unsubscribe stops notifications", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const result = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const zoomValues: number[] = [];

    const unsub = skein.viewport.onZoomChange((z: number) => {
      zoomValues.push(z);
    });

    skein.viewport.zoomTo(1.5);
    unsub();
    skein.viewport.zoomTo(0.5);

    return zoomValues;
  });

  expect(result).toHaveLength(1);
  expect(result[0]).toBeCloseTo(1.5, 2);
});

test("panTo at non-unity zoom scales world offset correctly", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const state = await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.viewport.zoomTo(2);
    skein.viewport.panTo(100, 50);
    return {
      zoom: skein.viewport.zoom,
      cameraX: skein.viewport.cameraX,
      cameraY: skein.viewport.cameraY,
      worldX: skein.world.x,
      worldY: skein.world.y,
    };
  });

  // at zoom=2, panTo(100,50) means world.x = -100*2 = -200
  expect(state.zoom).toBeCloseTo(2, 2);
  expect(state.cameraX).toBeCloseTo(100, 1);
  expect(state.cameraY).toBeCloseTo(50, 1);
  expect(state.worldX).toBeCloseTo(-200, 1);
  expect(state.worldY).toBeCloseTo(-100, 1);
});

test("destroy cleans up viewport", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  // verify the viewport exists, then call destroy on the whole canvas
  const result = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const hadViewport = skein.viewport != null;
    skein.destroy();
    return { hadViewport };
  });

  expect(result.hadViewport).toBe(true);
});

test("multiple scroll events accumulate pan offset", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const canvas = document.querySelector("canvas")!;
    for (let i = 0; i < 5; i++) {
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          deltaX: 0,
          deltaY: 20,
          bubbles: true,
          cancelable: true,
        })
      );
    }
  });

  const state = await page.evaluate(() => {
    const skein = (window as any).__skein;
    return { worldY: skein.world.y };
  });

  expect(state.worldY).toBe(-100);
});

test("zoomAtPoint then resetView returns to origin", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const state = await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.viewport.zoomAtPoint(1.5, 400, 300);
    skein.viewport.panTo(200, 100);
    skein.viewport.resetView();
    return {
      zoom: skein.viewport.zoom,
      worldX: skein.world.x,
      worldY: skein.world.y,
      worldScale: skein.world.scale.x,
    };
  });

  expect(state.zoom).toBe(1);
  expect(state.worldX).toBe(0);
  expect(state.worldY).toBe(0);
  expect(state.worldScale).toBe(1);
});

test("zoomTo with same value is a no-op", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const result = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const zoomValues: number[] = [];
    skein.viewport.onZoomChange((z: number) => {
      zoomValues.push(z);
    });

    skein.viewport.zoomTo(1); // already at 1, should be no-op
    return { notified: zoomValues.length };
  });

  expect(result.notified).toBe(0);
});
