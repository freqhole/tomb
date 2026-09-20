import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SHARE_WEB_HOST,
  encodeShareToken,
  extractShareTokenFromHash,
  getShareWebHost,
  type SharePayloadV1,
} from "./permalink";

vi.mock("../app/services/charnel/mode", () => ({
  isCharnelMode: vi.fn(() => false),
}));

import { isCharnelMode } from "../app/services/charnel/mode";

function stubOrigin(origin: string) {
  vi.stubGlobal("window", { location: { origin } });
}

describe("getShareWebHost", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(isCharnelMode).mockReturnValue(false);
  });

  it("uses the page origin when it's a real http(s) host", () => {
    stubOrigin("https://music.example.com");
    expect(getShareWebHost()).toBe("https://music.example.com");
  });

  it("falls back for tauri's custom-scheme origin (macos/ios/linux)", () => {
    stubOrigin("tauri://localhost");
    expect(getShareWebHost()).toBe(DEFAULT_SHARE_WEB_HOST);
  });

  it("falls back for tauri's https-scheme android origin", () => {
    // android's tauri webview reports an http(s)-scheme origin, unlike
    // every other platform - a scheme-only check would let this through.
    stubOrigin("https://tauri.localhost");
    expect(getShareWebHost()).toBe(DEFAULT_SHARE_WEB_HOST);
  });

  it("falls back whenever isCharnelMode() reports tauri, regardless of origin shape", () => {
    vi.mocked(isCharnelMode).mockReturnValue(true);
    stubOrigin("https://music.example.com");
    expect(getShareWebHost()).toBe(DEFAULT_SHARE_WEB_HOST);
  });

  it("falls back for a non-http(s) origin", () => {
    stubOrigin("file://");
    expect(getShareWebHost()).toBe(DEFAULT_SHARE_WEB_HOST);
  });
});

describe("extractShareTokenFromHash", () => {
  const payload: SharePayloadV1 = {
    v: 1,
    s: { n: "a".repeat(64) },
    k: "radio_station",
    i: "station-1",
  };

  it("extracts a token from spume's own #?share=<token> shape", () => {
    const token = encodeShareToken(payload);
    expect(extractShareTokenFromHash(`#?${"share"}=${token}`)).toBe(token);
  });

  it("extracts a token from spume's #/route?share=<token> shape", () => {
    const token = encodeShareToken(payload);
    expect(extractShareTokenFromHash(`#/albums/xyz?share=${token}`)).toBe(token);
  });

  it("does NOT treat an unrelated route containing '&' as a share token", () => {
    // reproduces a real bug: `startSharedRadioStation` navigates to
    // `/radio?node_id=...&station_id=...` after a share link's "play
    // radio station" button - this must never be misread as a second,
    // bogus share token by the same hashchange listener that noticed the
    // ORIGINAL link, or the share modal reopens with garbage and shows
    // "invalid share token" right after a successful share resolve.
    expect(
      extractShareTokenFromHash(`/radio?node_id=${"a".repeat(64)}&station_id=abc123`)
    ).toBeNull();
  });

  it("still extracts a haruspex-style #share/<token> fragment", () => {
    const token = encodeShareToken(payload);
    expect(extractShareTokenFromHash(`#share/${token}`)).toBe(token);
  });

  it("returns null for an unrelated hash with no share marker at all", () => {
    expect(extractShareTokenFromHash("#/settings")).toBeNull();
    expect(extractShareTokenFromHash("")).toBeNull();
  });
});
