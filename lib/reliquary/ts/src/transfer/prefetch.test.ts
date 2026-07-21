import { describe, expect, it } from "vitest";
import { createPrefetcher } from "./prefetch.js";

interface Item {
  id: string;
  cost: number;
}

function item(id: string, cost: number): Item {
  return { id, cost };
}

describe("Prefetcher", () => {
  it("selects a budget-limited prefix and fetches every selected item", async () => {
    const prefetcher = createPrefetcher<Item>();
    const fetched: string[] = [];
    const settled: string[] = [];
    let resolveAll!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveAll = resolve;
    });

    const items = [item("a", 10), item("b", 10), item("c", 10), item("d", 10)];

    prefetcher.run(items, {
      budget: 25,
      costOf: (it) => it.cost,
      fetchItem: async (it) => {
        fetched.push(it.id);
      },
      onSettled: (it) => {
        settled.push(it.id);
        if (settled.length === 3) resolveAll();
      },
    });

    await done;

    // budget 25: a (15 left), b (5 left), c (-5, still selected since
    // budget was > 0 before subtracting) - the budget check happens in
    // the loop condition, the subtraction after, so the item that
    // crosses zero is still included.
    expect(fetched.sort()).toEqual(["a", "b", "c"]);
    expect(settled.sort()).toEqual(["a", "b", "c"]);
  });

  it("fires onPending for every selected item before fetching starts", async () => {
    const prefetcher = createPrefetcher<Item>();
    const pending: string[] = [];
    let resolveAll!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveAll = resolve;
    });

    prefetcher.run([item("a", 5), item("b", 5)], {
      budget: 100,
      costOf: (it) => it.cost,
      fetchItem: async () => {},
      onPending: (it) => pending.push(it.id),
      onSettled: () => {
        if (pending.length === 2) resolveAll();
      },
    });

    await done;
    expect(pending).toEqual(["a", "b"]);
  });

  it("stops selecting once the budget runs out", async () => {
    const prefetcher = createPrefetcher<Item>();
    const pending: string[] = [];
    let resolveAll!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveAll = resolve;
    });

    prefetcher.run([item("a", 100), item("b", 5), item("c", 5)], {
      budget: 50,
      costOf: (it) => it.cost,
      fetchItem: async () => {},
      onPending: (it) => pending.push(it.id),
      onSettled: () => resolveAll(),
    });

    await done;
    // "a" alone exhausts the budget (100 > 50 remaining after selection),
    // so "b"/"c" are never even considered.
    expect(pending).toEqual(["a"]);
  });

  it("supersedes an in-flight run when run() is called again", async () => {
    const prefetcher = createPrefetcher<Item>();
    const fetchOrder: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    prefetcher.run([item("a", 1), item("b", 1)], {
      budget: 10,
      costOf: (it) => it.cost,
      concurrency: 1,
      fetchItem: async (it) => {
        fetchOrder.push(it.id);
        if (it.id === "a") await firstGate;
      },
    });

    // give the first run a tick to select+start fetching "a", then
    // supersede it before it reaches "b".
    await new Promise((r) => setTimeout(r, 0));

    let secondDone!: () => void;
    const secondFinished = new Promise<void>((resolve) => {
      secondDone = resolve;
    });
    prefetcher.run([item("c", 1)], {
      budget: 10,
      costOf: (it) => it.cost,
      fetchItem: async (it) => {
        fetchOrder.push(it.id);
      },
      onSettled: () => secondDone(),
    });

    await secondFinished;
    releaseFirst();
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchOrder).toContain("a");
    expect(fetchOrder).toContain("c");
    expect(fetchOrder).not.toContain("b");
  });

  it("fires onSettled for selected-but-not-yet-fetched items when superseded", async () => {
    const prefetcher = createPrefetcher<Item>();
    const settled: string[] = [];

    prefetcher.run([item("a", 1), item("b", 1), item("c", 1)], {
      budget: 10,
      costOf: (it) => it.cost,
      concurrency: 1,
      fetchItem: async () => {
        await new Promise((r) => setTimeout(r, 20));
      },
      onSettled: (it) => settled.push(it.id),
    });

    await new Promise((r) => setTimeout(r, 0));
    prefetcher.run([], { budget: 0, costOf: () => 0, fetchItem: async () => {} });

    await new Promise((r) => setTimeout(r, 50));
    // "a" was mid-flight when superseded (its own batch already started,
    // so it still completes); "b" and "c" were selected but never reached
    // a batch - both get a settled callback anyway so ui pending state
    // never leaks.
    expect(settled).toContain("b");
    expect(settled).toContain("c");
  });
});
