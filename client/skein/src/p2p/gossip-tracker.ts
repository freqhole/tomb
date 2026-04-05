// ---------------------------------------------------------------------------
// gossip tracker — in-memory tracker for canvas invite gossip relay
//
// when we send or receive a canvas invite, we pick up shared responsibility
// for making sure all targets eventually receive it. the tracker keeps
// an in-memory map of pending invites and which targets have ACK'd.
// on each heartbeat tick (or when a peer comes online), the caller checks
// the tracker for un-ACK'd targets and relays the invite to them.
//
// the tracker is reconstructed from outbox + inbox on boot.
// ---------------------------------------------------------------------------

const TAG = "[skein:gossip]";

export interface GossipEntry {
  inviteId: string;
  canvasDocId: string;
  canvasTitle: string;
  originNodeId: string;
  originUsername: string;
  role: "editor" | "viewer";
  targets: Set<string>;
  acked: Set<string>;
}

export class GossipTracker {
  private entries = new Map<string, GossipEntry>(); // keyed by canvasDocId

  /**
   * start tracking a canvas invite for gossip relay.
   * if we're already tracking this canvas, merge the targets and acked sets.
   */
  track(
    inviteId: string,
    canvasDocId: string,
    canvasTitle: string,
    originNodeId: string,
    originUsername: string,
    role: "editor" | "viewer",
    targets: string[],
    acked: string[],
  ): void {
    const existing = this.entries.get(canvasDocId);
    if (existing) {
      // merge: add any new targets we didn't know about
      for (const t of targets) existing.targets.add(t);
      // merge: add any acked peers we didn't know about
      for (const a of acked) existing.acked.add(a);
      return;
    }
    this.entries.set(canvasDocId, {
      inviteId,
      canvasDocId,
      canvasTitle,
      originNodeId,
      originUsername,
      role,
      targets: new Set(targets),
      acked: new Set(acked),
    });
    console.log(TAG, "tracking invite for:", canvasDocId.slice(0, 16) + "...",
      "targets:", targets.length, "acked:", acked.length);
  }

  /**
   * mark a target as having ACK'd for a canvas invite.
   * returns true if this was a new ack (the target wasn't already marked).
   */
  markAcked(canvasDocId: string, nodeId: string): boolean {
    const entry = this.entries.get(canvasDocId);
    if (!entry) return false;
    if (entry.acked.has(nodeId)) return false;
    entry.acked.add(nodeId);
    console.log(TAG, "marked acked:", nodeId.slice(0, 16) + "...",
      "for:", canvasDocId.slice(0, 16) + "...",
      "(" + entry.acked.size + "/" + entry.targets.size + ")");
    // auto-remove fully-acked entries
    if (this.isFullyAcked(entry)) {
      console.log(TAG, "all targets acked for:", canvasDocId.slice(0, 16) + "...", "— removing");
      this.entries.delete(canvasDocId);
    }
    return true;
  }

  /**
   * get all gossip entries that have un-ACK'd targets for a specific peer.
   * used to determine what to relay when a peer comes online.
   */
  entriesForPeer(peerNodeId: string): GossipEntry[] {
    const result: GossipEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.targets.has(peerNodeId) && !entry.acked.has(peerNodeId)) {
        result.push(entry);
      }
    }
    return result;
  }

  /**
   * get all entries (for iterating during heartbeat).
   */
  allEntries(): GossipEntry[] {
    return [...this.entries.values()];
  }

  /**
   * check if we're tracking a specific canvas doc.
   */
  has(canvasDocId: string): boolean {
    return this.entries.has(canvasDocId);
  }

  /**
   * get the entry for a specific canvas doc, if tracked.
   */
  get(canvasDocId: string): GossipEntry | undefined {
    return this.entries.get(canvasDocId);
  }

  /**
   * remove a gossip entry (e.g., on cleanup).
   */
  remove(canvasDocId: string): boolean {
    return this.entries.delete(canvasDocId);
  }

  /**
   * remove all entries older than a given age. since the tracker is in-memory
   * and doesn't store timestamps, this is called with a list of canvasDocIds
   * to clean up (determined by the caller from the inbox/outbox docs).
   */
  removeMany(canvasDocIds: string[]): void {
    for (const id of canvasDocIds) {
      this.entries.delete(id);
    }
  }

  /**
   * get the current acked set as an array for a canvas doc.
   * useful for including in outgoing invite messages.
   */
  getAckedList(canvasDocId: string): string[] {
    const entry = this.entries.get(canvasDocId);
    return entry ? [...entry.acked] : [];
  }

  /** number of tracked entries. */
  get size(): number {
    return this.entries.size;
  }

  /** clear all entries. */
  clear(): void {
    this.entries.clear();
  }

  private isFullyAcked(entry: GossipEntry): boolean {
    for (const target of entry.targets) {
      if (!entry.acked.has(target)) return false;
    }
    return true;
  }
}
