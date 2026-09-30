// unit tests for the storage-tier decision.
//
// this is the rule the whole media pipeline is being unified around, so these
// tests are deliberately exhaustive over the (syncToLocal x host) matrix —
// there are only four combinations and every one of them has been gotten
// wrong at least once.

import { describe, expect, it } from "vitest";
import {
  ephemeralStoreFor,
  resolveStorageTarget,
  shouldSkipApiCache,
  type PlaybackHost,
} from "./mediaTier";

const HOSTS: PlaybackHost[] = ["webview", "libmpv"];

describe("resolveStorageTarget", () => {
  it("sends media to the library when sync-to-local is on, on every host", () => {
    for (const host of HOSTS) {
      expect(resolveStorageTarget({ syncToLocal: true, host })).toEqual({ tier: "library" });
    }
  });

  it("never assigns an ephemeral store when sync-to-local is on", () => {
    for (const host of HOSTS) {
      expect(resolveStorageTarget({ syncToLocal: true, host }).store).toBeUndefined();
    }
  });

  it("sends media to the ephemeral tier when sync-to-local is off", () => {
    for (const host of HOSTS) {
      expect(resolveStorageTarget({ syncToLocal: false, host }).tier).toBe("ephemeral");
    }
  });

  it("uses the api cache for webview playback with sync off", () => {
    expect(resolveStorageTarget({ syncToLocal: false, host: "webview" })).toEqual({
      tier: "ephemeral",
      store: "cache_api",
    });
  });

  it("uses the _ephemeral dir for the libmpv backend with sync off (it cannot read the Cache API)", () => {
    expect(resolveStorageTarget({ syncToLocal: false, host: "libmpv" })).toEqual({
      tier: "ephemeral",
      store: "ephemeral_dir",
    });
  });
});

describe("ephemeralStoreFor", () => {
  it("maps the libmpv backend to the on-disk ephemeral dir", () => {
    expect(ephemeralStoreFor("libmpv")).toBe("ephemeral_dir");
  });

  it("maps webview to the api cache", () => {
    expect(ephemeralStoreFor("webview")).toBe("cache_api");
  });
});

describe("shouldSkipApiCache", () => {
  it("skips the api cache whenever sync-to-local is on", () => {
    for (const host of HOSTS) {
      expect(shouldSkipApiCache({ syncToLocal: true, host })).toBe(true);
    }
  });

  it("skips the api cache for the libmpv backend even with sync off (bytes go to disk instead)", () => {
    expect(shouldSkipApiCache({ syncToLocal: false, host: "libmpv" })).toBe(true);
  });

  it("permits the api cache only for webview playback with sync off", () => {
    expect(shouldSkipApiCache({ syncToLocal: false, host: "webview" })).toBe(false);
  });
});
