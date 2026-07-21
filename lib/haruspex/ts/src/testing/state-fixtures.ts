// fixture builders for state-module types: friend directory entries,
// pending/saved remotes, and endpoint adapters - deterministic test data
// for exercising peer-directory and remote-management logic.

import { vi } from "vitest";

import type { EndpointAdapter, EndpointState } from "../state/endpoint-control.js";
import type { FriendDirectoryEntry } from "../state/friend-directory.js";

/** saved remote, as apps persist them after a successful connection. */
export interface SavedRemote {
  remote_id: string;
  name: string;
  base_url?: string;
  peer_addr: string;
}

/** pending remote record (staged during add-peer flow, not yet promoted to
 *  a saved remote). */
export interface PendingRemote {
  id: string;
  peer_addr: string;
  stage: string;
  error_message?: string;
  server_name?: string;
  transport?: "wasm" | "http";
}

/** creates a friend directory entry with deterministic defaults. */
export function makeFriendDirectoryEntry(
  overrides: Partial<FriendDirectoryEntry> = {},
): FriendDirectoryEntry {
  return {
    username: "alice",
    nodeIds: [{ nodeId: "ab".repeat(32), profileDocId: "doc-1" }],
    ...overrides,
  };
}

/** creates a batch of distinct friend directory entries with unique
 *  usernames and node ids. */
export function makeFriendDirectoryEntries(count: number): FriendDirectoryEntry[] {
  return Array.from({ length: count }, (_, i) => {
    const username = `user-${i}`;
    const nodeId = `node-${i.toString().padStart(2, "0")}`.padEnd(64, "0");
    return makeFriendDirectoryEntry({
      username,
      nodeIds: [{ nodeId, profileDocId: `doc-${i}` }],
    });
  });
}

/** creates a saved remote with deterministic defaults. */
export function makeSavedRemote(overrides: Partial<SavedRemote> = {}): SavedRemote {
  return {
    remote_id: `r-${Math.random().toString(36).slice(2, 7)}`,
    name: "hub",
    peer_addr: "cd".repeat(32),
    ...overrides,
  };
}

/** creates a pending remote record with deterministic defaults. */
export function makePendingRemote(overrides: Partial<PendingRemote> = {}): PendingRemote {
  return {
    id: `p-${Math.random().toString(36).slice(2, 7)}`,
    peer_addr: "ef".repeat(32),
    stage: "testing",
    ...overrides,
  };
}

/** creates a scriptable `EndpointAdapter` double - every method is a
 *  `vi.fn()`, and state-change listeners are managed in-memory so tests
 *  can drive state transitions by hand. */
export function createFakeEndpointAdapter(initial: EndpointState = "online"): EndpointAdapter {
  let state = initial;
  const handlers = new Set<(state: EndpointState) => void>();

  const adapter: EndpointAdapter = {
    stop: vi.fn(() => {
      state = "off";
      for (const h of handlers) h(state);
    }),
    restart: vi.fn(async () => {
      state = "online";
      for (const h of handlers) h(state);
    }),
    getEndpointState: () => state,
    onEndpointStateChange: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };

  return adapter;
}
