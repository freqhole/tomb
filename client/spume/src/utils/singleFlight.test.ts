// tests for the keyed single-flight guard.
//
// this exists because the auto-download manager runs 3 syncs concurrently,
// and every `getOrCreate*` helper does read -> await -> write. without the
// guard, three episodes of one series each miss the lookup and each create a
// row, which is how duplicate series appeared in the local library.

import { describe, expect, it, vi } from "vitest";
import { singleFlight } from "./singleFlight";

describe("singleFlight", () => {
  it("runs the work once for concurrent callers on the same key", async () => {
    const work = vi.fn(async () => "created");
    const results = await Promise.all([
      singleFlight("k", work),
      singleFlight("k", work),
      singleFlight("k", work),
    ]);
    expect(work).toHaveBeenCalledTimes(1);
    expect(results).toEqual(["created", "created", "created"]);
  });

  it("keeps different keys independent", async () => {
    const work = vi.fn(async (v: string) => v);
    const [a, b] = await Promise.all([
      singleFlight("a", () => work("a")),
      singleFlight("b", () => work("b")),
    ]);
    expect(work).toHaveBeenCalledTimes(2);
    expect([a, b]).toEqual(["a", "b"]);
  });

  // the entry has to clear, or a later sync would reuse a stale row forever
  it("runs again for the same key once the first settles", async () => {
    const work = vi.fn(async () => "x");
    await singleFlight("k", work);
    await singleFlight("k", work);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("propagates rejection to every concurrent caller", async () => {
    const work = vi.fn(async () => {
      throw new Error("nope");
    });
    const a = singleFlight("k", work);
    const b = singleFlight("k", work);
    await expect(a).rejects.toThrow("nope");
    await expect(b).rejects.toThrow("nope");
    expect(work).toHaveBeenCalledTimes(1);
  });

  // a failure must not poison the key
  it("allows a retry after a failure", async () => {
    const failing = vi.fn(async () => {
      throw new Error("nope");
    });
    await expect(singleFlight("k", failing)).rejects.toThrow();
    await expect(singleFlight("k", async () => "recovered")).resolves.toBe("recovered");
  });

  it("shares the result of slow work with a caller that arrives mid-flight", async () => {
    let release: (v: string) => void = () => {};
    const work = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        })
    );
    const first = singleFlight("k", work);
    const second = singleFlight("k", work);
    release("shared");
    expect(await first).toBe("shared");
    expect(await second).toBe("shared");
    expect(work).toHaveBeenCalledTimes(1);
  });
});
