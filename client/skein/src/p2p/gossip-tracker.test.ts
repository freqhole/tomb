// ---------------------------------------------------------------------------
// unit tests for GossipTracker
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from "vitest";
import { GossipTracker, type GossipEntry } from "./gossip-tracker";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeId(prefix: string): string {
  return prefix + "0".repeat(64 - prefix.length);
}

const canvasA = makeId("canvas-a-");
const canvasB = makeId("canvas-b-");
const canvasC = makeId("canvas-c-");

const nodeA = makeId("node-a-");
const nodeB = makeId("node-b-");
const nodeC = makeId("node-c-");
const nodeD = makeId("node-d-");

const originNode = makeId("origin-");

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("GossipTracker", () => {
  describe("track()", () => {
    it("creates a new entry", () => {
      const tracker = new GossipTracker();

      tracker.track("inv-1", canvasA, "my canvas", originNode, "alice", "editor", [nodeA, nodeB], []);

      expect(tracker.has(canvasA)).toBe(true);
      expect(tracker.size).toBe(1);

      const entry = tracker.get(canvasA);
      expect(entry).toBeDefined();
      expect(entry!.inviteId).toBe("inv-1");
      expect(entry!.canvasDocId).toBe(canvasA);
      expect(entry!.canvasTitle).toBe("my canvas");
      expect(entry!.originNodeId).toBe(originNode);
      expect(entry!.originUsername).toBe("alice");
      expect(entry!.role).toBe("editor");
      expect(entry!.targets).toEqual(new Set([nodeA, nodeB]));
      expect(entry!.acked).toEqual(new Set());
    });

    it("merges targets and acked when same canvasDocId tracked twice", () => {
      const tracker = new GossipTracker();

      tracker.track("inv-1", canvasA, "my canvas", originNode, "alice", "editor", [nodeA, nodeB], []);
      tracker.track("inv-1", canvasA, "my canvas", originNode, "alice", "editor", [nodeB, nodeC], [nodeA]);

      expect(tracker.size).toBe(1);

      const entry = tracker.get(canvasA)!;
      expect(entry.targets).toEqual(new Set([nodeA, nodeB, nodeC]));
      expect(entry.acked).toEqual(new Set([nodeA]));
    });
  });

  describe("markAcked()", () => {
    it("marks target and returns true for new ack", () => {
      const tracker = new GossipTracker();
      tracker.track("inv-1", canvasA, "my canvas", originNode, "alice", "editor", [nodeA, nodeB], []);

      const first = tracker.markAcked(canvasA, nodeA);
      expect(first).toBe(true);

      const second = tracker.markAcked(canvasA, nodeA);
      expect(second).toBe(false);
    });

    it("auto-removes fully-acked entries", () => {
      const tracker = new GossipTracker();
      tracker.track("inv-1", canvasA, "my canvas", originNode, "alice", "editor", [nodeA, nodeB], []);

      tracker.markAcked(canvasA, nodeA);
      expect(tracker.has(canvasA)).toBe(true);

      tracker.markAcked(canvasA, nodeB);
      expect(tracker.has(canvasA)).toBe(false);
      expect(tracker.size).toBe(0);
    });

    it("returns false for unknown canvasDocId", () => {
      const tracker = new GossipTracker();

      const result = tracker.markAcked(canvasA, nodeA);
      expect(result).toBe(false);
    });
  });

  describe("entriesForPeer()", () => {
    it("returns entries with un-acked target matching peer", () => {
      const tracker = new GossipTracker();
      tracker.track("inv-1", canvasA, "canvas a", originNode, "alice", "editor", [nodeA, nodeB], []);
      tracker.track("inv-2", canvasB, "canvas b", originNode, "alice", "viewer", [nodeC, nodeD], []);

      const entries = tracker.entriesForPeer(nodeA);
      expect(entries).toHaveLength(1);
      expect(entries[0].canvasDocId).toBe(canvasA);
    });

    it("excludes entries where peer already acked", () => {
      const tracker = new GossipTracker();
      tracker.track("inv-1", canvasA, "canvas a", originNode, "alice", "editor", [nodeA, nodeB], [nodeA]);

      const entries = tracker.entriesForPeer(nodeA);
      expect(entries).toHaveLength(0);
    });

    it("returns multiple entries when peer is un-acked target in several", () => {
      const tracker = new GossipTracker();
      tracker.track("inv-1", canvasA, "canvas a", originNode, "alice", "editor", [nodeA, nodeB], []);
      tracker.track("inv-2", canvasB, "canvas b", originNode, "alice", "viewer", [nodeA, nodeC], []);

      const entries = tracker.entriesForPeer(nodeA);
      expect(entries).toHaveLength(2);
    });
  });

  describe("allEntries()", () => {
    it("returns all entries", () => {
      const tracker = new GossipTracker();
      tracker.track("inv-1", canvasA, "canvas a", originNode, "alice", "editor", [nodeA], []);
      tracker.track("inv-2", canvasB, "canvas b", originNode, "alice", "viewer", [nodeB], []);
      tracker.track("inv-3", canvasC, "canvas c", originNode, "alice", "editor", [nodeC], []);

      const entries = tracker.allEntries();
      expect(entries).toHaveLength(3);

      const ids = entries.map((e) => e.canvasDocId);
      expect(ids).toContain(canvasA);
      expect(ids).toContain(canvasB);
      expect(ids).toContain(canvasC);
    });

    it("returns empty array when nothing is tracked", () => {
      const tracker = new GossipTracker();
      expect(tracker.allEntries()).toEqual([]);
    });
  });

  describe("get() and has()", () => {
    it("returns the entry when it exists", () => {
      const tracker = new GossipTracker();
      tracker.track("inv-1", canvasA, "canvas a", originNode, "alice", "editor", [nodeA], []);

      expect(tracker.has(canvasA)).toBe(true);
      expect(tracker.get(canvasA)).toBeDefined();
      expect(tracker.get(canvasA)!.inviteId).toBe("inv-1");
    });

    it("returns undefined / false when entry does not exist", () => {
      const tracker = new GossipTracker();

      expect(tracker.has(canvasA)).toBe(false);
      expect(tracker.get(canvasA)).toBeUndefined();
    });
  });

  describe("remove()", () => {
    it("removes an existing entry and returns true", () => {
      const tracker = new GossipTracker();
      tracker.track("inv-1", canvasA, "canvas a", originNode, "alice", "editor", [nodeA], []);

      const result = tracker.remove(canvasA);
      expect(result).toBe(true);
      expect(tracker.has(canvasA)).toBe(false);
      expect(tracker.size).toBe(0);
    });

    it("returns false when entry does not exist", () => {
      const tracker = new GossipTracker();

      const result = tracker.remove(canvasA);
      expect(result).toBe(false);
    });
  });

  describe("removeMany()", () => {
    it("removes multiple entries at once", () => {
      const tracker = new GossipTracker();
      tracker.track("inv-1", canvasA, "canvas a", originNode, "alice", "editor", [nodeA], []);
      tracker.track("inv-2", canvasB, "canvas b", originNode, "alice", "viewer", [nodeB], []);
      tracker.track("inv-3", canvasC, "canvas c", originNode, "alice", "editor", [nodeC], []);

      tracker.removeMany([canvasA, canvasC]);

      expect(tracker.has(canvasA)).toBe(false);
      expect(tracker.has(canvasB)).toBe(true);
      expect(tracker.has(canvasC)).toBe(false);
      expect(tracker.size).toBe(1);
    });

    it("silently ignores ids that don't exist", () => {
      const tracker = new GossipTracker();
      tracker.track("inv-1", canvasA, "canvas a", originNode, "alice", "editor", [nodeA], []);

      tracker.removeMany([canvasB, canvasC]);
      expect(tracker.size).toBe(1);
    });
  });

  describe("getAckedList()", () => {
    it("returns acked set as an array", () => {
      const tracker = new GossipTracker();
      tracker.track("inv-1", canvasA, "canvas a", originNode, "alice", "editor", [nodeA, nodeB, nodeC], []);

      tracker.markAcked(canvasA, nodeA);

      const acked = tracker.getAckedList(canvasA);
      expect(acked).toEqual([nodeA]);
    });

    it("returns empty array for unknown canvasDocId", () => {
      const tracker = new GossipTracker();

      const acked = tracker.getAckedList(canvasA);
      expect(acked).toEqual([]);
    });

    it("returns empty array when nothing has been acked", () => {
      const tracker = new GossipTracker();
      tracker.track("inv-1", canvasA, "canvas a", originNode, "alice", "editor", [nodeA], []);

      const acked = tracker.getAckedList(canvasA);
      expect(acked).toEqual([]);
    });
  });

  describe("clear()", () => {
    it("clears all entries", () => {
      const tracker = new GossipTracker();
      tracker.track("inv-1", canvasA, "canvas a", originNode, "alice", "editor", [nodeA], []);
      tracker.track("inv-2", canvasB, "canvas b", originNode, "alice", "viewer", [nodeB], []);

      expect(tracker.size).toBe(2);

      tracker.clear();

      expect(tracker.size).toBe(0);
      expect(tracker.has(canvasA)).toBe(false);
      expect(tracker.has(canvasB)).toBe(false);
      expect(tracker.allEntries()).toEqual([]);
    });
  });

  describe("size", () => {
    it("reflects correct count as entries are added and removed", () => {
      const tracker = new GossipTracker();
      expect(tracker.size).toBe(0);

      tracker.track("inv-1", canvasA, "canvas a", originNode, "alice", "editor", [nodeA], []);
      expect(tracker.size).toBe(1);

      tracker.track("inv-2", canvasB, "canvas b", originNode, "alice", "viewer", [nodeB], []);
      expect(tracker.size).toBe(2);

      tracker.remove(canvasA);
      expect(tracker.size).toBe(1);

      tracker.clear();
      expect(tracker.size).toBe(0);
    });

    it("decreases when auto-remove fires on full ack", () => {
      const tracker = new GossipTracker();
      tracker.track("inv-1", canvasA, "canvas a", originNode, "alice", "editor", [nodeA], []);
      tracker.track("inv-2", canvasB, "canvas b", originNode, "alice", "viewer", [nodeB], []);
      expect(tracker.size).toBe(2);

      tracker.markAcked(canvasA, nodeA);
      expect(tracker.size).toBe(1);
    });
  });
});
