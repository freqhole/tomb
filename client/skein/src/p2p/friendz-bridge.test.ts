// ---------------------------------------------------------------------------
// unit tests for friendz-bridge
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FriendzProtocol } from "./friends-protocol";
import {
    acceptFriendRequest,
    destroyBridge,
    getOnlinePeers,
    initBridge,
    isOnline,
    isProtocolReady,
    onBridgeReady,
    onOnlineChange,
    rejectFriendRequest,
    requestProfile,
    sendFriendRequest,
    setFriendRequestsFrom,
    setProfileVisibility,
} from "./friendz-bridge";

// ---------------------------------------------------------------------------
// mock helpers
// ---------------------------------------------------------------------------

function createMockProtocol() {
  return {
    isOnline: vi.fn((_nodeId: string) => false),
    getOnlinePeers: vi.fn(() => [] as string[]),
    onOnlineChange: vi.fn((_handler: () => void) => () => {}),
    sendFriendRequest: vi.fn(async (_peerNodeId: string) => {}),
    sendFriendAccept: vi.fn(async (_peerNodeId: string) => {}),
    sendFriendReject: vi.fn(async (_peerNodeId: string) => {}),
    requestProfile: vi.fn(async (_peerNodeId: string) => {}),
    setProfileVisibility: vi.fn((_v: string) => {}),
    setFriendRequestsFrom: vi.fn((_f: string) => {}),
  };
}

function asFriendzProtocol(mock: ReturnType<typeof createMockProtocol>): FriendzProtocol {
  return mock as unknown as FriendzProtocol;
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("friendz-bridge", () => {
  beforeEach(() => {
    destroyBridge();
  });

  // -------------------------------------------------------------------------
  // 1. initial state
  // -------------------------------------------------------------------------

  describe("initial state", () => {
    it("isProtocolReady() returns false", () => {
      expect(isProtocolReady()).toBe(false);
    });

    it("isOnline() returns false for any node", () => {
      expect(isOnline("some-node-id")).toBe(false);
    });

    it("getOnlinePeers() returns an empty array", () => {
      expect(getOnlinePeers()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // 2. initBridge
  // -------------------------------------------------------------------------

  describe("initBridge", () => {
    it("sets isProtocolReady() to true", () => {
      const mock = createMockProtocol();
      initBridge(asFriendzProtocol(mock));
      expect(isProtocolReady()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 3. destroyBridge
  // -------------------------------------------------------------------------

  describe("destroyBridge", () => {
    it("sets isProtocolReady() back to false", () => {
      const mock = createMockProtocol();
      initBridge(asFriendzProtocol(mock));
      expect(isProtocolReady()).toBe(true);

      destroyBridge();
      expect(isProtocolReady()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 4. state queries delegate to protocol
  // -------------------------------------------------------------------------

  describe("state queries delegate to protocol", () => {
    it("isOnline() delegates to protocol.isOnline()", () => {
      const mock = createMockProtocol();
      mock.isOnline.mockReturnValue(true);
      initBridge(asFriendzProtocol(mock));

      const result = isOnline("peer-abc");
      expect(result).toBe(true);
      expect(mock.isOnline).toHaveBeenCalledWith("peer-abc");
    });

    it("getOnlinePeers() delegates to protocol.getOnlinePeers()", () => {
      const mock = createMockProtocol();
      mock.getOnlinePeers.mockReturnValue(["peer-1", "peer-2"]);
      initBridge(asFriendzProtocol(mock));

      const result = getOnlinePeers();
      expect(result).toEqual(["peer-1", "peer-2"]);
      expect(mock.getOnlinePeers).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 5. actions throw when not ready
  // -------------------------------------------------------------------------

  describe("actions throw when not ready", () => {
    it("sendFriendRequest() throws", async () => {
      await expect(sendFriendRequest("peer-1")).rejects.toThrow(
        "friendz bridge not initialized",
      );
    });

    it("acceptFriendRequest() throws", async () => {
      await expect(acceptFriendRequest("peer-1")).rejects.toThrow(
        "friendz bridge not initialized",
      );
    });

    it("rejectFriendRequest() throws", async () => {
      await expect(rejectFriendRequest("peer-1")).rejects.toThrow(
        "friendz bridge not initialized",
      );
    });

    it("requestProfile() throws", async () => {
      await expect(requestProfile("peer-1")).rejects.toThrow(
        "friendz bridge not initialized",
      );
    });
  });

  // -------------------------------------------------------------------------
  // 6. actions delegate when ready
  // -------------------------------------------------------------------------

  describe("actions delegate when ready", () => {
    it("sendFriendRequest() delegates to protocol.sendFriendRequest()", async () => {
      const mock = createMockProtocol();
      initBridge(asFriendzProtocol(mock));

      await sendFriendRequest("peer-42");
      expect(mock.sendFriendRequest).toHaveBeenCalledWith("peer-42");
    });

    it("acceptFriendRequest() delegates to protocol.sendFriendAccept()", async () => {
      const mock = createMockProtocol();
      initBridge(asFriendzProtocol(mock));

      await acceptFriendRequest("peer-99");
      expect(mock.sendFriendAccept).toHaveBeenCalledWith("peer-99");
    });

    it("rejectFriendRequest() delegates to protocol.sendFriendReject()", async () => {
      const mock = createMockProtocol();
      initBridge(asFriendzProtocol(mock));

      await rejectFriendRequest("peer-77");
      expect(mock.sendFriendReject).toHaveBeenCalledWith("peer-77");
    });

    it("requestProfile() delegates to protocol.requestProfile()", async () => {
      const mock = createMockProtocol();
      initBridge(asFriendzProtocol(mock));

      await requestProfile("peer-11");
      expect(mock.requestProfile).toHaveBeenCalledWith("peer-11");
    });
  });

  // -------------------------------------------------------------------------
  // 7. onOnlineChange defers until ready
  // -------------------------------------------------------------------------

  describe("onOnlineChange defers until ready", () => {
    it("registers the handler once initBridge is called", () => {
      const mock = createMockProtocol();
      const handler = vi.fn();

      // register before bridge is ready
      onOnlineChange(handler);
      expect(mock.onOnlineChange).not.toHaveBeenCalled();

      // now initialize — deferred registration should fire
      initBridge(asFriendzProtocol(mock));
      expect(mock.onOnlineChange).toHaveBeenCalledWith(handler);
    });

    it("registers immediately when bridge is already ready", () => {
      const mock = createMockProtocol();
      initBridge(asFriendzProtocol(mock));

      const handler = vi.fn();
      onOnlineChange(handler);
      expect(mock.onOnlineChange).toHaveBeenCalledWith(handler);
    });

    it("cancels deferred registration when unsub is called before init", () => {
      const mock = createMockProtocol();
      const handler = vi.fn();

      const unsub = onOnlineChange(handler);
      unsub();

      initBridge(asFriendzProtocol(mock));
      expect(mock.onOnlineChange).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 8. onBridgeReady fires on init
  // -------------------------------------------------------------------------

  describe("onBridgeReady fires on init", () => {
    it("fires the handler when initBridge is called", () => {
      const handler = vi.fn();
      onBridgeReady(handler);
      expect(handler).not.toHaveBeenCalled();

      const mock = createMockProtocol();
      initBridge(asFriendzProtocol(mock));
      expect(handler).toHaveBeenCalledOnce();
    });

    it("does not fire after unsub is called before init", () => {
      const handler = vi.fn();
      const unsub = onBridgeReady(handler);
      unsub();

      const mock = createMockProtocol();
      initBridge(asFriendzProtocol(mock));
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 9. onBridgeReady fires immediately if already ready
  // -------------------------------------------------------------------------

  describe("onBridgeReady fires immediately if already ready", () => {
    it("fires synchronously when bridge is already initialized", () => {
      const mock = createMockProtocol();
      initBridge(asFriendzProtocol(mock));

      const handler = vi.fn();
      onBridgeReady(handler);
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // 10. privacy setters are no-ops when not ready
  // -------------------------------------------------------------------------

  describe("privacy setters are no-ops when not ready", () => {
    it("setProfileVisibility() does not throw when bridge is not ready", () => {
      expect(() => setProfileVisibility("everyone")).not.toThrow();
    });

    it("setFriendRequestsFrom() does not throw when bridge is not ready", () => {
      expect(() => setFriendRequestsFrom("nobody")).not.toThrow();
    });

    it("setProfileVisibility() delegates when bridge is ready", () => {
      const mock = createMockProtocol();
      initBridge(asFriendzProtocol(mock));

      setProfileVisibility("friends");
      expect(mock.setProfileVisibility).toHaveBeenCalledWith("friends");
    });

    it("setFriendRequestsFrom() delegates when bridge is ready", () => {
      const mock = createMockProtocol();
      initBridge(asFriendzProtocol(mock));

      setFriendRequestsFrom("everyone");
      expect(mock.setFriendRequestsFrom).toHaveBeenCalledWith("everyone");
    });
  });
});
