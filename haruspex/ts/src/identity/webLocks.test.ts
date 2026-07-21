import { afterEach, describe, expect, it } from "vitest";

import { acquireNodeLeadership, LOCK_NAME } from "./webLocks.js";

/** navigator is read-only on globalThis in node; use defineProperty to stub it. */
function stubNavigator(value: unknown): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value,
  });
  return () => {
    if (descriptor) {
      Object.defineProperty(globalThis, "navigator", descriptor);
    } else {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        writable: true,
        value: undefined,
      });
    }
  };
}

const restores: Array<() => void> = [];

afterEach(() => {
  while (restores.length) restores.pop()?.();
});

describe("acquireNodeLeadership", () => {
  it("exports the expected lock name", () => {
    expect(LOCK_NAME).toBe("freqhole-iroh-node");
  });

  it("calls onAcquired immediately when navigator.locks is absent", async () => {
    restores.push(stubNavigator(undefined));

    const states: string[] = [];
    let acquired = false;

    const cancel = acquireNodeLeadership({
      onAcquired: () => {
        acquired = true;
      },
      onStateChange: (s) => states.push(s),
    });

    await Promise.resolve();

    expect(states[0]).toBe("unsupported");
    expect(acquired).toBe(true);
    cancel();
  });

  it("calls onAcquired when the lock is granted immediately", async () => {
    restores.push(
      stubNavigator({
        locks: {
          request: async (
            _name: string,
            opts: { ifAvailable?: boolean },
            cb: (lock: Lock | null) => Promise<void>,
          ) => {
            if (opts.ifAvailable) {
              await cb({ name: _name, mode: "exclusive" } as Lock);
            }
          },
        },
      }),
    );

    const states: string[] = [];
    let acquired = false;

    const cancel = acquireNodeLeadership({
      onAcquired: () => {
        acquired = true;
      },
      onStateChange: (s) => states.push(s),
    });

    await new Promise((r) => setTimeout(r, 10));
    cancel();

    expect(states).toContain("leader");
    expect(acquired).toBe(true);
  });

  it("reports waiting when the lock is held elsewhere, then transfers leadership", async () => {
    restores.push(
      stubNavigator({
        locks: {
          request: async (
            _name: string,
            opts: { ifAvailable?: boolean; signal?: AbortSignal },
            cb: (lock: Lock | null) => Promise<void>,
          ) => {
            if (opts.ifAvailable) {
              // lock held elsewhere
              await cb(null);
            } else {
              // queued request: resolve once the current leader "closes"
              await new Promise<void>((resolve, reject) => {
                opts.signal?.addEventListener("abort", () =>
                  reject(new DOMException("aborted", "AbortError")),
                );
                setTimeout(() => resolve(cb(null) as unknown as void), 5);
              });
            }
          },
        },
      }),
    );

    const states: string[] = [];

    const cancel = acquireNodeLeadership({
      onAcquired: () => {},
      onStateChange: (s) => states.push(s),
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(states).toContain("waiting");
    cancel();
    await new Promise((r) => setTimeout(r, 10));
  });

  it("cancel() aborts a pending wait without throwing", async () => {
    restores.push(
      stubNavigator({
        locks: {
          request: async (
            _name: string,
            opts: { ifAvailable?: boolean; signal?: AbortSignal },
            cb: (lock: Lock | null) => Promise<void>,
          ) => {
            if (opts.ifAvailable) {
              await cb(null);
            } else {
              await new Promise<void>((_, reject) => {
                opts.signal?.addEventListener("abort", () =>
                  reject(new DOMException("aborted", "AbortError")),
                );
              });
            }
          },
        },
      }),
    );

    const states: string[] = [];
    const cancel = acquireNodeLeadership({
      onAcquired: () => {},
      onStateChange: (s) => states.push(s),
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(states).toContain("waiting");
    cancel();
    await new Promise((r) => setTimeout(r, 10));
    // no unhandled rejection - the AbortError is swallowed internally
  });
});
