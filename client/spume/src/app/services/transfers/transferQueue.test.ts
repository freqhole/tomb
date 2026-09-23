// tests for docs/transfer-unification-plan.md phase 2's bucket-B item-
// queue/job primitive - the single most-reused piece of new code in the
// whole plan (per the doc), so its tests matter most: queue-level pause
// (new items don't start, current item finishes), item-level pause/resume
// delegation to bucket A, cancelling a paused queue, and error handling
// (thrown vs. explicit `{ error }`) that would otherwise stall the loop.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pauseBlobTransfer = vi.fn(async (_blake3: string) => false);
const resumeBlobTransfer = vi.fn((_blake3: string) => {});
vi.mock("./blobTransferRegistry", () => ({
  pauseBlobTransfer: (...a: unknown[]) => pauseBlobTransfer(...(a as [string])),
  resumeBlobTransfer: (...a: unknown[]) => resumeBlobTransfer(...(a as [string])),
}));

import {
  cancelTransferQueue,
  clearTransferQueue,
  createTransferQueue,
  getTransferQueue,
  getTransferQueuesByKind,
  pauseTransferQueue,
  pauseTransferQueueItem,
  resetTransferQueues,
  resumeTransferQueue,
  resumeTransferQueueItem,
  type TransferQueueSendResult,
} from "./transferQueue";

beforeEach(() => {
  resetTransferQueues();
  pauseBlobTransfer.mockReset().mockResolvedValue(false);
  resumeBlobTransfer.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

interface Item {
  id: string;
  title: string;
}

function waitDone(queueId: string): Promise<void> {
  return vi.waitFor(() => {
    expect(getTransferQueue(queueId)?.done).toBe(true);
  });
}

describe("sequential processing", () => {
  it("processes items in order and reports completed status", async () => {
    const order: string[] = [];
    const items: Item[] = [
      { id: "a", title: "Album A" },
      { id: "b", title: "Album B" },
    ];
    const queueId = createTransferQueue({
      kind: "test-kind",
      destName: "remote-1",
      items,
      itemId: (i) => i.id,
      itemLabel: (i) => i.title,
      sendOne: async (item): Promise<TransferQueueSendResult<string>> => {
        order.push(item.id);
        return { result: `sent-${item.id}` };
      },
    });

    await waitDone(queueId);
    expect(order).toEqual(["a", "b"]);
    const q = getTransferQueue(queueId)!;
    expect(q.items.map((i) => i.status)).toEqual(["completed", "completed"]);
    expect(q.items[0].result).toBe("sent-a");
    expect(q.items[1].result).toBe("sent-b");
  });

  it("reportLabel upgrades an item's display label once the real title is known", async () => {
    const items: Item[] = [{ id: "album-1", title: "album-1" }];
    const queueId = createTransferQueue({
      kind: "test-kind",
      destName: "remote-1",
      items,
      itemId: (i) => i.id,
      itemLabel: (i) => i.title, // only the raw id is known up front
      sendOne: async (_item, ctx) => {
        ctx.reportLabel("actual album title");
        return { result: "ok" };
      },
    });
    await waitDone(queueId);
    expect(getTransferQueue(queueId)!.items[0].label).toBe("actual album title");
  });

  it("calls onDone exactly once, after the queue is already marked done", async () => {
    const onDone = vi.fn();
    const items: Item[] = [{ id: "a", title: "A" }];
    const queueId = createTransferQueue({
      kind: "test-kind",
      destName: "remote-1",
      items,
      itemId: (i) => i.id,
      itemLabel: (i) => i.title,
      sendOne: async () => ({ result: "ok" }),
      onDone,
    });
    await waitDone(queueId);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ id: queueId, done: true }));
  });

  it("marks an item failed via an explicit {error} result without stopping the queue", async () => {
    const items: Item[] = [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
    ];
    const queueId = createTransferQueue({
      kind: "test-kind",
      destName: "remote-1",
      items,
      itemId: (i) => i.id,
      itemLabel: (i) => i.title,
      sendOne: async (item) => {
        if (item.id === "a") return { error: "network unreachable" };
        return { result: "ok" };
      },
    });

    await waitDone(queueId);
    const q = getTransferQueue(queueId)!;
    expect(q.items[0]).toMatchObject({ status: "failed", error: "network unreachable" });
    expect(q.items[1]).toMatchObject({ status: "completed", result: "ok" });
  });

  it("catches a thrown error from sendOne and marks the item failed", async () => {
    const items: Item[] = [{ id: "a", title: "A" }];
    const queueId = createTransferQueue({
      kind: "test-kind",
      destName: "remote-1",
      items,
      itemId: (i) => i.id,
      itemLabel: (i) => i.title,
      sendOne: async () => {
        throw new Error("boom");
      },
    });

    await waitDone(queueId);
    expect(getTransferQueue(queueId)!.items[0]).toMatchObject({
      status: "failed",
      error: "boom",
    });
  });
});

describe("queue-level pause/resume", () => {
  it("pausing while the first item runs blocks the second until resumed", async () => {
    const started: string[] = [];
    const items: Item[] = [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
    ];
    const queueId = createTransferQueue({
      kind: "test-kind",
      destName: "remote-1",
      items,
      itemId: (i) => i.id,
      itemLabel: (i) => i.title,
      sendOne: async (item) => {
        started.push(item.id);
        // pause takes effect for whichever item hasn't STARTED yet - the
        // current item (a) still runs to completion (documented queue-
        // level pause semantics), same as bulkSendJobs.ts's own model.
        if (item.id === "a") pauseTransferQueue(queueId);
        return { result: "ok" };
      },
    });

    await vi.waitFor(() => expect(started).toEqual(["a"]));
    expect(getTransferQueue(queueId)?.paused).toBe(true);
    expect(getTransferQueue(queueId)?.items[0].status).not.toBe("pending");

    // give the loop a few microtask turns - "b" should still be blocked.
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(["a"]);
    expect(getTransferQueue(queueId)?.items[1].status).toBe("pending");

    resumeTransferQueue(queueId);
    await waitDone(queueId);
    expect(started).toEqual(["a", "b"]);
  });

  it("cancelling a paused queue unblocks the loop and stops it before any more items run", async () => {
    const started: string[] = [];
    const items: Item[] = [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
      { id: "c", title: "C" },
    ];
    const queueId = createTransferQueue({
      kind: "test-kind",
      destName: "remote-1",
      items,
      itemId: (i) => i.id,
      itemLabel: (i) => i.title,
      sendOne: async (item) => {
        started.push(item.id);
        if (item.id === "a") pauseTransferQueue(queueId);
        return { result: "ok" };
      },
    });

    await vi.waitFor(() => expect(started).toEqual(["a"]));
    expect(getTransferQueue(queueId)?.paused).toBe(true);

    cancelTransferQueue(queueId);
    await waitDone(queueId);
    // "a" already ran to completion before the pause took effect; "b"/"c"
    // never started because cancel unblocked the loop straight into the
    // cancelled check, not into starting the next item.
    expect(started).toEqual(["a"]);
    expect(getTransferQueue(queueId)?.cancelled).toBe(true);
    const remaining = getTransferQueue(queueId)!.items.filter((i) => i.id !== "a");
    expect(remaining.every((i) => i.status === "pending")).toBe(true);
  });
});

describe("concurrency", () => {
  it("defaults to concurrency 1 - items run strictly sequentially", async () => {
    const concurrentAtOnce: number[] = [];
    let active = 0;
    const items: Item[] = [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
      { id: "c", title: "C" },
    ];
    const queueId = createTransferQueue({
      kind: "test-kind",
      destName: "remote-1",
      items,
      itemId: (i) => i.id,
      itemLabel: (i) => i.title,
      sendOne: async () => {
        active++;
        concurrentAtOnce.push(active);
        await Promise.resolve();
        active--;
        return { result: "ok" };
      },
    });
    await waitDone(queueId);
    expect(concurrentAtOnce.every((n) => n === 1)).toBe(true);
  });

  it("runs up to `concurrency` items in parallel, never more", async () => {
    let active = 0;
    let maxActive = 0;
    const items: Item[] = Array.from({ length: 5 }, (_, i) => ({ id: `${i}`, title: `item ${i}` }));
    let releaseAll!: () => void;
    const gate = new Promise<void>((resolve) => (releaseAll = resolve));
    const queueId = createTransferQueue({
      kind: "test-kind",
      destName: "remote-1",
      items,
      itemId: (i) => i.id,
      itemLabel: (i) => i.title,
      concurrency: 2,
      sendOne: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await gate;
        active--;
        return { result: "ok" };
      },
    });
    // exactly 2 workers should be active (concurrency: 2), never more, even
    // though 5 items are pending.
    await vi.waitFor(() => expect(active).toBe(2));
    await Promise.resolve();
    expect(active).toBe(2);
    releaseAll();
    await waitDone(queueId);
    expect(maxActive).toBe(2);
    expect(getTransferQueue(queueId)!.items.every((i) => i.status === "completed")).toBe(true);
  });

  it("queue-level pause still stops NEW items from starting under concurrency > 1", async () => {
    const started: string[] = [];
    const items: Item[] = Array.from({ length: 4 }, (_, i) => ({ id: `${i}`, title: `item ${i}` }));
    const queueId = createTransferQueue({
      kind: "test-kind",
      destName: "remote-1",
      items,
      itemId: (i) => i.id,
      itemLabel: (i) => i.title,
      concurrency: 2,
      sendOne: async (item) => {
        started.push(item.id);
        if (item.id === "0") pauseTransferQueue(queueId);
        return { result: "ok" };
      },
    });
    // give both initial workers a chance to run (one triggers pause, the
    // other - item "1" - was already claimed before the pause took effect).
    await vi.waitFor(() => expect(started.length).toBeGreaterThanOrEqual(2));
    expect(getTransferQueue(queueId)?.paused).toBe(true);
    expect(started).not.toContain("2");
    expect(started).not.toContain("3");

    resumeTransferQueue(queueId);
    await waitDone(queueId);
    expect(started.sort()).toEqual(["0", "1", "2", "3"]);
  });
});

describe("clearTransferQueue", () => {
  it("is a no-op while the queue is still in progress", async () => {
    let releaseA!: () => void;
    const items: Item[] = [{ id: "a", title: "A" }];
    const queueId = createTransferQueue({
      kind: "test-kind",
      destName: "remote-1",
      items,
      itemId: (i) => i.id,
      itemLabel: (i) => i.title,
      sendOne: async () => {
        await new Promise<void>((resolve) => (releaseA = resolve));
        return { result: "ok" };
      },
    });
    await vi.waitFor(() => expect(getTransferQueue(queueId)?.items[0].status).toBe("active"));
    clearTransferQueue(queueId);
    expect(getTransferQueue(queueId)).toBeDefined();
    releaseA();
    await waitDone(queueId);
  });

  it("removes a finished queue", async () => {
    const items: Item[] = [{ id: "a", title: "A" }];
    const queueId = createTransferQueue({
      kind: "test-kind",
      destName: "remote-1",
      items,
      itemId: (i) => i.id,
      itemLabel: (i) => i.title,
      sendOne: async () => ({ result: "ok" }),
    });
    await waitDone(queueId);
    clearTransferQueue(queueId);
    expect(getTransferQueue(queueId)).toBeUndefined();
  });
});

describe("getTransferQueuesByKind", () => {
  it("filters concurrent queues of different kinds", async () => {
    const musicId = createTransferQueue({
      kind: "music-import",
      destName: "remote-1",
      items: [{ id: "m1", title: "song" }] as Item[],
      itemId: (i) => i.id,
      itemLabel: (i) => i.title,
      sendOne: async () => ({ result: "ok" }),
    });
    const videoId = createTransferQueue({
      kind: "video-import",
      destName: "remote-1",
      items: [{ id: "v1", title: "clip" }] as Item[],
      itemId: (i) => i.id,
      itemLabel: (i) => i.title,
      sendOne: async () => ({ result: "ok" }),
    });
    await waitDone(musicId);
    await waitDone(videoId);
    expect(getTransferQueuesByKind("music-import").map((q) => q.id)).toEqual([musicId]);
    expect(getTransferQueuesByKind("video-import").map((q) => q.id)).toEqual([videoId]);
  });
});

describe("item-level pause/resume (delegates to bucket A)", () => {
  it("pauseTransferQueueItem is a no-op for an item with no blobTransferBlake3", async () => {
    const items: Item[] = [{ id: "a", title: "A" }];
    let releaseA!: () => void;
    const queueId = createTransferQueue({
      kind: "test-kind",
      destName: "remote-1",
      items,
      itemId: (i) => i.id,
      itemLabel: (i) => i.title,
      sendOne: async () => {
        await new Promise<void>((resolve) => (releaseA = resolve));
        return { result: "ok" };
      },
    });
    await vi.waitFor(() => expect(getTransferQueue(queueId)?.items[0].status).toBe("active"));
    const paused = await pauseTransferQueueItem(queueId, "a");
    expect(paused).toBe(false);
    expect(pauseBlobTransfer).not.toHaveBeenCalled();
    releaseA();
    await waitDone(queueId);
  });

  it("pauseTransferQueueItem flips status to paused when bucket A confirms a real pause", async () => {
    pauseBlobTransfer.mockResolvedValue(true);
    let releaseA!: () => void;
    const items: Item[] = [{ id: "a", title: "A" }];
    const queueId = createTransferQueue({
      kind: "test-kind",
      destName: "remote-1",
      items,
      itemId: (i) => i.id,
      itemLabel: (i) => i.title,
      sendOne: async (_item, ctx) => {
        ctx.reportBlake3("hash123");
        await new Promise<void>((resolve) => (releaseA = resolve));
        return { result: "ok" };
      },
    });
    await vi.waitFor(() =>
      expect(getTransferQueue(queueId)?.items[0].blobTransferBlake3).toBe("hash123")
    );

    const paused = await pauseTransferQueueItem(queueId, "a");
    expect(paused).toBe(true);
    expect(pauseBlobTransfer).toHaveBeenCalledWith("hash123");
    expect(getTransferQueue(queueId)?.items[0].status).toBe("paused");

    resumeTransferQueueItem(queueId, "a");
    expect(resumeBlobTransfer).toHaveBeenCalledWith("hash123");
    expect(getTransferQueue(queueId)?.items[0].status).toBe("active");

    releaseA();
    await waitDone(queueId);
  });
});
