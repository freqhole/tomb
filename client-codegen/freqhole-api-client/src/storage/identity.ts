// p2p identity resolution with read-only access to spume's freqhole_app IndexedDB.
//
// policy:
//   - never create or upgrade the "freqhole_app" database
//   - if freqhole_app exists and has an "app_state" store, use it as the primary store
//   - otherwise, use the injected IdentityStore (local, per-app)
//   - when both have an identity, prefer spume's db

const FREQHOLE_APP_DB = "freqhole_app";
const APP_STATE_STORE = "app_state";
const IDENTITY_KEY = "p2p_identity";

// snake_case fields are a wire/storage compatibility contract with spume
export interface P2PIdentity {
  id: "p2p_identity";
  secret_key: Uint8Array;
  node_id: string;
  created_at: number;
}

/** per-app fallback store - apps supply their own settings persistence */
export interface IdentityStore {
  get(): Promise<P2PIdentity | null>;
  set(identity: P2PIdentity): Promise<void>;
}

/**
 * check whether freqhole_app exists without creating it.
 *
 * strategy:
 *   1. use indexedDB.databases() when available (Chrome/Firefox 126+)
 *   2. fall back to a versionless open; abort the versionchange transaction
 *      if upgrade fires (meaning the db did not exist), then close and delete.
 */
async function freqholeAppExists(): Promise<boolean> {
  // prefer the non-destructive databases() API
  if (typeof indexedDB.databases === "function") {
    try {
      const dbs = await indexedDB.databases();
      return dbs.some((d) => d.name === FREQHOLE_APP_DB);
    } catch {
      // fall through to open-based detection
    }
  }

  // open-based detection: if upgradeneeded fires, the db did not exist -
  // abort immediately so IDB never persists it
  return new Promise<boolean>((resolve) => {
    const req = indexedDB.open(FREQHOLE_APP_DB);
    let existed = true;

    req.onupgradeneeded = (event) => {
      // upgradeneeded on a version-0 open means the db is being created now
      existed = false;
      // abort the versionchange transaction to prevent creation
      (event.target as IDBOpenDBRequest).transaction?.abort();
    };

    req.onsuccess = () => {
      req.result.close();
      if (!existed) {
        // clean up the empty database that was created before we could abort
        indexedDB.deleteDatabase(FREQHOLE_APP_DB);
      }
      resolve(existed);
    };

    req.onerror = () => {
      // the abort above causes an error - if existed is false this is expected
      resolve(existed);
    };
  });
}

/**
 * check whether freqhole_app has the app_state object store.
 * caller must have already confirmed the db exists.
 */
async function hasAppStateStore(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const req = indexedDB.open(FREQHOLE_APP_DB);

    req.onupgradeneeded = () => {
      // should not fire here since we know the db exists - if it does, abort
      req.transaction?.abort();
      resolve(false);
    };

    req.onsuccess = () => {
      const db = req.result;
      const has = db.objectStoreNames.contains(APP_STATE_STORE);
      db.close();
      resolve(has);
    };

    req.onerror = () => resolve(false);
  });
}

/** read p2p_identity from spume's app_state store */
function readFromFreqholeApp(): Promise<P2PIdentity | null> {
  return new Promise<P2PIdentity | null>((resolve) => {
    const req = indexedDB.open(FREQHOLE_APP_DB);

    req.onupgradeneeded = () => {
      req.transaction?.abort();
      resolve(null);
    };

    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(APP_STATE_STORE, "readonly");
      const getReq = tx.objectStore(APP_STATE_STORE).get(IDENTITY_KEY);

      getReq.onsuccess = () => {
        db.close();
        resolve((getReq.result as P2PIdentity) ?? null);
      };
      getReq.onerror = () => {
        db.close();
        resolve(null);
      };
    };

    req.onerror = () => resolve(null);
  });
}

/** write p2p_identity to spume's app_state store (no version bump) */
function writeToFreqholeApp(identity: P2PIdentity): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const req = indexedDB.open(FREQHOLE_APP_DB);

    req.onupgradeneeded = () => {
      req.transaction?.abort();
      reject(new Error("freqhole_app unexpectedly absent during write"));
    };

    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(APP_STATE_STORE, "readwrite");
      const putReq = tx.objectStore(APP_STATE_STORE).put(identity, IDENTITY_KEY);

      putReq.onsuccess = () => {
        db.close();
        resolve();
      };
      putReq.onerror = () => {
        db.close();
        reject(putReq.error);
      };
    };

    req.onerror = () => reject(req.error);
  });
}

/**
 * resolve the p2p identity for this origin.
 * prefers spume's db when both sources have an identity.
 */
export async function resolveIdentity(
  local: IdentityStore,
): Promise<P2PIdentity | null> {
  const exists = await freqholeAppExists();
  if (exists && (await hasAppStateStore())) {
    const spumeIdentity = await readFromFreqholeApp();
    if (spumeIdentity) return spumeIdentity;
    // spume db exists but has no identity - fall through to local
  }

  return local.get();
}

/**
 * persist a p2p identity.
 * writes to spume's db if it exists and has app_state; otherwise uses local.
 */
export async function persistIdentity(
  identity: P2PIdentity,
  local: IdentityStore,
): Promise<void> {
  const exists = await freqholeAppExists();
  if (exists && (await hasAppStateStore())) {
    await writeToFreqholeApp(identity);
    return;
  }

  await local.set(identity);
}
