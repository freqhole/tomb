// ---------------------------------------------------------------------------
// unit tests for FriendzProtocol
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeMessage,
  encodeMessage,
  FriendzProtocol,
  HEARTBEAT_TIMEOUT_MS,
  type AclChangeMessage,
  type CanvasInviteAcceptMessage,
  type CanvasInviteAckMessage,
  type CanvasInviteDeclineMessage,
  type CanvasInviteMessage,
  type FriendAcceptAckMessage,
  type FriendRequestMessage,
  type FriendzMessage,
  type FriendzProtocolOptions,
  type HeartbeatMessage,
  type ProfileResponseMessage,
} from "./friends-protocol";
import type { BiStreamLike, MiddenStreamNode } from "./iroh-network-adapter";
import { FRIENDZ_ALPN } from "./iroh-network-adapter";

// ---------------------------------------------------------------------------
// mock helpers
// ---------------------------------------------------------------------------

function createMockBiStream(peerId: string, alpn: string = FRIENDZ_ALPN) {
  const stream = {
    _messageQueue: [] as (Uint8Array | null)[],
    _written: [] as Uint8Array[],
    _closed: false,
    _readResolvers: [] as ((value: Uint8Array | null) => void)[],

    peer_node_id: () => peerId,
    alpn: () => alpn,

    write_message: vi.fn(async (data: Uint8Array) => {
      stream._written.push(data);
    }),

    read_message: vi.fn(async (): Promise<Uint8Array | null> => {
      if (stream._messageQueue.length > 0) {
        return stream._messageQueue.shift()!;
      }
      return new Promise<Uint8Array | null>((resolve) => {
        stream._readResolvers.push(resolve);
      });
    }),

    close: vi.fn(() => {
      stream._closed = true;
      for (const resolve of stream._readResolvers) {
        resolve(null);
      }
      stream._readResolvers = [];
    }),

    pushMessage(data: Uint8Array | null) {
      if (stream._readResolvers.length > 0) {
        stream._readResolvers.shift()!(data);
      } else {
        stream._messageQueue.push(data);
      }
    },
  };
  return stream;
}

type MockBiStream = ReturnType<typeof createMockBiStream>;

function createMockMidden(nodeId: string = "a".repeat(64)) {
  const midden = {
    node_id: () => nodeId,
    open_bi: vi.fn(async (_addr: string, _alpn: string) => {
      return createMockBiStream(_addr, _alpn);
    }),
    accept: vi.fn(async () => null),
  };
  return midden;
}

type MockMidden = ReturnType<typeof createMockMidden>;

function flush(ms = 20): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function defaultOptions(overrides: Partial<FriendzProtocolOptions> = {}): FriendzProtocolOptions {
  return {
    getMidden: async () => createMockMidden() as unknown as MiddenStreamNode,
    localNodeId: "a".repeat(64),
    localUsername: "alice",
    getLocalProfile: () => ({ username: "alice", bio: "hi there", avatarDataUrl: "" }),
    isFriend: () => false,
    profileVisibility: "friends",
    friendRequestsFrom: "everyone",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("encodeMessage / decodeMessage", () => {
  it("roundtrips a friend-request message", () => {
    const msg: FriendzMessage = {
      type: "friend-request",
      fromNodeId: "b".repeat(64),
      fromUsername: "bob",
    };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded);
    expect(decoded).toEqual(msg);
  });

  it("roundtrips a profile-response message", () => {
    const msg: FriendzMessage = {
      type: "profile-response",
      username: "alice",
      bio: "hello",
      avatarDataUrl: "data:image/png;base64,abc",
    };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded);
    expect(decoded).toEqual(msg);
  });

  it("roundtrips a heartbeat message", () => {
    const msg: FriendzMessage = {
      type: "heartbeat",
      nodeId: "c".repeat(64),
      username: "charlie",
    };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded);
    expect(decoded).toEqual(msg);
  });

  it("roundtrips a profile-request message", () => {
    const msg: FriendzMessage = { type: "profile-request" };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded);
    expect(decoded).toEqual(msg);
  });

  it("roundtrips a friend-accept message", () => {
    const msg: FriendzMessage = {
      type: "friend-accept",
      fromNodeId: "d".repeat(64),
      fromUsername: "dave",
    };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded);
    expect(decoded).toEqual(msg);
  });

  it("roundtrips a friend-reject message", () => {
    const msg: FriendzMessage = {
      type: "friend-reject",
      fromNodeId: "e".repeat(64),
    };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded);
    expect(decoded).toEqual(msg);
  });

  it("roundtrips a friend-accept-ack message", () => {
    const msg: FriendzMessage = {
      type: "friend-accept-ack",
      fromNodeId: "a".repeat(64),
    };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded);
    expect(decoded).toEqual(msg);
  });

  it("roundtrips a canvas-invite message", () => {
    const msg: FriendzMessage = {
      type: "canvas-invite",
      inviteId: "inv-123",
      canvasDocId: "doc-456",
      canvasTitle: "my canvas",
      canvasDescription: "a test canvas",
      canvasColor: 0xd946ef,
      canvasPreviewUrl: "data:image/png;base64,abc123",
      originNodeId: "a".repeat(64),
      originUsername: "alice",
      role: "editor",
      targets: ["b".repeat(64), "c".repeat(64)],
      acked: ["b".repeat(64)],
    };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded);
    expect(decoded).toEqual(msg);
    expect((decoded as any).canvasDescription).toBe("a test canvas");
    expect((decoded as any).canvasColor).toBe(0xd946ef);
    expect((decoded as any).canvasPreviewUrl).toBe("data:image/png;base64,abc123");
  });

  it("roundtrips a canvas-invite-ack message", () => {
    const msg: FriendzMessage = {
      type: "canvas-invite-ack",
      inviteId: "inv-123",
      canvasDocId: "doc-456",
      ackerNodeId: "b".repeat(64),
    };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded);
    expect(decoded).toEqual(msg);
  });

  it("roundtrips a canvas-invite-accept message", () => {
    const msg: FriendzMessage = {
      type: "canvas-invite-accept",
      inviteId: "inv-123",
      canvasDocId: "doc-456",
      accepterNodeId: "b".repeat(64),
    };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded);
    expect(decoded).toEqual(msg);
  });

  it("roundtrips a canvas-invite-decline message", () => {
    const msg: FriendzMessage = {
      type: "canvas-invite-decline",
      inviteId: "inv-123",
      canvasDocId: "doc-456",
      declinerNodeId: "b".repeat(64),
    };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded);
    expect(decoded).toEqual(msg);
  });

  it("roundtrips an acl-change message", () => {
    const msg: FriendzMessage = {
      type: "acl-change",
      canvasDocId: "doc-456",
      canvasTitle: "my canvas",
      targetNodeId: "b".repeat(64),
      newRole: "editor",
      changedBy: "a".repeat(64),
      changedByUsername: "alice",
    };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded);
    expect(decoded).toEqual(msg);
  });
});

describe("FriendzProtocol", () => {
  let protocol: FriendzProtocol;
  let mockMidden: MockMidden;

  beforeEach(() => {
    mockMidden = createMockMidden();
    protocol = new FriendzProtocol(
      defaultOptions({
        getMidden: async () => mockMidden as unknown as MiddenStreamNode,
      })
    );
  });

  afterEach(() => {
    protocol.destroy();
  });

  describe("handleStream()", () => {
    it("handles incoming friend-request and fires callback", async () => {
      const requests: Array<{ msg: FriendRequestMessage; from: string }> = [];
      protocol.onFriendRequest = (msg, from) => requests.push({ msg, from });

      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      protocol.handleStream(stream as unknown as BiStreamLike);

      const msg: FriendzMessage = {
        type: "friend-request",
        fromNodeId: peerId,
        fromUsername: "bob",
      };
      stream.pushMessage(encodeMessage(msg));
      await flush();

      expect(requests).toHaveLength(1);
      expect(requests[0].msg.fromUsername).toBe("bob");
      expect(requests[0].from).toBe(peerId);
    });

    it("handles incoming friend-accept and fires callback", async () => {
      const accepts: Array<{ from: string }> = [];
      protocol.onFriendAccept = (_msg, from) => accepts.push({ from });

      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      protocol.handleStream(stream as unknown as BiStreamLike);

      const msg: FriendzMessage = {
        type: "friend-accept",
        fromNodeId: peerId,
        fromUsername: "bob",
      };
      stream.pushMessage(encodeMessage(msg));
      await flush();

      expect(accepts).toHaveLength(1);
      expect(accepts[0].from).toBe(peerId);
    });

    it("handles incoming friend-reject and fires callback", async () => {
      const rejects: Array<{ from: string }> = [];
      protocol.onFriendReject = (_msg, from) => rejects.push({ from });

      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      protocol.handleStream(stream as unknown as BiStreamLike);

      const msg: FriendzMessage = {
        type: "friend-reject",
        fromNodeId: peerId,
      };
      stream.pushMessage(encodeMessage(msg));
      await flush();

      expect(rejects).toHaveLength(1);
      expect(rejects[0].from).toBe(peerId);
    });

    it("handles incoming heartbeat and updates lastSeen", async () => {
      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      protocol.handleStream(stream as unknown as BiStreamLike);

      expect(protocol.isOnline(peerId)).toBe(false);

      const msg: FriendzMessage = {
        type: "heartbeat",
        nodeId: peerId,
        username: "bob",
      };
      stream.pushMessage(encodeMessage(msg));
      await flush();

      expect(protocol.isOnline(peerId)).toBe(true);
    });

    it("cleans up stream reference when stream closes", async () => {
      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      protocol.handleStream(stream as unknown as BiStreamLike);
      await flush();

      // close the stream
      stream.pushMessage(null);
      await flush();

      // the protocol should have cleaned up
      expect(protocol.getOnlinePeers()).toEqual([]);
    });

    it("replaces existing stream for same peer", async () => {
      const peerId = "b".repeat(64);
      const stream1 = createMockBiStream(peerId);
      const stream2 = createMockBiStream(peerId);

      protocol.handleStream(stream1 as unknown as BiStreamLike);
      await flush();

      protocol.handleStream(stream2 as unknown as BiStreamLike);
      await flush();

      expect(stream1.close).toHaveBeenCalled();
    });
  });

  describe("profile request handling", () => {
    it("responds to profile-request from friend when visibility is 'friends'", async () => {
      const friendId = "b".repeat(64);
      const friendlyProtocol = new FriendzProtocol(
        defaultOptions({
          getMidden: async () => mockMidden as unknown as MiddenStreamNode,
          isFriend: (nodeId) => nodeId === friendId,
          profileVisibility: "friends",
        })
      );

      const stream = createMockBiStream(friendId);
      friendlyProtocol.handleStream(stream as unknown as BiStreamLike);

      const msg: FriendzMessage = { type: "profile-request" };
      stream.pushMessage(encodeMessage(msg));
      await flush();

      expect(stream.write_message).toHaveBeenCalled();
      const written = stream._written[0];
      const response = decodeMessage(written);
      expect(response.type).toBe("profile-response");
      expect((response as ProfileResponseMessage).username).toBe("alice");

      friendlyProtocol.destroy();
    });

    it("ignores profile-request from non-friend when visibility is 'friends'", async () => {
      const strangerId = "c".repeat(64);
      const stream = createMockBiStream(strangerId);
      protocol.handleStream(stream as unknown as BiStreamLike);

      const msg: FriendzMessage = { type: "profile-request" };
      stream.pushMessage(encodeMessage(msg));
      await flush();

      // no response should be written
      expect(stream._written).toHaveLength(0);
    });

    it("responds to profile-request from anyone when visibility is 'everyone'", async () => {
      const openProtocol = new FriendzProtocol(
        defaultOptions({
          getMidden: async () => mockMidden as unknown as MiddenStreamNode,
          profileVisibility: "everyone",
        })
      );

      const strangerId = "c".repeat(64);
      const stream = createMockBiStream(strangerId);
      openProtocol.handleStream(stream as unknown as BiStreamLike);

      const msg: FriendzMessage = { type: "profile-request" };
      stream.pushMessage(encodeMessage(msg));
      await flush();

      expect(stream._written).toHaveLength(1);
      const response = decodeMessage(stream._written[0]);
      expect(response.type).toBe("profile-response");

      openProtocol.destroy();
    });

    it("ignores all profile-requests when visibility is 'nobody'", async () => {
      const privateProtocol = new FriendzProtocol(
        defaultOptions({
          getMidden: async () => mockMidden as unknown as MiddenStreamNode,
          profileVisibility: "nobody",
        })
      );

      const friendId = "b".repeat(64);
      const stream = createMockBiStream(friendId);
      privateProtocol.handleStream(stream as unknown as BiStreamLike);

      const msg: FriendzMessage = { type: "profile-request" };
      stream.pushMessage(encodeMessage(msg));
      await flush();

      expect(stream._written).toHaveLength(0);

      privateProtocol.destroy();
    });
  });

  describe("friend request privacy", () => {
    it("ignores friend requests when friendRequestsFrom is 'nobody'", async () => {
      const closedProtocol = new FriendzProtocol(
        defaultOptions({
          getMidden: async () => mockMidden as unknown as MiddenStreamNode,
          friendRequestsFrom: "nobody",
        })
      );

      const requests: Array<{ from: string }> = [];
      closedProtocol.onFriendRequest = (_msg, from) => requests.push({ from });

      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      closedProtocol.handleStream(stream as unknown as BiStreamLike);

      const msg: FriendzMessage = {
        type: "friend-request",
        fromNodeId: peerId,
        fromUsername: "bob",
      };
      stream.pushMessage(encodeMessage(msg));
      await flush();

      expect(requests).toHaveLength(0);

      closedProtocol.destroy();
    });
  });

  describe("canvas invite handling", () => {
    it("handles incoming canvas-invite and fires callback", async () => {
      const invites: Array<{ msg: CanvasInviteMessage; from: string }> = [];
      protocol.onCanvasInvite = (msg, from) => invites.push({ msg, from });

      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      protocol.handleStream(stream as unknown as BiStreamLike);

      const msg: FriendzMessage = {
        type: "canvas-invite",
        inviteId: "inv-1",
        canvasDocId: "doc-1",
        canvasTitle: "cool canvas",
        originNodeId: peerId,
        originUsername: "bob",
        role: "editor",
        targets: ["a".repeat(64)],
        acked: [],
      };
      stream.pushMessage(encodeMessage(msg));
      await flush();

      expect(invites).toHaveLength(1);
      expect(invites[0].msg.inviteId).toBe("inv-1");
      expect(invites[0].from).toBe(peerId);
    });

    it("blocks canvas-invite when canvasInvitesFrom is 'nobody'", async () => {
      const closedProtocol = new FriendzProtocol(
        defaultOptions({
          getMidden: async () => mockMidden as unknown as MiddenStreamNode,
          canvasInvitesFrom: "nobody",
        })
      );

      const invites: Array<{ from: string }> = [];
      closedProtocol.onCanvasInvite = (_msg, from) => invites.push({ from });

      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      closedProtocol.handleStream(stream as unknown as BiStreamLike);

      const msg: FriendzMessage = {
        type: "canvas-invite",
        inviteId: "inv-1",
        canvasDocId: "doc-1",
        canvasTitle: "cool canvas",
        originNodeId: peerId,
        originUsername: "bob",
        role: "editor",
        targets: ["a".repeat(64)],
        acked: [],
      };
      stream.pushMessage(encodeMessage(msg));
      await flush();

      expect(invites).toHaveLength(0);

      closedProtocol.destroy();
    });

    it("blocks canvas-invite from non-friend when canvasInvitesFrom is 'friends'", async () => {
      const friendsOnlyProtocol = new FriendzProtocol(
        defaultOptions({
          getMidden: async () => mockMidden as unknown as MiddenStreamNode,
          canvasInvitesFrom: "friends",
          isFriend: () => false,
        })
      );

      const invites: Array<{ from: string }> = [];
      friendsOnlyProtocol.onCanvasInvite = (_msg, from) => invites.push({ from });

      const strangerId = "c".repeat(64);
      const stream = createMockBiStream(strangerId);
      friendsOnlyProtocol.handleStream(stream as unknown as BiStreamLike);

      const msg: FriendzMessage = {
        type: "canvas-invite",
        inviteId: "inv-1",
        canvasDocId: "doc-1",
        canvasTitle: "cool canvas",
        originNodeId: strangerId,
        originUsername: "charlie",
        role: "viewer",
        targets: ["a".repeat(64)],
        acked: [],
      };
      stream.pushMessage(encodeMessage(msg));
      await flush();

      expect(invites).toHaveLength(0);

      friendsOnlyProtocol.destroy();
    });

    it("allows canvas-invite from friend when canvasInvitesFrom is 'friends'", async () => {
      const friendId = "b".repeat(64);
      const friendsOnlyProtocol = new FriendzProtocol(
        defaultOptions({
          getMidden: async () => mockMidden as unknown as MiddenStreamNode,
          canvasInvitesFrom: "friends",
          isFriend: (id) => id === friendId,
        })
      );

      const invites: Array<{ msg: CanvasInviteMessage; from: string }> = [];
      friendsOnlyProtocol.onCanvasInvite = (msg, from) => invites.push({ msg, from });

      const stream = createMockBiStream(friendId);
      friendsOnlyProtocol.handleStream(stream as unknown as BiStreamLike);

      const msg: FriendzMessage = {
        type: "canvas-invite",
        inviteId: "inv-1",
        canvasDocId: "doc-1",
        canvasTitle: "cool canvas",
        originNodeId: friendId,
        originUsername: "bob",
        role: "editor",
        targets: ["a".repeat(64)],
        acked: [],
      };
      stream.pushMessage(encodeMessage(msg));
      await flush();

      expect(invites).toHaveLength(1);
      expect(invites[0].from).toBe(friendId);

      friendsOnlyProtocol.destroy();
    });

    it("handles incoming canvas-invite-ack and fires callback", async () => {
      const acks: Array<{ msg: CanvasInviteAckMessage; from: string }> = [];
      protocol.onCanvasInviteAck = (msg, from) => acks.push({ msg, from });

      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      protocol.handleStream(stream as unknown as BiStreamLike);

      const msg: FriendzMessage = {
        type: "canvas-invite-ack",
        inviteId: "inv-1",
        canvasDocId: "doc-1",
        ackerNodeId: peerId,
      };
      stream.pushMessage(encodeMessage(msg));
      await flush();

      expect(acks).toHaveLength(1);
      expect(acks[0].msg.inviteId).toBe("inv-1");
      expect(acks[0].from).toBe(peerId);
    });

    it("handles incoming canvas-invite-accept and fires callback", async () => {
      const accepts: Array<{ msg: CanvasInviteAcceptMessage; from: string }> = [];
      protocol.onCanvasInviteAccept = (msg, from) => accepts.push({ msg, from });

      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      protocol.handleStream(stream as unknown as BiStreamLike);

      const msg: FriendzMessage = {
        type: "canvas-invite-accept",
        inviteId: "inv-1",
        canvasDocId: "doc-1",
        accepterNodeId: peerId,
      };
      stream.pushMessage(encodeMessage(msg));
      await flush();

      expect(accepts).toHaveLength(1);
      expect(accepts[0].msg.inviteId).toBe("inv-1");
      expect(accepts[0].from).toBe(peerId);
    });

    it("handles incoming canvas-invite-decline and fires callback", async () => {
      const declines: Array<{ msg: CanvasInviteDeclineMessage; from: string }> = [];
      protocol.onCanvasInviteDecline = (msg, from) => declines.push({ msg, from });

      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      protocol.handleStream(stream as unknown as BiStreamLike);

      const msg: FriendzMessage = {
        type: "canvas-invite-decline",
        inviteId: "inv-1",
        canvasDocId: "doc-1",
        declinerNodeId: peerId,
      };
      stream.pushMessage(encodeMessage(msg));
      await flush();

      expect(declines).toHaveLength(1);
      expect(declines[0].msg.inviteId).toBe("inv-1");
      expect(declines[0].from).toBe(peerId);
    });

    it("handles incoming acl-change and fires callback", async () => {
      const changes: Array<{ msg: AclChangeMessage; from: string }> = [];
      protocol.onAclChange = (msg, from) => changes.push({ msg, from });

      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      protocol.handleStream(stream as unknown as BiStreamLike);

      const msg: FriendzMessage = {
        type: "acl-change",
        canvasDocId: "doc-1",
        canvasTitle: "cool canvas",
        targetNodeId: "a".repeat(64),
        newRole: "viewer",
        changedBy: peerId,
        changedByUsername: "bob",
      };
      stream.pushMessage(encodeMessage(msg));
      await flush();

      expect(changes).toHaveLength(1);
      expect(changes[0].msg.newRole).toBe("viewer");
      expect(changes[0].from).toBe(peerId);
    });

    it("handles incoming friend-accept-ack and fires callback", async () => {
      const acks: Array<{ msg: FriendAcceptAckMessage; from: string }> = [];
      protocol.onFriendAcceptAck = (msg, from) => acks.push({ msg, from });

      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      protocol.handleStream(stream as unknown as BiStreamLike);

      const msg: FriendzMessage = {
        type: "friend-accept-ack",
        fromNodeId: peerId,
      };
      stream.pushMessage(encodeMessage(msg));
      await flush();

      expect(acks).toHaveLength(1);
      expect(acks[0].msg.fromNodeId).toBe(peerId);
      expect(acks[0].from).toBe(peerId);
    });
  });

  describe("canvas invite outbound", () => {
    it("sendCanvasInvite sends the correct message", async () => {
      const targetId = "b".repeat(64);
      await protocol.sendCanvasInvite(targetId, {
        inviteId: "inv-1",
        canvasDocId: "doc-1",
        canvasTitle: "cool canvas",
        originNodeId: "a".repeat(64),
        originUsername: "alice",
        role: "editor",
        targets: [targetId],
        acked: [],
      });

      expect(mockMidden.open_bi).toHaveBeenCalledWith(targetId, FRIENDZ_ALPN);

      const stream = await mockMidden.open_bi.mock.results[0].value;
      expect(stream._written).toHaveLength(1);
      const msg = JSON.parse(new TextDecoder().decode(stream._written[0]));
      expect(msg.type).toBe("canvas-invite");
      expect(msg.inviteId).toBe("inv-1");
      expect(msg.canvasDocId).toBe("doc-1");
      expect(msg.canvasTitle).toBe("cool canvas");
      expect(msg.role).toBe("editor");
    });

    it("sendCanvasInviteAck sends the correct message", async () => {
      const targetId = "b".repeat(64);
      await protocol.sendCanvasInviteAck(targetId, {
        inviteId: "inv-1",
        canvasDocId: "doc-1",
        ackerNodeId: "a".repeat(64),
      });

      expect(mockMidden.open_bi).toHaveBeenCalledWith(targetId, FRIENDZ_ALPN);

      const stream = await mockMidden.open_bi.mock.results[0].value;
      expect(stream._written).toHaveLength(1);
      const msg = JSON.parse(new TextDecoder().decode(stream._written[0]));
      expect(msg.type).toBe("canvas-invite-ack");
      expect(msg.inviteId).toBe("inv-1");
      expect(msg.ackerNodeId).toBe("a".repeat(64));
    });

    it("sendCanvasInviteAccept sends the correct message", async () => {
      const targetId = "b".repeat(64);
      await protocol.sendCanvasInviteAccept(targetId, {
        inviteId: "inv-1",
        canvasDocId: "doc-1",
        accepterNodeId: "a".repeat(64),
      });

      expect(mockMidden.open_bi).toHaveBeenCalledWith(targetId, FRIENDZ_ALPN);

      const stream = await mockMidden.open_bi.mock.results[0].value;
      expect(stream._written).toHaveLength(1);
      const msg = JSON.parse(new TextDecoder().decode(stream._written[0]));
      expect(msg.type).toBe("canvas-invite-accept");
      expect(msg.inviteId).toBe("inv-1");
      expect(msg.accepterNodeId).toBe("a".repeat(64));
    });

    it("sendCanvasInviteDecline sends the correct message", async () => {
      const targetId = "b".repeat(64);
      await protocol.sendCanvasInviteDecline(targetId, {
        inviteId: "inv-1",
        canvasDocId: "doc-1",
        declinerNodeId: "a".repeat(64),
      });

      expect(mockMidden.open_bi).toHaveBeenCalledWith(targetId, FRIENDZ_ALPN);

      const stream = await mockMidden.open_bi.mock.results[0].value;
      expect(stream._written).toHaveLength(1);
      const msg = JSON.parse(new TextDecoder().decode(stream._written[0]));
      expect(msg.type).toBe("canvas-invite-decline");
      expect(msg.inviteId).toBe("inv-1");
      expect(msg.declinerNodeId).toBe("a".repeat(64));
    });

    it("sendAclChange sends the correct message", async () => {
      const targetId = "b".repeat(64);
      await protocol.sendAclChange(targetId, {
        canvasDocId: "doc-1",
        canvasTitle: "cool canvas",
        targetNodeId: targetId,
        newRole: "removed",
        changedBy: "a".repeat(64),
        changedByUsername: "alice",
      });

      expect(mockMidden.open_bi).toHaveBeenCalledWith(targetId, FRIENDZ_ALPN);

      const stream = await mockMidden.open_bi.mock.results[0].value;
      expect(stream._written).toHaveLength(1);
      const msg = JSON.parse(new TextDecoder().decode(stream._written[0]));
      expect(msg.type).toBe("acl-change");
      expect(msg.canvasDocId).toBe("doc-1");
      expect(msg.newRole).toBe("removed");
      expect(msg.changedByUsername).toBe("alice");
    });

    it("sendFriendAcceptAck sends the correct message", async () => {
      const targetId = "b".repeat(64);
      await protocol.sendFriendAcceptAck(targetId);

      expect(mockMidden.open_bi).toHaveBeenCalledWith(targetId, FRIENDZ_ALPN);

      const stream = await mockMidden.open_bi.mock.results[0].value;
      expect(stream._written).toHaveLength(1);
      const msg = JSON.parse(new TextDecoder().decode(stream._written[0]));
      expect(msg.type).toBe("friend-accept-ack");
      expect(msg.fromNodeId).toBe("a".repeat(64));
    });
  });

  describe("outbound messages", () => {
    it("sendFriendRequest opens a stream and sends the message", async () => {
      const targetId = "b".repeat(64);
      await protocol.sendFriendRequest(targetId);

      expect(mockMidden.open_bi).toHaveBeenCalledWith(targetId, FRIENDZ_ALPN);

      // verify the message content
      const stream = await mockMidden.open_bi.mock.results[0].value;
      expect(stream._written).toHaveLength(1);
      const msg = JSON.parse(new TextDecoder().decode(stream._written[0]));
      expect(msg.type).toBe("friend-request");
      expect(msg.fromNodeId).toBe("a".repeat(64)); // localNodeId
      expect(msg.fromUsername).toBe("alice"); // localUsername
    });

    it("sendFriendAccept sends an accept message", async () => {
      const targetId = "b".repeat(64);
      await protocol.sendFriendAccept(targetId);

      expect(mockMidden.open_bi).toHaveBeenCalledWith(targetId, FRIENDZ_ALPN);

      const stream = await mockMidden.open_bi.mock.results[0].value;
      expect(stream._written).toHaveLength(1);
      const msg = JSON.parse(new TextDecoder().decode(stream._written[0]));
      expect(msg.type).toBe("friend-accept");
      expect(msg.fromNodeId).toBe("a".repeat(64));
      expect(msg.fromUsername).toBe("alice");
    });

    it("sendFriendReject sends a reject message", async () => {
      const targetId = "b".repeat(64);
      await protocol.sendFriendReject(targetId);

      expect(mockMidden.open_bi).toHaveBeenCalledWith(targetId, FRIENDZ_ALPN);

      const stream = await mockMidden.open_bi.mock.results[0].value;
      expect(stream._written).toHaveLength(1);
      const msg = JSON.parse(new TextDecoder().decode(stream._written[0]));
      expect(msg.type).toBe("friend-reject");
      expect(msg.fromNodeId).toBe("a".repeat(64));
    });

    it("requestProfile sends a profile-request message", async () => {
      const targetId = "b".repeat(64);
      await protocol.requestProfile(targetId);

      expect(mockMidden.open_bi).toHaveBeenCalledWith(targetId, FRIENDZ_ALPN);

      const stream = await mockMidden.open_bi.mock.results[0].value;
      expect(stream._written).toHaveLength(1);
      const msg = JSON.parse(new TextDecoder().decode(stream._written[0]));
      expect(msg.type).toBe("profile-request");
    });

    it("reuses existing stream for same peer", async () => {
      const targetId = "b".repeat(64);

      // provide a stream directly via handleStream
      const stream = createMockBiStream(targetId);
      protocol.handleStream(stream as unknown as BiStreamLike);
      await flush();

      // now send — should reuse the existing stream, not open a new one
      const msg: FriendzMessage = {
        type: "friend-request",
        fromNodeId: "a".repeat(64),
        fromUsername: "alice",
      };
      await protocol.sendFriendRequest(targetId);

      // open_bi should NOT have been called since we already had a stream
      expect(mockMidden.open_bi).not.toHaveBeenCalled();
      // but a message should have been written
      expect(stream._written.length).toBeGreaterThan(0);
    });
  });

  describe("online/offline status", () => {
    it("isOnline returns false for unknown peer", () => {
      expect(protocol.isOnline("b".repeat(64))).toBe(false);
    });

    it("isOnline returns true after receiving heartbeat", async () => {
      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      protocol.handleStream(stream as unknown as BiStreamLike);

      const msg: FriendzMessage = { type: "heartbeat", nodeId: peerId, username: "bob" };
      stream.pushMessage(encodeMessage(msg));
      await flush();

      expect(protocol.isOnline(peerId)).toBe(true);
    });

    it("isOnline returns false after timeout", async () => {
      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      protocol.handleStream(stream as unknown as BiStreamLike);

      const msg: FriendzMessage = { type: "heartbeat", nodeId: peerId, username: "bob" };
      stream.pushMessage(encodeMessage(msg));
      await flush();

      // manually set lastSeen to a time beyond the timeout
      // access private field for testing
      (protocol as any).lastSeen.set(peerId, Date.now() - HEARTBEAT_TIMEOUT_MS - 1);

      expect(protocol.isOnline(peerId)).toBe(false);
    });

    it("getOnlinePeers returns only peers within timeout", async () => {
      const peer1 = "b".repeat(64);
      const peer2 = "c".repeat(64);

      const stream1 = createMockBiStream(peer1);
      const stream2 = createMockBiStream(peer2);
      protocol.handleStream(stream1 as unknown as BiStreamLike);
      protocol.handleStream(stream2 as unknown as BiStreamLike);

      // peer1 heartbeat
      stream1.pushMessage(encodeMessage({ type: "heartbeat", nodeId: peer1, username: "bob" }));
      // peer2 heartbeat
      stream2.pushMessage(encodeMessage({ type: "heartbeat", nodeId: peer2, username: "charlie" }));
      await flush();

      expect(protocol.getOnlinePeers()).toContain(peer1);
      expect(protocol.getOnlinePeers()).toContain(peer2);

      // expire peer1
      (protocol as any).lastSeen.set(peer1, Date.now() - HEARTBEAT_TIMEOUT_MS - 1);

      const online = protocol.getOnlinePeers();
      expect(online).not.toContain(peer1);
      expect(online).toContain(peer2);
    });

    it("onOnlineChange fires when heartbeat received", async () => {
      const changes: number[] = [];
      protocol.onOnlineChange(() => changes.push(Date.now()));

      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      protocol.handleStream(stream as unknown as BiStreamLike);

      stream.pushMessage(encodeMessage({ type: "heartbeat", nodeId: peerId, username: "bob" }));
      await flush();

      expect(changes.length).toBeGreaterThan(0);
    });

    it("onOnlineChange unsubscribe works", async () => {
      const changes: number[] = [];
      const unsub = protocol.onOnlineChange(() => changes.push(Date.now()));
      unsub();

      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      protocol.handleStream(stream as unknown as BiStreamLike);

      stream.pushMessage(encodeMessage({ type: "heartbeat", nodeId: peerId, username: "bob" }));
      await flush();

      expect(changes).toHaveLength(0);
    });
  });

  describe("heartbeat sending", () => {
    it("startHeartbeat sends initial heartbeats to all friends", async () => {
      const friend1 = "b".repeat(64);
      const friend2 = "c".repeat(64);

      protocol.startHeartbeat(() => [friend1, friend2]);
      await flush(50);

      expect(mockMidden.open_bi).toHaveBeenCalledWith(friend1, FRIENDZ_ALPN);
      expect(mockMidden.open_bi).toHaveBeenCalledWith(friend2, FRIENDZ_ALPN);

      protocol.stopHeartbeat();
    });

    it("stopHeartbeat stops the interval", () => {
      protocol.startHeartbeat(() => ["b".repeat(64)]);
      protocol.stopHeartbeat();

      // no error — the timer was cleared
    });
  });

  describe("sendHeartbeatTo", () => {
    it("sendHeartbeatTo invalidates stale stream and sends heartbeat", async () => {
      const peerId = "peer-aaa".padEnd(64, "0");
      const stream = createMockBiStream(peerId);
      protocol.handleStream(stream as unknown as BiStreamLike);
      await flush();

      // verify the stream is registered (readLoop has started reading)
      expect(stream.read_message).toHaveBeenCalled();

      await protocol.sendHeartbeatTo(peerId);
      await flush();

      // the old stream should have been closed
      expect(stream._closed).toBe(true);

      // open_bi should have been called to create a fresh stream
      expect(mockMidden.open_bi).toHaveBeenCalledWith(peerId, FRIENDZ_ALPN);

      // check the message written to the new stream is a heartbeat
      const newStream = await mockMidden.open_bi.mock.results[0].value;
      expect(newStream._written).toHaveLength(1);
      const msg = JSON.parse(new TextDecoder().decode(newStream._written[0]));
      expect(msg.type).toBe("heartbeat");
      expect(msg.nodeId).toBe("a".repeat(64));
      expect(msg.username).toBe("alice");
    });

    it("sendHeartbeatTo works when no existing stream", async () => {
      const peerId = "peer-bbb".padEnd(64, "0");

      // do NOT handleStream — no existing stream for this peer
      await protocol.sendHeartbeatTo(peerId);
      await flush();

      // open_bi should have been called
      expect(mockMidden.open_bi).toHaveBeenCalledWith(peerId, FRIENDZ_ALPN);

      // a heartbeat should have been sent on the new stream
      const newStream = await mockMidden.open_bi.mock.results[0].value;
      expect(newStream._written).toHaveLength(1);
      const msg = JSON.parse(new TextDecoder().decode(newStream._written[0]));
      expect(msg.type).toBe("heartbeat");
    });

    it("readLoop error clears lastSeen and emits online change", async () => {
      const peerId = "peer-ccc".padEnd(64, "0");
      const stream = createMockBiStream(peerId);
      protocol.handleStream(stream as unknown as BiStreamLike);

      // deliver a heartbeat so the peer is considered online
      const hb: FriendzMessage = { type: "heartbeat", nodeId: peerId, username: "charlie" };
      stream.pushMessage(encodeMessage(hb));
      await flush();

      expect(protocol.isOnline(peerId)).toBe(true);

      // register an onOnlineChange listener to track calls
      const changeCalls: number[] = [];
      protocol.onOnlineChange(() => changeCalls.push(Date.now()));

      // simulate a stream read error by replacing read_message with a rejecting function.
      // the readLoop is currently awaiting the next read_message call, so we resolve
      // the pending reader with an error by overwriting and triggering it.
      // simplest approach: resolve the pending reader, then make the next read throw.
      // but we can also just reject the pending reader directly.
      // the mock has _readResolvers — there should be one waiting. we can't reject via
      // the resolve function, so instead we override read_message to reject, then
      // push a value to unblock the current awaiter (which will loop and call the new fn).

      // first, unblock the currently waiting read with a valid heartbeat (so the loop iterates)
      // but override read_message before that heartbeat is processed so the NEXT call rejects.
      stream.read_message = vi.fn(async () => {
        throw new Error("connection lost");
      });

      // resolve the currently pending reader to let the loop iterate
      // (the loop will process this data, then call read_message again which now throws)
      if (stream._readResolvers.length > 0) {
        const hb2: FriendzMessage = { type: "heartbeat", nodeId: peerId, username: "charlie" };
        stream._readResolvers.shift()!(encodeMessage(hb2));
      }
      await flush();

      // isOnline should now be false because the readLoop catch cleared lastSeen
      expect(protocol.isOnline(peerId)).toBe(false);

      // the onOnlineChange listener should have been called
      expect(changeCalls.length).toBeGreaterThan(0);
    });
  });

  describe("setters", () => {
    it("setLocalUsername updates the username", () => {
      protocol.setLocalUsername("new-name");
      expect((protocol as any).localUsername).toBe("new-name");
    });

    it("setLocalNodeId updates the node ID", () => {
      const newId = "f".repeat(64);
      protocol.setLocalNodeId(newId);
      expect((protocol as any).localNodeId).toBe(newId);
    });

    it("setProfileVisibility updates privacy setting", () => {
      protocol.setProfileVisibility("nobody");
      expect((protocol as any).profileVisibility).toBe("nobody");
    });

    it("setFriendRequestsFrom updates privacy setting", () => {
      protocol.setFriendRequestsFrom("nobody");
      expect((protocol as any).friendRequestsFrom).toBe("nobody");
    });
  });

  describe("destroy()", () => {
    it("closes all streams", () => {
      const stream1 = createMockBiStream("b".repeat(64));
      const stream2 = createMockBiStream("c".repeat(64));
      protocol.handleStream(stream1 as unknown as BiStreamLike);
      protocol.handleStream(stream2 as unknown as BiStreamLike);

      protocol.destroy();

      expect(stream1.close).toHaveBeenCalled();
      expect(stream2.close).toHaveBeenCalled();
    });

    it("stops heartbeat timer", () => {
      protocol.startHeartbeat(() => ["b".repeat(64)]);
      protocol.destroy();
      // no error — the timer was cleared
    });

    it("clears all event handlers", () => {
      protocol.onFriendRequest = () => {};
      protocol.onFriendAccept = () => {};
      protocol.onProfileResponse = () => {};
      protocol.onFriendAcceptAck = () => {};
      protocol.onCanvasInvite = () => {};
      protocol.onCanvasInviteAck = () => {};
      protocol.onCanvasInviteAccept = () => {};
      protocol.onCanvasInviteDecline = () => {};
      protocol.onAclChange = () => {};

      protocol.destroy();

      expect(protocol.onFriendRequest).toBeNull();
      expect(protocol.onFriendAccept).toBeNull();
      expect(protocol.onProfileResponse).toBeNull();
      expect(protocol.onFriendAcceptAck).toBeNull();
      expect(protocol.onCanvasInvite).toBeNull();
      expect(protocol.onCanvasInviteAck).toBeNull();
      expect(protocol.onCanvasInviteAccept).toBeNull();
      expect(protocol.onCanvasInviteDecline).toBeNull();
      expect(protocol.onAclChange).toBeNull();
    });
  });
});
