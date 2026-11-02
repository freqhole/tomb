import { describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  return values;
});

import {
  enableRemotePlaybackByDefault,
  remotePlaybackEnabled,
  setRemotePlaybackEnabled,
} from "./remoteModeSettings";

const KEY = "spume.remotePlaybackEnabled";

describe("enableRemotePlaybackByDefault", () => {
  it("turns remote playback on only while nobody has chosen", () => {
    expect(remotePlaybackEnabled()).toBe(false);
    enableRemotePlaybackByDefault();
    expect(remotePlaybackEnabled()).toBe(true);
    expect(store.get(KEY)).toBe("true");

    // an explicit off choice wins over the dedicated-player default.
    setRemotePlaybackEnabled(false);
    enableRemotePlaybackByDefault();
    expect(remotePlaybackEnabled()).toBe(false);
    expect(store.get(KEY)).toBe("false");

    store.delete(KEY);
    enableRemotePlaybackByDefault();
    expect(remotePlaybackEnabled()).toBe(true);
  });
});
