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
// identity bundle serialization
// ---------------------------------------------------------------------------

/** convert a Uint8Array to a base64 string. */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** convert a base64 string back to a Uint8Array. */
function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** the shape of a decoded identity bundle. */
export interface IdentityBundle {
  secretKey: Uint8Array;
  friendNodeIds: string[];
  username?: string;
  bio?: string;
}

/**
 * encode an identity bundle as a compact string.
 * format: "skein1:" + base64(JSON({ sk: base64(secretKey), f: [nodeId, ...] }))
 */
export function encodeIdentityBundle(
  secretKey: Uint8Array,
  friendNodeIds: string[],
  profile?: { username?: string; bio?: string }
): string {
  const payload: Record<string, unknown> = {
    sk: uint8ToBase64(secretKey),
    f: friendNodeIds,
  };
  if (profile?.username) payload.u = profile.username;
  if (profile?.bio) payload.b = profile.bio;
  return "skein1:" + btoa(JSON.stringify(payload));
}

/**
 * decode an identity bundle string back into its components.
 * throws if the format is invalid.
 */
export function decodeIdentityBundle(bundle: string): IdentityBundle {
  if (!bundle.startsWith("skein1:")) {
    throw new Error("invalid identity bundle — expected 'skein1:' prefix");
  }
  const payloadStr = atob(bundle.slice("skein1:".length));
  const payload = JSON.parse(payloadStr);

  if (!payload.sk || typeof payload.sk !== "string") {
    throw new Error("invalid identity bundle — missing secret key");
  }

  return {
    secretKey: base64ToUint8(payload.sk),
    friendNodeIds: Array.isArray(payload.f) ? payload.f : [],
    username: typeof payload.u === "string" ? payload.u : undefined,
    bio: typeof payload.b === "string" ? payload.b : undefined,
  };
}

/**
 * export the current identity and friend list as a compact bundle string.
 * the bundle includes the secret key and all friend node IDs so the user
 * can restore their identity and friend list on another device.
 */
export async function exportIdentityBundle(
  friendNodeIds: string[],
  profile?: { username?: string; bio?: string }
): Promise<string> {
  const identity = await getStoredIdentity();
  if (!identity) throw new Error(TAG + " no identity to export");
  if (!identity.secret_key || identity.secret_key.length === 0) {
    throw new Error(TAG + " secret key not available (tauri mode?)");
  }
  return encodeIdentityBundle(identity.secret_key, friendNodeIds, profile);
}

/**
 * import an identity from a raw secret key. tears down any existing midden
 * node, creates a new one from the provided key, persists the identity, and
 * notifies listeners.
 *
 * returns the full P2PIdentity with the derived node_id.
 */
export async function importIdentity(secretKey: Uint8Array): Promise<P2PIdentity> {
  if (isTauriMode()) {
    throw new Error(TAG + " identity import not supported in tauri mode");
  }

  // tear down existing node
  middenNode = null;
  middenNodePromise = null;

  // start a new node from the provided key
  const { MiddenNode } = await import("midden");
  const node = await MiddenNode.create_from_key(secretKey);

  const identity: P2PIdentity = {
    secret_key: secretKey,
    node_id: node.node_id(),
    created_at: Date.now(),
  };

  await setMetaRecord<P2PIdentity>(IDENTITY_KEY, identity);
  middenNode = node;

  console.log(TAG, "imported identity:", identity.node_id.slice(0, 16) + "...");
  notifyListeners(identity);

  return identity;
}

/**
 * import an identity from a bundle string (as produced by exportIdentityBundle).
 * restores the secret key and returns the friend node IDs so the caller can
 * re-add them to the social doc.
 */
export async function importIdentityFromBundle(
  bundle: string
): Promise<{ identity: P2PIdentity; friendNodeIds: string[]; username?: string; bio?: string }> {
  const decoded = decodeIdentityBundle(bundle);
  const identity = await importIdentity(decoded.secretKey);
  return {
    identity,
    friendNodeIds: decoded.friendNodeIds,
    username: decoded.username,
    bio: decoded.bio,
  };
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
