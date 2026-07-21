// core p2p identity shape shared across the freqhole apps.
//
// snake_case fields are a storage/wire compatibility contract: existing
// browser-persisted records already use these exact key names, so renaming
// them would break identity resolution for anyone upgrading in place.
export interface P2PIdentity {
  /** 32-byte iroh secret key. */
  secret_key: Uint8Array;
  /** public node id (iroh public key, hex-encoded). */
  node_id: string;
  /** unix epoch millis when the identity was first created. */
  created_at: number;
}

/**
 * per-app identity persistence.
 *
 * apps supply their own storage behind this narrow interface - idb, a
 * generic key/value store, secure platform storage, whatever fits. this
 * package's idb-backed implementation (see idbStore.ts) is one convenient
 * option, not a requirement.
 */
export interface IdentityStore {
  get(): Promise<P2PIdentity | null>;
  set(identity: P2PIdentity): Promise<void>;
}
