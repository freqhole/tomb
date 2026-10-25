// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const isLocalOrCharnelManagedVideoSource = vi.fn(() => false);
vi.mock("../data/currentState", () => ({
  isLocalOrCharnelManagedVideoSource: () => isLocalOrCharnelManagedVideoSource(),
}));

import {
  clearSyncedVideoIds,
  markVideoSynced,
  isVideoAlreadyLocal,
} from "./syncState";

describe("isVideoAlreadyLocal", () => {
  beforeEach(() => {
    clearSyncedVideoIds();
    isLocalOrCharnelManagedVideoSource.mockReturnValue(false);
  });

  it("is true for a genuinely-local video regardless of remote context", () => {
    expect(isVideoAlreadyLocal({ source_type: "local", id: "v1" })).toBe(true);
  });

  it("is true for a remote video once it's been synced down", () => {
    const video = { source_type: "remote", id: "v2" };
    expect(isVideoAlreadyLocal(video)).toBe(false);
    markVideoSynced("v2");
    expect(isVideoAlreadyLocal(video)).toBe(true);
  });

  it("is true for any video (even a 'remote'-tagged one) while browsing the local library or a charnel-managed remote - the cheap, synchronous short-circuit", () => {
    isLocalOrCharnelManagedVideoSource.mockReturnValue(true);
    expect(isVideoAlreadyLocal({ source_type: "remote", id: "v3" })).toBe(true);
  });

  it("is false for a not-yet-synced remote video on a genuine (non-charnel-managed) remote", () => {
    expect(isVideoAlreadyLocal({ source_type: "remote", id: "v4" })).toBe(false);
  });
});
