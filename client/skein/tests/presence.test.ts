import { expect, test } from "./fixtures/canvas-page";

test("presence manager initializes with local peer id", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const result = await page.evaluate(() => {
    const skein = (window as any).__skein;
    return {
      localPeerId: skein.presenceManager.localPeerId,
      peerId: skein.peerId,
      peerCount: skein.presenceManager.peerCount,
    };
  });

  expect(result.localPeerId).toBe(result.peerId);
  expect(result.peerCount).toBe(0);
});

test("peer online broadcast is received by remote peer", async ({ canvasPage }) => {
  const peerA = await canvasPage();
  const peerB = await canvasPage({ canvasDocId: peerA.canvasDocId, context: peerA.context });

  // let both peers settle and discover each other's broadcast channel
  await peerA.page.waitForTimeout(200);

  const peerAId = await peerA.page.evaluate(() => {
    return (window as any).__skein.peerId;
  });

  // explicitly broadcast online from peerA
  await peerA.page.evaluate(() => {
    (window as any).__skein.presenceManager.broadcastOnline();
  });

  await peerA.page.waitForTimeout(200);

  // poll peerB until it sees peerA
  await expect
    .poll(
      async () => {
        return await peerB.page.evaluate(() => {
          return (window as any).__skein.presenceManager.peerCount;
        });
      },
      { timeout: 5000 }
    )
    .toBeGreaterThanOrEqual(1);

  // verify peerA shows as online on peerB's side
  const peerAPresence = await peerB.page.evaluate((id) => {
    const peer = (window as any).__skein.presenceManager.getPeer(id);
    if (!peer) return null;
    return { online: peer.online, peerId: peer.peerId };
  }, peerAId);

  expect(peerAPresence).not.toBeNull();
  expect(peerAPresence!.online).toBe(true);
  expect(peerAPresence!.peerId).toBe(peerAId);
});

test("cursor position broadcasts sync between peers", async ({ canvasPage }) => {
  const peerA = await canvasPage();
  const peerB = await canvasPage({ canvasDocId: peerA.canvasDocId, context: peerA.context });

  await peerA.page.waitForTimeout(200);

  const peerAId = await peerA.page.evaluate(() => {
    return (window as any).__skein.peerId;
  });

  // broadcast cursor from peerA
  await peerA.page.evaluate(() => {
    (window as any).__skein.presenceManager.broadcastCursor(150, 250);
  });

  // wait for throttle + propagation
  await peerA.page.waitForTimeout(100);

  // poll peerB for peerA's cursor position
  await expect
    .poll(
      async () => {
        return await peerB.page.evaluate((id) => {
          const peer = (window as any).__skein.presenceManager.getPeer(id);
          if (!peer || !peer.cursor) return null;
          return { x: peer.cursor.x, y: peer.cursor.y };
        }, peerAId);
      },
      { timeout: 5000 }
    )
    .toEqual({ x: 150, y: 250 });
});

test("widget lock is visible to remote peer", async ({ canvasPage }) => {
  const peerA = await canvasPage();
  const peerB = await canvasPage({ canvasDocId: peerA.canvasDocId, context: peerA.context });

  await peerA.page.waitForTimeout(200);

  const peerAId = await peerA.page.evaluate(() => {
    return (window as any).__skein.peerId;
  });

  // peerA locks widget-1
  await peerA.page.evaluate(() => {
    (window as any).__skein.presenceManager.lockWidget("widget-1");
  });

  await peerA.page.waitForTimeout(100);

  // poll peerB until it sees the lock
  await expect
    .poll(
      async () => {
        return await peerB.page.evaluate(() => {
          return (window as any).__skein.presenceManager.isWidgetLocked("widget-1");
        });
      },
      { timeout: 5000 }
    )
    .toBe(true);

  // verify the lock holder is peerA
  const lockedBy = await peerB.page.evaluate(() => {
    return (window as any).__skein.presenceManager.getLockedBy("widget-1");
  });

  expect(lockedBy).toBe(peerAId);
});

test("widget unlock clears lock on remote peer", async ({ canvasPage }) => {
  const peerA = await canvasPage();
  const peerB = await canvasPage({ canvasDocId: peerA.canvasDocId, context: peerA.context });

  await peerA.page.waitForTimeout(200);

  // peerA locks widget-1
  await peerA.page.evaluate(() => {
    (window as any).__skein.presenceManager.lockWidget("widget-1");
  });

  await peerA.page.waitForTimeout(100);

  // wait until peerB sees the lock
  await expect
    .poll(
      async () => {
        return await peerB.page.evaluate(() => {
          return (window as any).__skein.presenceManager.isWidgetLocked("widget-1");
        });
      },
      { timeout: 5000 }
    )
    .toBe(true);

  // peerA unlocks widget-1
  await peerA.page.evaluate(() => {
    (window as any).__skein.presenceManager.unlockWidget("widget-1");
  });

  await peerA.page.waitForTimeout(100);

  // poll peerB until the lock is cleared
  await expect
    .poll(
      async () => {
        return await peerB.page.evaluate(() => {
          return (window as any).__skein.presenceManager.isWidgetLocked("widget-1");
        });
      },
      { timeout: 5000 }
    )
    .toBe(false);
});

test("selection broadcast is received by remote peer", async ({ canvasPage }) => {
  const peerA = await canvasPage();
  const peerB = await canvasPage({ canvasDocId: peerA.canvasDocId, context: peerA.context });

  await peerA.page.waitForTimeout(200);

  const peerAId = await peerA.page.evaluate(() => {
    return (window as any).__skein.peerId;
  });

  // peerA broadcasts selection
  await peerA.page.evaluate(() => {
    (window as any).__skein.presenceManager.broadcastSelection(["w1", "w2"]);
  });

  await peerA.page.waitForTimeout(100);

  // poll peerB for peerA's selection
  await expect
    .poll(
      async () => {
        return await peerB.page.evaluate((id) => {
          const peer = (window as any).__skein.presenceManager.getPeer(id);
          if (!peer) return null;
          return peer.selectedWidgets;
        }, peerAId);
      },
      { timeout: 5000 }
    )
    .toEqual(["w1", "w2"]);
});

test("presence renderer creates cursor visuals for remote peers", async ({ canvasPage }) => {
  const peerA = await canvasPage();
  const peerB = await canvasPage({ canvasDocId: peerA.canvasDocId, context: peerA.context });

  await peerA.page.waitForTimeout(200);

  // peerA broadcasts a cursor position
  await peerA.page.evaluate(() => {
    (window as any).__skein.presenceManager.broadcastCursor(200, 300);
  });

  // give extra time for propagation and renderer update
  await peerA.page.waitForTimeout(200);

  // poll peerB's presence renderer for cursor children
  await expect
    .poll(
      async () => {
        return await peerB.page.evaluate(() => {
          const renderer = (window as any).__skein.presenceRenderer as any;
          return renderer.root.children.length;
        });
      },
      { timeout: 5000 }
    )
    .toBeGreaterThanOrEqual(1);
});

test("destroy cleans up presence manager and renderer", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  // verify presenceManager and presenceRenderer exist before destroy
  const before = await page.evaluate(() => {
    const skein = (window as any).__skein;
    return {
      hasPresenceManager: skein.presenceManager != null,
      hasPresenceRenderer: skein.presenceRenderer != null,
    };
  });

  expect(before.hasPresenceManager).toBe(true);
  expect(before.hasPresenceRenderer).toBe(true);

  // call destroy on the whole canvas — should not throw
  const destroyError = await page.evaluate(() => {
    try {
      (window as any).__skein.destroy();
      return null;
    } catch (err: any) {
      return err.message ?? String(err);
    }
  });

  expect(destroyError).toBeNull();
});
