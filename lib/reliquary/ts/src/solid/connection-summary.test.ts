import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConnectionSummary, type ConnectionSummaryLike } from "./connection-summary.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function makeSource(summary: ConnectionSummaryLike) {
  return { getConnectionSummary: () => summary };
}

describe("createConnectionSummary", () => {
  it("reads the source immediately on creation", () => {
    createRoot((dispose) => {
      const source = makeSource({ connected: 2, reconnecting: 1, failed: 0 });
      const summary = createConnectionSummary(() => source);
      expect(summary()).toEqual({ connected: 2, reconnecting: 1, failed: 0 });
      dispose();
    });
  });

  it("stays at the default when the source is not yet available", () => {
    createRoot((dispose) => {
      const summary = createConnectionSummary(() => null);
      expect(summary()).toEqual({ connected: 0, reconnecting: 0, failed: 0 });
      dispose();
    });
  });

  it("re-polls the source on the configured interval", () => {
    createRoot((dispose) => {
      let current: ConnectionSummaryLike = { connected: 0, reconnecting: 0, failed: 0 };
      const source = { getConnectionSummary: () => current };
      const summary = createConnectionSummary(() => source, { pollIntervalMs: 1000 });

      current = { connected: 3, reconnecting: 0, failed: 1 };
      expect(summary()).toEqual({ connected: 0, reconnecting: 0, failed: 0 });

      vi.advanceTimersByTime(1000);
      expect(summary()).toEqual({ connected: 3, reconnecting: 0, failed: 1 });

      dispose();
    });
  });

  it("stops polling once the owning root is disposed", () => {
    createRoot((dispose) => {
      let calls = 0;
      const source = {
        getConnectionSummary: () => {
          calls++;
          return { connected: 0, reconnecting: 0, failed: 0 };
        },
      };
      createConnectionSummary(() => source, { pollIntervalMs: 500 });
      const callsAtDispose = calls;
      dispose();
      vi.advanceTimersByTime(5000);
      expect(calls).toBe(callsAtDispose);
    });
  });
});
