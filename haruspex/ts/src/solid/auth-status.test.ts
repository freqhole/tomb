import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { createAuthStatus } from "./auth-status.js";

interface Entry {
  loggedIn: boolean;
  username?: string;
}

describe("createAuthStatus", () => {
  it("starts empty - get returns undefined for an unqueried key", () => {
    createRoot((dispose) => {
      const store = createAuthStatus<Entry>();
      expect(store.get("remote-a")).toBeUndefined();
      expect(store.status().size).toBe(0);
      dispose();
    });
  });

  it("markPending sets the entry to null (in flight)", () => {
    createRoot((dispose) => {
      const store = createAuthStatus<Entry>();
      store.markPending("remote-a");
      expect(store.get("remote-a")).toBeNull();
      dispose();
    });
  });

  it("patch stores a resolved entry", () => {
    createRoot((dispose) => {
      const store = createAuthStatus<Entry>();
      store.patch("remote-a", { loggedIn: true, username: "viz" });
      expect(store.get("remote-a")).toEqual({ loggedIn: true, username: "viz" });
      dispose();
    });
  });

  it("resetPending marks exactly the given keys as pending, dropping others", () => {
    createRoot((dispose) => {
      const store = createAuthStatus<Entry>();
      store.patch("remote-a", { loggedIn: true });
      store.resetPending(["remote-b", "remote-c"]);
      expect(store.get("remote-a")).toBeUndefined();
      expect(store.get("remote-b")).toBeNull();
      expect(store.get("remote-c")).toBeNull();
      dispose();
    });
  });

  it("clear drops one key without touching others", () => {
    createRoot((dispose) => {
      const store = createAuthStatus<Entry>();
      store.patch("remote-a", { loggedIn: true });
      store.patch("remote-b", { loggedIn: false });
      store.clear("remote-a");
      expect(store.get("remote-a")).toBeUndefined();
      expect(store.get("remote-b")).toEqual({ loggedIn: false });
      dispose();
    });
  });

  it("clear is a no-op when the key was never present", () => {
    createRoot((dispose) => {
      const store = createAuthStatus<Entry>();
      const before = store.status();
      store.clear("nonexistent");
      expect(store.status()).toBe(before);
      dispose();
    });
  });
});
