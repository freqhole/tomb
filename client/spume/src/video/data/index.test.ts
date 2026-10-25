// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CurrentRemoteInfo } from "../../music/data/currentState";

// mock only the true leaf dependency - everything else in the chain
// (video/data/index.ts's own logic) runs for real, unlike
// syncState.test.ts's isVideoAlreadyLocal tests, which mock this whole
// module away. this is the piece that actually needs to agree with
// real CurrentRemoteInfo shapes (remote_id/is_charnel_managed etc.) -
// a typo or field-name mismatch here wouldn't be caught by a test that
// mocks this file itself.
const getCurrentRemote = vi.fn<() => CurrentRemoteInfo | null>(() => null);
vi.mock("../../music/data/currentState", () => ({
  getCurrentRemote: () => getCurrentRemote(),
}));

import { isLocalOrCharnelManagedVideoSource, isLocalVideoSourceActive } from "./index";

describe("isLocalOrCharnelManagedVideoSource", () => {
  beforeEach(() => {
    getCurrentRemote.mockReset();
  });

  it("is true when there's no active remote at all (plain local-library browsing)", () => {
    getCurrentRemote.mockReturnValue(null);
    expect(isLocalOrCharnelManagedVideoSource()).toBe(true);
    expect(isLocalVideoSourceActive()).toBe(true);
  });

  it("is true when the active remote is charnel-managed (tauri's own local server)", () => {
    getCurrentRemote.mockReturnValue({
      remote_id: "tauri-local",
      name: "my desktop app",
      is_charnel_managed: true,
    });
    expect(isLocalOrCharnelManagedVideoSource()).toBe(true);
    // ...but isLocalVideoSourceActive stays false - it answers a
    // different question ("use the IndexedDB data source"), not "no
    // real network latency" - getVideoDataSource() must still route a
    // charnel-managed remote through RemoteVideoDataSource, since it's
    // genuinely fetched over HTTP, just to localhost.
    expect(isLocalVideoSourceActive()).toBe(false);
  });

  it("is false for a genuine, non-charnel-managed remote", () => {
    getCurrentRemote.mockReturnValue({
      remote_id: "someones-real-server",
      name: "a friend's server",
      is_charnel_managed: false,
    });
    expect(isLocalOrCharnelManagedVideoSource()).toBe(false);
    expect(isLocalVideoSourceActive()).toBe(false);
  });

  it("is false for a genuine remote whose is_charnel_managed field is simply absent", () => {
    getCurrentRemote.mockReturnValue({
      remote_id: "someones-real-server",
      name: "a friend's server",
    });
    expect(isLocalOrCharnelManagedVideoSource()).toBe(false);
  });
});
