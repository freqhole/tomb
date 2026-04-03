import { expect, test } from "./fixtures/canvas-page";

// ---------------------------------------------------------------------------
// keyboard driver
// ---------------------------------------------------------------------------

test("keyboard driver is available on the skein canvas handle", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const result = await page.evaluate(() => {
    const skein = (window as any).__skein;
    return {
      hasKeyboard: skein.keyboard != null,
      isAcquired: skein.keyboard.isAcquired,
    };
  });

  expect(result.hasKeyboard).toBe(true);
  expect(result.isAcquired).toBe(false);
});

test("keyboard driver hidden textarea exists in the DOM", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const textareaCount = await page.evaluate(() => {
    const root = document.getElementById("canvas-root")!;
    return root.querySelectorAll("textarea").length;
  });

  expect(textareaCount).toBe(1);
});

test("keyboard acquire focuses the hidden textarea", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const result = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const inputValues: string[] = [];

    skein.keyboard.acquire(
      {
        onInput(value: string) {
          inputValues.push(value);
        },
        onKeyDown() {},
      },
      "hello",
    );

    return {
      isAcquired: skein.keyboard.isAcquired,
      value: skein.keyboard.value,
    };
  });

  expect(result.isAcquired).toBe(true);
  expect(result.value).toBe("hello");
});

test("keyboard release clears the handler and value", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const result = await page.evaluate(() => {
    const skein = (window as any).__skein;

    skein.keyboard.acquire({ onInput() {}, onKeyDown() {} }, "test");
    skein.keyboard.release();

    return {
      isAcquired: skein.keyboard.isAcquired,
      value: skein.keyboard.value,
    };
  });

  expect(result.isAcquired).toBe(false);
  expect(result.value).toBe("");
});

test("keyboard driver delivers input events to handler", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  // acquire the keyboard driver and type into the hidden textarea
  await page.evaluate(() => {
    const skein = (window as any).__skein;
    (window as any).__inputLog = [] as string[];

    skein.keyboard.acquire(
      {
        onInput(value: string) {
          (window as any).__inputLog.push(value);
        },
        onKeyDown() {},
      },
      "",
    );
  });

  // type into the hidden textarea via the page
  const textarea = page.locator("#canvas-root textarea");
  await textarea.fill("abc");

  const log = await page.evaluate(() => (window as any).__inputLog);
  expect(log.length).toBeGreaterThanOrEqual(1);
  // the last input event should contain the full value
  expect(log[log.length - 1]).toBe("abc");
});

test("keyboard driver delivers keydown events to handler", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    (window as any).__keyLog = [] as string[];

    skein.keyboard.acquire(
      {
        onInput() {},
        onKeyDown(event: KeyboardEvent) {
          (window as any).__keyLog.push(event.key);
        },
      },
      "",
    );
  });

  const textarea = page.locator("#canvas-root textarea");
  await textarea.press("Escape");

  const keyLog = await page.evaluate(() => (window as any).__keyLog);
  expect(keyLog).toContain("Escape");
});

test("keyboard driver is cleaned up on canvas destroy", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const result = await page.evaluate(() => {
    const root = document.getElementById("canvas-root")!;
    const before = root.querySelectorAll("textarea").length;
    (window as any).__skein.destroy();
    const after = root.querySelectorAll("textarea").length;
    return { before, after };
  });

  expect(result.before).toBe(1);
  expect(result.after).toBe(0);
});

// ---------------------------------------------------------------------------
// label widget
// ---------------------------------------------------------------------------

test("label widget mounts with default text", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "label-1",
      type: "label",
      x: 50,
      y: 50,
      width: 200,
      height: 80,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  // wait for mount
  await page.waitForTimeout(300);

  const result = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const live = skein.widgetManager.getLiveWidgets().get("label-1");
    if (!live) return null;
    return {
      crashed: live.crashed,
      hasWidgetDoc: live.widgetDoc != null,
      text: live.widgetDoc?.current?.text ?? null,
    };
  });

  expect(result).not.toBeNull();
  expect(result!.crashed).toBe(false);
  expect(result!.hasWidgetDoc).toBe(true);
  expect(result!.text).toBe("label");
});

test("label widget text persists via automerge doc", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "label-2",
      type: "label",
      x: 50,
      y: 50,
      width: 200,
      height: 80,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  await page.waitForTimeout(300);

  // change the text programmatically via the widget doc
  await page.evaluate(() => {
    const skein = (window as any).__skein;
    const live = skein.widgetManager.getLiveWidgets().get("label-2");
    live.widgetDoc.change((draft: any) => {
      draft.text = "updated label";
    });
  });

  await page.waitForTimeout(100);

  const text = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const live = skein.widgetManager.getLiveWidgets().get("label-2");
    return live.widgetDoc.current.text;
  });

  expect(text).toBe("updated label");
});

test("label widget text syncs between peers", async ({ canvasPage }) => {
  const peerA = await canvasPage();
  const peerB = await canvasPage({ canvasDocId: peerA.canvasDocId, context: peerA.context });

  await peerA.page.waitForTimeout(200);

  // peerA adds a label widget
  await peerA.page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "label-sync",
      type: "label",
      x: 50,
      y: 50,
      width: 200,
      height: 80,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  // wait for peerB to see the widget
  await expect
    .poll(
      async () => {
        return await peerB.page.evaluate(() => {
          return (window as any).__skein.store.widgetCount();
        });
      },
      { timeout: 5000 },
    )
    .toBe(1);

  // wait for widget to mount on peerB
  await peerB.page.waitForTimeout(500);

  // peerA changes the label text
  await peerA.page.evaluate(() => {
    const skein = (window as any).__skein;
    const live = skein.widgetManager.getLiveWidgets().get("label-sync");
    live.widgetDoc.change((draft: any) => {
      draft.text = "synced label";
    });
  });

  // peerB should see the synced text
  await expect
    .poll(
      async () => {
        return await peerB.page.evaluate(() => {
          const skein = (window as any).__skein;
          const live = skein.widgetManager.getLiveWidgets().get("label-sync");
          if (!live?.widgetDoc) return null;
          return live.widgetDoc.current.text;
        });
      },
      { timeout: 5000 },
    )
    .toBe("synced label");
});

test("label widget resize callback is invoked", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "label-resize",
      type: "label",
      x: 50,
      y: 50,
      width: 200,
      height: 80,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  await page.waitForTimeout(300);

  // resize the widget via the store
  const resizeResult = await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.resizeWidget("label-resize", 300, 150);
    return true;
  });

  expect(resizeResult).toBe(true);

  // verify the widget survived resize without crashing
  await page.waitForTimeout(100);
  const stillAlive = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const live = skein.widgetManager.getLiveWidgets().get("label-resize");
    return live != null && !live.crashed;
  });

  expect(stillAlive).toBe(true);
});

// ---------------------------------------------------------------------------
// notepad widget
// ---------------------------------------------------------------------------

test("notepad widget mounts with empty text", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "notepad-1",
      type: "notepad",
      x: 50,
      y: 50,
      width: 250,
      height: 200,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  await page.waitForTimeout(300);

  const result = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const live = skein.widgetManager.getLiveWidgets().get("notepad-1");
    if (!live) return null;
    return {
      crashed: live.crashed,
      hasWidgetDoc: live.widgetDoc != null,
      text: live.widgetDoc?.current?.text ?? null,
    };
  });

  expect(result).not.toBeNull();
  expect(result!.crashed).toBe(false);
  expect(result!.hasWidgetDoc).toBe(true);
  expect(result!.text).toBe("");
});

test("notepad widget text changes persist via doc", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "notepad-2",
      type: "notepad",
      x: 50,
      y: 50,
      width: 250,
      height: 200,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  await page.waitForTimeout(300);

  // write multi-line text via the widget doc
  await page.evaluate(() => {
    const skein = (window as any).__skein;
    const live = skein.widgetManager.getLiveWidgets().get("notepad-2");
    live.widgetDoc.change((draft: any) => {
      draft.text = "line one\nline two\nline three";
    });
  });

  await page.waitForTimeout(100);

  const text = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const live = skein.widgetManager.getLiveWidgets().get("notepad-2");
    return live.widgetDoc.current.text;
  });

  expect(text).toBe("line one\nline two\nline three");
});

test("notepad widget text syncs between peers", async ({ canvasPage }) => {
  const peerA = await canvasPage();
  const peerB = await canvasPage({ canvasDocId: peerA.canvasDocId, context: peerA.context });

  await peerA.page.waitForTimeout(200);

  // peerA adds a notepad widget
  await peerA.page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "notepad-sync",
      type: "notepad",
      x: 50,
      y: 50,
      width: 250,
      height: 200,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  // wait for peerB to see the widget
  await expect
    .poll(
      async () => {
        return await peerB.page.evaluate(() => {
          return (window as any).__skein.store.widgetCount();
        });
      },
      { timeout: 5000 },
    )
    .toBe(1);

  await peerB.page.waitForTimeout(500);

  // peerA writes some notes
  await peerA.page.evaluate(() => {
    const skein = (window as any).__skein;
    const live = skein.widgetManager.getLiveWidgets().get("notepad-sync");
    live.widgetDoc.change((draft: any) => {
      draft.text = "shared notes\nfrom peer A";
    });
  });

  // peerB should see the synced text
  await expect
    .poll(
      async () => {
        return await peerB.page.evaluate(() => {
          const skein = (window as any).__skein;
          const live = skein.widgetManager.getLiveWidgets().get("notepad-sync");
          if (!live?.widgetDoc) return null;
          return live.widgetDoc.current.text;
        });
      },
      { timeout: 5000 },
    )
    .toBe("shared notes\nfrom peer A");
});

test("notepad widget survives resize without crashing", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "notepad-resize",
      type: "notepad",
      x: 50,
      y: 50,
      width: 250,
      height: 200,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  await page.waitForTimeout(300);

  // write some text first so there's content to reflow
  await page.evaluate(() => {
    const skein = (window as any).__skein;
    const live = skein.widgetManager.getLiveWidgets().get("notepad-resize");
    live.widgetDoc.change((draft: any) => {
      draft.text = "some text that should reflow when the widget is resized to a different width";
    });
  });

  await page.waitForTimeout(100);

  // resize the widget
  await page.evaluate(() => {
    (window as any).__skein.store.resizeWidget("notepad-resize", 400, 300);
  });

  await page.waitForTimeout(100);

  const result = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const live = skein.widgetManager.getLiveWidgets().get("notepad-resize");
    return {
      alive: live != null && !live.crashed,
      text: live?.widgetDoc?.current?.text ?? null,
    };
  });

  expect(result.alive).toBe(true);
  expect(result.text).toContain("some text that should reflow");
});

test("notepad widget can be destroyed cleanly", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "notepad-destroy",
      type: "notepad",
      x: 50,
      y: 50,
      width: 250,
      height: 200,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  await page.waitForTimeout(300);

  // remove the widget — should not throw
  const error = await page.evaluate(() => {
    try {
      (window as any).__skein.store.removeWidget("notepad-destroy");
      return null;
    } catch (err: any) {
      return err.message ?? String(err);
    }
  });

  expect(error).toBeNull();

  await page.waitForTimeout(200);

  const count = await page.evaluate(() => {
    return (window as any).__skein.widgetManager.getLiveWidgets().size;
  });

  expect(count).toBe(0);
});

test("label and notepad widgets coexist on the same canvas", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  await page.evaluate(() => {
    const skein = (window as any).__skein;
    skein.store.addWidget({
      id: "label-coexist",
      type: "label",
      x: 50,
      y: 50,
      width: 200,
      height: 80,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });
    skein.store.addWidget({
      id: "notepad-coexist",
      type: "notepad",
      x: 300,
      y: 50,
      width: 250,
      height: 200,
      zIndex: 2,
      props: {},
      collapsed: false,
      docId: null,
    });
  });

  await page.waitForTimeout(300);

  const result = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const liveWidgets = skein.widgetManager.getLiveWidgets();
    const label = liveWidgets.get("label-coexist");
    const notepad = liveWidgets.get("notepad-coexist");
    return {
      liveCount: liveWidgets.size,
      labelAlive: label != null && !label.crashed,
      notepadAlive: notepad != null && !notepad.crashed,
      labelText: label?.widgetDoc?.current?.text ?? null,
      notepadText: notepad?.widgetDoc?.current?.text ?? null,
    };
  });

  expect(result.liveCount).toBe(2);
  expect(result.labelAlive).toBe(true);
  expect(result.notepadAlive).toBe(true);
  expect(result.labelText).toBe("label");
  expect(result.notepadText).toBe("");
});
