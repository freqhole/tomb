import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SHARE_WEB_HOST, getShareWebHost } from "./permalink";

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
