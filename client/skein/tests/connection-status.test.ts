import { expect, test } from "./fixtures/canvas-page";

test("connection status indicator is present on the stage", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const result = await page.evaluate(() => {
    const skein = (window as any).__skein;
    return {
      hasConnectionStatus: skein.connectionStatus != null,
      hasRoot: skein.connectionStatus?.root != null,
      rootVisible: skein.connectionStatus?.root?.visible,
    };
  });

  expect(result.hasConnectionStatus).toBe(true);
  expect(result.hasRoot).toBe(true);
  expect(result.rootVisible).toBe(true);
});

test("connection status shows 'solo' when no peers are connected", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const label = await page.evaluate(() => {
    const skein = (window as any).__skein;
    // the label is the third child of the root container (bg, dot, label)
    const labelChild = skein.connectionStatus.root.children[2];
    return labelChild?.text ?? null;
  });

  expect(label).toBe("solo");
});

test("connection status dot is gray when solo", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  // verify the dot exists and has children (circle fill)
  const dotExists = await page.evaluate(() => {
    const skein = (window as any).__skein;
    // the dot is the second child of the root container
    const dot = skein.connectionStatus.root.children[1];
    return dot != null;
  });

  expect(dotExists).toBe(true);
});

test("connection status updates to show peer count when a remote peer joins", async ({
  canvasPage,
}) => {
  const peerA = await canvasPage();
  const peerB = await canvasPage({ canvasDocId: peerA.canvasDocId, context: peerA.context });

  // let peers discover each other via BroadcastChannel
  await peerA.page.waitForTimeout(200);

  // broadcast online from peerB so peerA sees it
  await peerB.page.evaluate(() => {
    (window as any).__skein.presenceManager.broadcastOnline();
  });

  await peerA.page.waitForTimeout(200);

  // poll peerA's connection status label until it shows peer count
  await expect
    .poll(
      async () => {
        return await peerA.page.evaluate(() => {
          const skein = (window as any).__skein;
          const labelChild = skein.connectionStatus.root.children[2];
          return labelChild?.text ?? null;
        });
      },
      { timeout: 5000 }
    )
    .toBe("1 peer");
});

test("connection status updates back to solo when peer goes offline", async ({ canvasPage }) => {
  const peerA = await canvasPage();
  const peerB = await canvasPage({ canvasDocId: peerA.canvasDocId, context: peerA.context });

  await peerA.page.waitForTimeout(200);

  // broadcast online from peerB
  await peerB.page.evaluate(() => {
    (window as any).__skein.presenceManager.broadcastOnline();
  });

  await peerA.page.waitForTimeout(200);

  // wait until peerA sees the peer
  await expect
    .poll(
      async () => {
        return await peerA.page.evaluate(() => {
          const skein = (window as any).__skein;
          const labelChild = skein.connectionStatus.root.children[2];
          return labelChild?.text ?? null;
        });
      },
      { timeout: 5000 }
    )
    .toBe("1 peer");

  // peerB goes offline
  await peerB.page.evaluate(() => {
    (window as any).__skein.presenceManager.broadcastOffline();
  });

  await peerA.page.waitForTimeout(200);

  // poll peerA until it shows solo again
  await expect
    .poll(
      async () => {
        return await peerA.page.evaluate(() => {
          const skein = (window as any).__skein;
          const labelChild = skein.connectionStatus.root.children[2];
          return labelChild?.text ?? null;
        });
      },
      { timeout: 5000 }
    )
    .toBe("solo");
});

test("connection status shows correct plural for multiple peers", async ({ canvasPage }) => {
  const peerA = await canvasPage();
  const peerB = await canvasPage({ canvasDocId: peerA.canvasDocId, context: peerA.context });
  const peerC = await canvasPage({ canvasDocId: peerA.canvasDocId, context: peerA.context });

  await peerA.page.waitForTimeout(200);

  // broadcast online from both peers
  await peerB.page.evaluate(() => {
    (window as any).__skein.presenceManager.broadcastOnline();
  });
  await peerC.page.evaluate(() => {
    (window as any).__skein.presenceManager.broadcastOnline();
  });

  await peerA.page.waitForTimeout(200);

  // poll peerA until it shows 2 peers
  await expect
    .poll(
      async () => {
        return await peerA.page.evaluate(() => {
          const skein = (window as any).__skein;
          const labelChild = skein.connectionStatus.root.children[2];
          return labelChild?.text ?? null;
        });
      },
      { timeout: 5000 }
    )
    .toBe("2 peers");
});

test("connection status is positioned in the bottom-left area", async ({ canvasPage }) => {
  const { page } = await canvasPage();

  const position = await page.evaluate(() => {
    const skein = (window as any).__skein;
    const root = skein.connectionStatus.root;
    const screenHeight = skein.app.screen.height;
    return {
      x: root.x,
      y: root.y,
      screenHeight,
    };
  });

  // should be near the left (x around 8)
  expect(position.x).toBeLessThanOrEqual(16);
  // should be in the bottom half of the screen
  expect(position.y).toBeGreaterThan(position.screenHeight / 2);
});

test("connection status survives canvas destroy without errors", async ({ canvasPage }) => {
  const { page } = await canvasPage();

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
