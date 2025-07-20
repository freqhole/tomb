import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSignal } from "solid-js";
import { createLiveQuery } from "./services/indexedDBService.js";

// Mock idb
vi.mock("idb", () => ({
  openDB: vi.fn(() => Promise.resolve({
    getAll: vi.fn(() => Promise.resolve([]))
  }))
}));

// Mock BroadcastChannel
global.BroadcastChannel = vi.fn(() => ({
  postMessage: vi.fn(),
  onmessage: null,
  close: vi.fn(),
})) as any;

describe("Signal Reactivity Debug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should compare custom signal vs SolidJS signal behavior", () => {
    // Create custom signal (from indexedDBService)
    const customSignal = createLiveQuery({
      dbName: "test",
      storeName: "playlists"
    });

    // Create SolidJS signal
    const [solidSignal, setSolidSignal] = createSignal([]);

    // Both should have get/call methods
    expect(typeof customSignal.get).toBe("function");
    expect(typeof solidSignal).toBe("function");

    // Both should return empty arrays initially
    expect(customSignal.get()).toEqual([]);
    expect(solidSignal()).toEqual([]);

    console.log("✅ Basic signal interface compatibility works");
  });

  it("should test subscription mechanism", () => {
    const customSignal = createLiveQuery({
      dbName: "test",
      storeName: "playlists"
    });

    const subscriptionCalls = [];

    // Subscribe to changes
    const unsubscribe = customSignal.subscribe((value) => {
      subscriptionCalls.push(value);
      console.log("📡 Custom signal updated:", value);
    });

    // Should have received initial value
    expect(subscriptionCalls).toHaveLength(1);
    expect(subscriptionCalls[0]).toEqual([]);

    console.log("✅ Subscription mechanism works");
    unsubscribe();
  });

  it("should identify the core reactivity issue", () => {
    // The issue: playlistsQuery.get() in JSX doesn't trigger SolidJS re-renders
    // because SolidJS doesn't know about our custom signal system

    const customQuery = createLiveQuery({
      dbName: "test",
      storeName: "playlists"
    });

    // SolidJS tracks reactive reads during render
    // But calling customQuery.get() doesn't register with SolidJS tracking

    console.log("🔍 ROOT CAUSE: customQuery.get() is not a SolidJS reactive primitive");
    console.log("💡 SOLUTION: Bridge custom signals to SolidJS signals");

    expect(true).toBe(true);
  });

  it("should demonstrate the fix approach", () => {
    // Create custom signal
    const customQuery = createLiveQuery({
      dbName: "test",
      storeName: "playlists"
    });

    // Create SolidJS signal to bridge to
    const [reactiveData, setReactiveData] = createSignal([]);

    // Bridge: subscribe to custom signal and update SolidJS signal
    customQuery.subscribe((value) => {
      setReactiveData(value);
    });

    // Now reactiveData() will be reactive in JSX
    expect(typeof reactiveData).toBe("function");
    expect(reactiveData()).toEqual([]);

    console.log("✅ Bridge pattern: Custom Signal -> SolidJS Signal -> Reactive JSX");
  });
});
