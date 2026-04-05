// ---------------------------------------------------------------------------
// p2p identity management for skein.
//
// manages the iroh keypair used for peer-to-peer connectivity. the identity
// is persisted in the skein-meta IndexedDB store so it survives page reloads.
//
// the midden WASM endpoint is lazily initialized — it only starts when
// something explicitly needs it (sharing a canvas, joining one, or the
// user clicking "generate" in the profile widget).
// ---------------------------------------------------------------------------

import { deleteMetaRecord, getMetaRecord, setMetaRecord } from "../storage/meta-db";
import { isTauriMode, TauriStreamNode } from "./tauri-transport";

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

/** the stored identity shape persisted in IndexedDB. */
export interface P2PIdentity {
  /** 32-byte iroh secret key. */
  secret_key: Uint8Array;
  /** public node_id (iroh public key as string). */
  node_id: string;
  /** unix epoch millis when the identity was first created. */
  created_at: number;
}

/**
 * minimal interface matching the subset of the midden WASM API we rely on.
 * kept local so skein doesn't need a build-time dependency on the full
 * midden type definitions.
 */
export interface MiddenNodeLike {
  node_id(): string;
  secret_key(): Uint8Array;
  // raw stream APIs (added for phase B — P2P sync)
  open_bi?(peer_addr: string, alpn: string): Promise<unknown>;
  accept?(): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

/** key used to store the identity record in the skein-meta IndexedDB. */
const IDENTITY_KEY = "p2p_identity";

/** console log prefix for this module. */
const TAG = "[skein:p2p]";

// ---------------------------------------------------------------------------
// module-level singleton state
// ---------------------------------------------------------------------------

let middenNode: MiddenNodeLike | null = null;
let middenNodePromise: Promise<MiddenNodeLike> | null = null;

// ---------------------------------------------------------------------------
// change subscription
// ---------------------------------------------------------------------------

type IdentityChangeCallback = (identity: P2PIdentity | null) => void;

const changeListeners = new Set<IdentityChangeCallback>();

/** notify all registered listeners of an identity change. */
function notifyListeners(identity: P2PIdentity | null): void {
  for (const cb of changeListeners) {
    try {
      cb(identity);
    } catch (err) {
      console.error(TAG, "identity change listener threw:", err);
    }
  }
}

/**
 * subscribe to identity changes (created or deleted).
 *
 * the callback fires whenever `ensureIdentity` creates a new identity or
 * `deleteIdentity` removes one. returns an unsubscribe function.
 */
export function onIdentityChange(callback: IdentityChangeCallback): () => void {
  changeListeners.add(callback);
  return () => {
    changeListeners.delete(callback);
  };
}

// ---------------------------------------------------------------------------
// read-only access (cheap, no midden startup)
// ---------------------------------------------------------------------------

/**
 * read the stored identity from IndexedDB.
 *
 * returns `null` if no identity has been created yet. this is a cheap
 * IndexedDB read and does NOT start the midden WASM endpoint, so it is
 * safe to call on boot (e.g. to display the node_id in a profile widget).
 */
export async function getStoredIdentity(): Promise<P2PIdentity | null> {
  if (isTauriMode()) {
    try {
      const node = await TauriStreamNode.create();
      return {
        secret_key: new Uint8Array(), // not exposed in tauri mode
        node_id: node.node_id(),
        created_at: 0,
      };
    } catch {
      return null; // P2P endpoint not ready yet
    }
  }
  return getMetaRecord<P2PIdentity>(IDENTITY_KEY);
}

// ---------------------------------------------------------------------------
// midden singleton (lazy)
// ---------------------------------------------------------------------------

/**
 * get or create the midden node singleton.
 *
 * lazy — the midden WASM module is only imported and the endpoint is only
 * started on the first call. if a persisted identity exists in IndexedDB it
 * is restored; otherwise a fresh keypair is generated, persisted, and the
 * change listeners are notified.
 *
 * concurrent callers share the same in-flight promise so the endpoint is
 * never initialized twice.
 */
export async function getMiddenNode(): Promise<MiddenNodeLike> {
  // in tauri mode, return a TauriStreamNode backed by the rust endpoint
  if (isTauriMode()) {
    if (!middenNode) {
      const tauriNode = await TauriStreamNode.create();
      middenNode = tauriNode as unknown as MiddenNodeLike;
      console.log(TAG, "using tauri transport, node_id:", tauriNode.node_id().slice(0, 16) + "...");
    }
    return middenNode;
  }

  // fast path: already running
  if (middenNode) {
    return middenNode;
  }

  // dedup: return the in-flight promise if another caller is already
  // initializing the node
  if (middenNodePromise) {
    return middenNodePromise;
  }

  middenNodePromise = (async (): Promise<MiddenNodeLike> => {
    // dynamic import keeps the midden WASM out of the initial bundle.
    const { MiddenNode } = await import("midden");

    const existing = await getStoredIdentity();

    let node: MiddenNodeLike;

    if (existing) {
      // restore from the persisted secret key
      const truncated = existing.node_id.slice(0, 16) + "...";
      console.log(TAG, "restoring identity from IndexedDB:", truncated);
      node = await MiddenNode.create_from_key(existing.secret_key);
    } else {
      // generate a brand-new identity
      node = await MiddenNode.create();
      const identity: P2PIdentity = {
        secret_key: node.secret_key(),
        node_id: node.node_id(),
        created_at: Date.now(),
      };
      await setMetaRecord<P2PIdentity>(IDENTITY_KEY, identity);

      const truncated = identity.node_id.slice(0, 16) + "...";
      console.log(TAG, "created new identity:", truncated);

      notifyListeners(identity);
    }

    middenNode = node;
    console.log(TAG, "node ready, node_id:", node.node_id().slice(0, 16) + "...");
    return node;
  })();

  // if initialization fails, clear the promise so a subsequent call can
  // retry instead of forever returning a rejected promise.
  middenNodePromise.catch(() => {
    middenNodePromise = null;
  });

  return middenNodePromise;
}

// ---------------------------------------------------------------------------
// ensure identity exists
// ---------------------------------------------------------------------------

/**
 * ensure an identity exists, generating one via midden if needed.
 *
 * if a persisted identity is already present in IndexedDB this simply
 * returns it. otherwise it starts the midden endpoint (as a side effect)
 * to generate a keypair, persists it, and returns the new identity.
 */
export async function ensureIdentity(): Promise<P2PIdentity> {
  // in tauri mode, identity always exists (from the running endpoint)
  if (isTauriMode()) {
    const identity = await getStoredIdentity();
    if (identity) return identity;
    throw new Error(TAG + " P2P endpoint not available in tauri mode");
  }

  // cheap check first — avoids starting midden when we already have one
  const existing = await getStoredIdentity();
  if (existing) {
    return existing;
  }

  // no identity yet — starting midden will create and persist one
  await getMiddenNode();

  // the identity was just written by getMiddenNode, read it back
  const created = await getStoredIdentity();
  if (!created) {
    // should be unreachable — getMiddenNode always persists an identity
    throw new Error(TAG + " identity was not persisted after midden init");
  }
  return created;
}

// ---------------------------------------------------------------------------
// deletion / reset
// ---------------------------------------------------------------------------

/**
 * delete the stored identity and tear down the midden node if running.
 *
 * after this call, `getStoredIdentity()` returns `null` and the midden
 * endpoint is stopped. a subsequent call to `getMiddenNode()` or
 * `ensureIdentity()` will generate a fresh identity.
 */
export async function deleteIdentity(): Promise<void> {
  // tear down the running node if any
  middenNode = null;
  middenNodePromise = null;

  await deleteMetaRecord(IDENTITY_KEY);

  console.log(TAG, "identity deleted");
  notifyListeners(null);
}
