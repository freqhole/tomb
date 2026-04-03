import { expect, test } from "./fixtures/canvas-page";

test("two peers see each other's widgets via BroadcastChannel", async ({ canvasPage }) => {
  const peerA = await canvasPage();
  const peerB = await canvasPage({ canvasDocId: peerA.canvasDocId, context: peerA.context });

  // peerA adds a hello-world widget
  await peerA.page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "sync-test-1",
      type: "hello-world",
      x: 100,
      y: 200,
      width: 150,
      height: 60,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  // wait for peerB to receive the widget via sync
  await expect
    .poll(
      () =>
        peerB.page.evaluate(() => {
          return (window as any).__skein.store.widgetCount();
        }),
      { timeout: 5000 }
    )
    .toBe(1);

  // assert the widget entry exists on peerB with correct data
  const entry = await peerB.page.evaluate(() => {
    const doc = (window as any).__skein.store.doc();
    return doc.widgets["sync-test-1"] ?? null;
  });

  expect(entry).not.toBeNull();
  expect(entry.type).toBe("hello-world");
  expect(entry.x).toBe(100);
  expect(entry.y).toBe(200);
});

test("widget position changes sync between peers", async ({ canvasPage }) => {
  const peerA = await canvasPage();
  const peerB = await canvasPage({ canvasDocId: peerA.canvasDocId, context: peerA.context });

  // peerA adds a widget
  await peerA.page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "sync-move-1",
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
  });

  // wait for peerB to see the widget
  await expect
    .poll(
      () =>
        peerB.page.evaluate(() => {
          return (window as any).__skein.store.widgetCount();
        }),
      { timeout: 5000 }
    )
    .toBe(1);

  // peerA moves the widget
  await peerA.page.evaluate(() => {
    (window as any).__skein.store.moveWidget("sync-move-1", 300, 400);
  });

  // poll peerB for the updated position
  await expect
    .poll(
      () =>
        peerB.page.evaluate(() => {
          const w = (window as any).__skein.store.getWidget("sync-move-1");
          if (!w) return null;
          return { x: w.x, y: w.y };
        }),
      { timeout: 5000 }
    )
    .toEqual({ x: 300, y: 400 });
});

test("widget removal syncs between peers", async ({ canvasPage }) => {
  const peerA = await canvasPage();
  const peerB = await canvasPage({ canvasDocId: peerA.canvasDocId, context: peerA.context });

  // peerA adds a widget
  await peerA.page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "sync-remove-1",
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

  // wait for peerB to see the widget
  await expect
    .poll(
      () =>
        peerB.page.evaluate(() => {
          return (window as any).__skein.store.widgetCount();
        }),
      { timeout: 5000 }
    )
    .toBe(1);

  // peerA removes the widget
  await peerA.page.evaluate(() => {
    (window as any).__skein.store.removeWidget("sync-remove-1");
  });

  // poll peerB until widget count drops to 0
  await expect
    .poll(
      () =>
        peerB.page.evaluate(() => {
          return (window as any).__skein.store.widgetCount();
        }),
      { timeout: 5000 }
    )
    .toBe(0);
});

test("widget internal state syncs via zod-validated doc API", async ({ canvasPage }) => {
  const peerA = await canvasPage();
  const peerB = await canvasPage({ canvasDocId: peerA.canvasDocId, context: peerA.context });

  // peerA adds a counter widget (stateful — gets its own per-widget doc)
  await peerA.page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "sync-counter-1",
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

  // wait for peerB to see the counter widget
  await expect
    .poll(
      () =>
        peerB.page.evaluate(() => {
          return (window as any).__skein.store.widgetCount();
        }),
      { timeout: 5000 }
    )
    .toBe(1);

  // wait for peerA's live widget to have a widgetDoc ready
  await expect
    .poll(
      () =>
        peerA.page.evaluate(() => {
          const live = (window as any).__skein.widgetManager.getLiveWidgets();
          const w = live.get("sync-counter-1");
          return w && w.widgetDoc ? true : false;
        }),
      { timeout: 5000 }
    )
    .toBe(true);

  // peerA changes the counter's internal state via the zod-validated doc facade
  await peerA.page.evaluate(() => {
    const live = (window as any).__skein.widgetManager.getLiveWidgets();
    const w = live.get("sync-counter-1");
    w.widgetDoc.change((d: any) => {
      d.count = 42;
    });
  });

  // wait for peerB's live widget to also have a widgetDoc
  await expect
    .poll(
      () =>
        peerB.page.evaluate(() => {
          const live = (window as any).__skein.widgetManager.getLiveWidgets();
          const w = live.get("sync-counter-1");
          return w && w.widgetDoc ? true : false;
        }),
      { timeout: 5000 }
    )
    .toBe(true);

  // poll peerB for the synced counter value
  await expect
    .poll(
      () =>
        peerB.page.evaluate(() => {
          const live = (window as any).__skein.widgetManager.getLiveWidgets();
          const w = live.get("sync-counter-1");
          if (!w || !w.widgetDoc) return null;
          return w.widgetDoc.current.count;
        }),
      { timeout: 5000 }
    )
    .toBe(42);
});

test("concurrent widget additions from both peers merge", async ({ canvasPage }) => {
  const peerA = await canvasPage();
  const peerB = await canvasPage({ canvasDocId: peerA.canvasDocId, context: peerA.context });

  // let sync stabilize
  await peerA.page.waitForTimeout(100);

  // both peers add a widget concurrently (no awaiting between them)
  await Promise.all([
    peerA.page.evaluate(() => {
      const skein = (window as any).__skein;
      skein.store.addWidget({
        id: "concurrent-a",
        type: "hello-world",
        x: 10,
        y: 10,
        width: 100,
        height: 50,
        zIndex: 1,
        props: {},
        collapsed: false,
        docId: null,
      });
    }),
    peerB.page.evaluate(() => {
      const skein = (window as any).__skein;
      skein.store.addWidget({
        id: "concurrent-b",
        type: "hello-world",
        x: 200,
        y: 200,
        width: 100,
        height: 50,
        zIndex: 2,
        props: {},
        collapsed: false,
        docId: null,
      });
    }),
  ]);

  // poll both peers until they each see 2 widgets
  await expect
    .poll(
      () =>
        peerA.page.evaluate(() => {
          return (window as any).__skein.store.widgetCount();
        }),
      { timeout: 5000 }
    )
    .toBe(2);

  await expect
    .poll(
      () =>
        peerB.page.evaluate(() => {
          return (window as any).__skein.store.widgetCount();
        }),
      { timeout: 5000 }
    )
    .toBe(2);
});

test("peers have different peer IDs", async ({ canvasPage }) => {
  const peerA = await canvasPage();
  const peerB = await canvasPage({ canvasDocId: peerA.canvasDocId, context: peerA.context });

  const peerIdA = await peerA.page.evaluate(() => {
    return (window as any).__skein.peerId;
  });

  const peerIdB = await peerB.page.evaluate(() => {
    return (window as any).__skein.peerId;
  });

  expect(typeof peerIdA).toBe("string");
  expect(typeof peerIdB).toBe("string");
  expect(peerIdA.length).toBeGreaterThan(0);
  expect(peerIdB.length).toBeGreaterThan(0);
  expect(peerIdA).not.toBe(peerIdB);
});
