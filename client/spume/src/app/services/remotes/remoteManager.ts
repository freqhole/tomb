// remote server management - CRUD operations for remote configurations
// auth is handled via cookies, so no credentials stored here

import { getClientForRemote, httpRemote, isTauriAvailable } from "../../api/client";
import { initAppDB } from "../storage/db";
import {
  STORE_REMOTES,
  type Remote,
  type HttpRemote,
  type P2PRemote,
  parseRemotes,
  safeParseRemote,
  isHttpRemote,
  isP2PRemote,
} from "../storage/types";
import { debug, error as errorLog } from "../../../utils/logger";

// callback type for remote status changes
type RemoteStatusChangeListener = (remoteId: string, isOffline: boolean) => void;

// listeners for remote status changes (offline/online)
const statusChangeListeners = new Set<RemoteStatusChangeListener>();

// callback for "switch to local" action triggered from toast
type SwitchToLocalListener = () => void;
let switchToLocalListener: SwitchToLocalListener | null = null;

// register a handler for "switch to local" action (only one handler at a time)
export function onSwitchToLocal(listener: SwitchToLocalListener): () => void {
  switchToLocalListener = listener;
  return () => { switchToLocalListener = null; };
}

// trigger the "switch to local" action (called from toast action button)
export function triggerSwitchToLocal(): void {
  if (switchToLocalListener) {
    switchToLocalListener();
  }
}

// tauri convertFileSrc - dynamically loaded
let convertFileSrc: ((path: string) => string) | null = null;

// ensure convertFileSrc is loaded (for tauri file:// to asset:// conversion)
async function ensureConvertFileSrc(): Promise<((path: string) => string) | null> {
  if (convertFileSrc) return convertFileSrc;
  if (!isTauriAvailable()) return null;
  try {
    const tauri = await import("@tauri-apps/api/core");
    convertFileSrc = tauri.convertFileSrc;
    return convertFileSrc;
  } catch {
    return null;
  }
}

// register a listener for remote status changes
// returns unsubscribe function
export function onRemoteStatusChange(listener: RemoteStatusChangeListener): () => void {
  statusChangeListeners.add(listener);
  return () => statusChangeListeners.delete(listener);
}

// notify all listeners of a status change
function notifyStatusChange(remoteId: string, isOffline: boolean): void {
  for (const listener of statusChangeListeners) {
    try {
      listener(remoteId, isOffline);
    } catch (e) {
      errorLog("error in remote status change listener:", e);
    }
  }
}

// get all remotes
export async function getAllRemotes(): Promise<Remote[]> {
  const db = await initAppDB();
  const rawRemotes = await db.getAll(STORE_REMOTES);
  const remotes = parseRemotes(rawRemotes);
  return remotes.sort((a, b) => b.created_at - a.created_at);
}

// get the tauri-managed remote (if exists)
export async function getTauriManagedRemote(): Promise<Remote | null> {
  const db = await initAppDB();
  const rawRemotes = await db.getAll(STORE_REMOTES);
  const remotes = parseRemotes(rawRemotes);
  return remotes.find((r) => r.is_tauri_managed) ?? null;
}

// create or update the tauri-managed remote
export async function upsertTauriRemote(config: {
  name: string;
  base_url: string;
  server_image_path?: string;
}): Promise<Remote> {
  console.log("[upsertTauriRemote] called with config:", {
    name: config.name,
    base_url: config.base_url,
    server_image_path: config.server_image_path,
  });

  const db = await initAppDB();
  const existing = await getTauriManagedRemote();

  // convert file path to asset:// URL if available
  let imageUrl: string | null = null;
  if (config.server_image_path) {
    const convert = await ensureConvertFileSrc();
    if (convert) {
      imageUrl = convert(config.server_image_path);
      console.log("[upsertTauriRemote] converted server_image_path to asset URL:", imageUrl);
    } else {
      console.log("[upsertTauriRemote] convertFileSrc not available");
    }
  } else {
    console.log("[upsertTauriRemote] no server_image_path provided");
  }

  if (existing) {
    // update existing remote with new config (keep transport type)
    const updated: Remote = {
      ...existing,
      name: config.name,
      // for tauri-managed: ONLY use asset:// URL from server_image_path, never HTTP
      // if no image path provided, clear the image_url (don't keep old HTTP path)
      image_url: imageUrl,
      updated_at: Date.now(),
      // update base_url only for HTTP remotes
      ...(isHttpRemote(existing) ? { base_url: config.base_url.replace(/\/$/, "") } : {}),
    };
    await db.put(STORE_REMOTES, updated);
    console.log("[upsertTauriRemote] updated existing remote:", {
      name: updated.name,
      image_url: updated.image_url,
      updated_at: updated.updated_at,
    });
    // notify listeners so UI updates
    notifyStatusChange(updated.remote_id, updated.is_offline ?? false);
    return updated;
  }

  // create new tauri-managed remote (always HTTP for tauri)
  const remoteId = await generateUniqueRemoteId(config.name);
  const remote: HttpRemote = {
    transport: "http",
    remote_id: remoteId,
    name: config.name,
    base_url: config.base_url.replace(/\/$/, ""),
    is_active: false,
    last_connected_at: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    description: null,
    // use asset:// URL if we have a file path
    image_url: imageUrl,
    image_blob_id: null,
    version: null,
    last_info_check: null,
    is_tauri_managed: true,
  };
  await db.put(STORE_REMOTES, remote);
  debug(`created tauri remote: ${remote.name} (${remote.base_url})`);
  return remote;
}

// get remote by id
export async function getRemoteById(
  remoteId: string,
): Promise<Remote | undefined> {
  const db = await initAppDB();
  const raw = await db.get(STORE_REMOTES, remoteId);
  return safeParseRemote(raw);
}

// find a P2P remote by its peer address (node_id or endpoint JSON containing node_id).
// used to map peer-offline events to the correct remote.
export async function getRemoteByPeerAddr(
  peerAddr: string,
): Promise<Remote | undefined> {
  const db = await initAppDB();
  const tx = db.transaction(STORE_REMOTES, "readonly");
  const store = tx.objectStore(STORE_REMOTES);
  const all = await store.getAll();
  
  for (const raw of all) {
    const remote = safeParseRemote(raw);
    if (!remote || !isP2PRemote(remote)) continue;
    
    // check for exact match first
    if (remote.peer_addr === peerAddr) {
      return remote;
    }
    
    // if peerAddr looks like plain node_id (64 hex chars), check if it's contained
    // in the remote's peer_addr (which might be JSON endpoint)
    if (/^[a-f0-9]{64}$/i.test(peerAddr) && remote.peer_addr.includes(peerAddr)) {
      return remote;
    }
    
    // if remote's peer_addr is plain node_id and peerAddr is JSON containing it
    if (/^[a-f0-9]{64}$/i.test(remote.peer_addr) && peerAddr.includes(remote.peer_addr)) {
      return remote;
    }
  }
  
  return undefined;
}

// refresh tauri-managed remote's timestamp (for cache-busting server image)
export async function refreshTauriRemoteTimestamp(): Promise<void> {
  const existing = await getTauriManagedRemote();
  if (!existing) {
    debug("refreshTauriRemoteTimestamp: no tauri-managed remote found");
    return;
  }

  const db = await initAppDB();
  const updated: Remote = {
    ...existing,
    updated_at: Date.now(),
  };
  await db.put(STORE_REMOTES, updated);
  debug(`refreshTauriRemoteTimestamp: updated to ${updated.updated_at}`);

  // notify listeners of the update (will trigger remotes refresh in AppLayout)
  notifyStatusChange(existing.remote_id, existing.is_offline ?? false);
}

// get remote by url
export async function getRemoteByUrl(url: string): Promise<Remote | undefined> {
  const remotes = await getAllRemotes();
  return remotes.find((r) => isHttpRemote(r) && r.base_url === url);
}

// get currently active remote (if any)
export async function getActiveRemote(): Promise<Remote | null> {
  const db = await initAppDB();
  const rawRemotes = await db.getAllFromIndex(STORE_REMOTES, "by_is_active", 1);
  const remotes = parseRemotes(rawRemotes);
  return remotes[0] || null;
}

/**
 * generate a URL-safe slug from a name.
 * e.g., "My Music Server" -> "my-music-server"
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // replace non-alphanumeric with hyphens
    .replace(/-+/g, "-") // collapse multiple hyphens
    .replace(/^-|-$/g, "") // trim leading/trailing hyphens
    || "remote"; // fallback if name is empty after sanitization
}

/**
 * generate a unique remote_id by checking existing IDs and appending suffix if needed.
 * e.g., "my-server" -> "my-server" (if unique)
 *       "my-server" -> "my-server-2" (if "my-server" exists)
 */
async function generateUniqueRemoteId(baseName: string): Promise<string> {
  const baseSlug = generateSlug(baseName);
  const remotes = await getAllRemotes();
  const existingIds = new Set(remotes.map((r) => r.remote_id));

  // try base slug first
  if (!existingIds.has(baseSlug)) {
    return baseSlug;
  }

  // find next available number
  let counter = 2;
  while (existingIds.has(`${baseSlug}-${counter}`)) {
    counter++;
  }
  return `${baseSlug}-${counter}`;
}

// create a new remote
export async function createRemote(data: {
  name?: string; // optional - uses server name from /api/hello if not provided
  base_url?: string; // required for HTTP remotes
  peer_addr?: string; // node_id or JSON endpoint for P2P remotes
  api_key?: string; // optional - for api key authentication
}): Promise<Remote> {
  const db = await initAppDB();

  const isP2P = !!data.peer_addr;
  const baseUrl = data.base_url?.replace(/\/$/, "") ?? "";

  if (!isP2P && !baseUrl) {
    throw new Error("base_url is required for HTTP remotes");
  }

  // check if remote with this url/peer already exists
  if (baseUrl) {
    const existingByUrl = await getRemoteByUrl(baseUrl);
    if (existingByUrl) {
      throw new Error(`remote already exists for this url: ${existingByUrl.name}`);
    }
  }

  // check if P2P remote with this peer_addr already exists
  if (isP2P && data.peer_addr) {
    const existingByPeer = await getRemoteByPeerAddr(data.peer_addr);
    if (existingByPeer) {
      throw new Error(`remote already exists for this peer: ${existingByPeer.name}`);
    }
  }

  // fetch server info - use async client for P2P remotes
  let serverInfo = null;
  try {
    if (isP2P) {
      const client = await getClientForRemote({ peer_addr: data.peer_addr, transport: isTauriAvailable() ? "app" : "wasm" });
      const result = await client.app.serverInfo();
      if (result.success && result.data) {
        serverInfo = result.data;
      }
    } else {
      const client = await getClientForRemote(httpRemote(baseUrl));
      const result = await client.app.serverInfo();
      if (result.success && result.data) {
        serverInfo = result.data;
      }
    }
  } catch (error) {
    errorLog(`failed to fetch server info:`, error);
    throw new Error(
      "failed to connect to server - could not fetch server info",
    );
  }

  if (!serverInfo) {
    throw new Error("server did not return valid info");
  }

  // use server name from /api/hello if no name provided
  const remoteName = data.name || serverInfo.name || baseUrl || `p2p-${(data.peer_addr ?? "").slice(0, 8)}`;

  // generate unique remote_id from server name (URL slug with collision handling)
  const remoteId = await generateUniqueRemoteId(remoteName);

  // create remote with discriminated transport type
  const commonFields = {
    remote_id: remoteId,
    name: remoteName,
    is_active: false,
    last_connected_at: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    // server info fields
    description: serverInfo.description ?? null,
    image_url: serverInfo.image_url ?? null,
    image_blob_id: serverInfo.image_blob_id ?? null,
    version: serverInfo.version,
    last_info_check: Date.now(),
    // api key auth (optional)
    api_key: data.api_key,
  };

  const remote: Remote = isP2P
    ? {
        ...commonFields,
        transport: isTauriAvailable() ? "app" : "wasm",
        peer_addr: data.peer_addr!,
        base_url: baseUrl || undefined,
      } as P2PRemote
    : {
        ...commonFields,
        transport: "http",
        base_url: baseUrl,
      } as HttpRemote;

  await db.put(STORE_REMOTES, remote);
  debug(`created remote: ${remote.name} (${isHttpRemote(remote) ? remote.base_url : remote.peer_addr})`);

  return remote;
}

// update an existing remote
export async function updateRemote(
  remoteId: string,
  updates: Partial<Pick<Remote, "name" | "base_url" | "api_key">>,
): Promise<Remote> {
  const db = await initAppDB();

  const existing = await db.get(STORE_REMOTES, remoteId);
  if (!existing) {
    throw new Error(`remote not found: ${remoteId}`);
  }

  const updated: Remote = {
    ...existing,
    ...updates,
    updated_at: Date.now(),
  };

  // normalize url if provided
  if (updates.base_url) {
    updated.base_url = updates.base_url.replace(/\/$/, "");
  }

  await db.put(STORE_REMOTES, updated);
  debug(`updated remote: ${updated.name}`);

  return updated;
}

// delete a remote
export async function deleteRemote(remoteId: string): Promise<void> {
  const db = await initAppDB();

  const existing = await db.get(STORE_REMOTES, remoteId);
  if (!existing) {
    throw new Error(`remote not found: ${remoteId}`);
  }

  await db.delete(STORE_REMOTES, remoteId);
  debug(`deleted remote: ${existing.name}`);
}

// set a remote as active (deactivates all others)
export async function setActiveRemote(remoteId: string): Promise<void> {
  const db = await initAppDB();

  const remote = await db.get(STORE_REMOTES, remoteId);
  if (!remote) {
    throw new Error(`remote not found: ${remoteId}`);
  }

  // deactivate all remotes
  const allRemotes = await db.getAll(STORE_REMOTES);
  for (const r of allRemotes) {
    if (r.is_active) {
      await db.put(STORE_REMOTES, {
        ...r,
        is_active: false,
        updated_at: Date.now(),
      });
    }
  }

  // activate the selected remote
  await db.put(STORE_REMOTES, {
    ...remote,
    is_active: true,
    last_connected_at: Date.now(),
    updated_at: Date.now(),
  });

  debug(`activated remote: ${remote.name}`);
}

// deactivate all remotes (switch to local)
export async function deactivateAllRemotes(): Promise<void> {
  const db = await initAppDB();

  const allRemotes = await db.getAll(STORE_REMOTES);
  for (const remote of allRemotes) {
    if (remote.is_active) {
      await db.put(STORE_REMOTES, {
        ...remote,
        is_active: false,
        updated_at: Date.now(),
      });
    }
  }

  debug("deactivated all remotes (using local source)");
}

// update last_connected_at timestamp for a remote
export async function updateRemoteConnectionTime(
  remoteId: string,
): Promise<void> {
  const db = await initAppDB();

  const remote = await db.get(STORE_REMOTES, remoteId);
  if (!remote) return;

  await db.put(STORE_REMOTES, {
    ...remote,
    last_connected_at: Date.now(),
    updated_at: Date.now(),
  });
}

// refresh server info for a remote (fetch from /api/hello)
export async function refreshServerInfo(remoteId: string): Promise<void> {
  const db = await initAppDB();

  const remote = await db.get(STORE_REMOTES, remoteId);
  if (!remote) {
    throw new Error(`remote not found: ${remoteId}`);
  }

  try {
    const client = await getClientForRemote(remote);
    const result = await client.app.serverInfo();
    if (result.success && result.data) {
      const serverInfo = result.data;
      await db.put(STORE_REMOTES, {
        ...remote,
        description: serverInfo.description,
        image_url: serverInfo.image_url,
        version: serverInfo.version,
        last_info_check: Date.now(),
        updated_at: Date.now(),
      });
      debug(`refreshed server info for: ${remote.name}`);
    }
  } catch (error) {
    errorLog(`failed to refresh server info for ${remote.name}:`, error);
    throw error;
  }
}

// check if a remote uses P2P transport (wasm or app)
export function isP2PTransport(remote: Remote): boolean {
  return isP2PRemote(remote);
}

// check if a remote is online (quick health check via /api/hello)
// returns true if online, false if offline
// also updates server info (image_url, version, etc.) when online
export async function checkRemoteHealth(remote: Remote): Promise<boolean> {
  const db = await initAppDB();
  const now = Date.now();

  try {
    // use async client getter for P2P remotes (starts midden node if needed)
    const client = await getClientForRemote(remote);
    const result = await client.app.serverInfo();
    const isOnline = result.success && !!result.data;

    // re-read remote from IDB to get latest data (avoids overwriting with stale data)
    const freshRemote = await db.get(STORE_REMOTES, remote.remote_id);
    if (!freshRemote) {
      debug(`health check: remote ${remote.remote_id} not found in IDB`);
      return isOnline;
    }

    // update remote with new status
    const updated: Remote = {
      ...freshRemote,
      is_offline: !isOnline,
      last_checked: now,
      updated_at: now,
    };

    if (isOnline) {
      // clear offline status
      updated.offline_since = null;
      updated.last_connected_at = now;
      
      // also update server info if we got it (self-heals missing image_url, etc.)
      // but don't overwrite local image_url for tauri-managed remotes (they use asset:// URLs)
      if (result.data) {
        updated.description = result.data.description ?? updated.description;
        if (!freshRemote.is_tauri_managed) {
          updated.image_url = result.data.image_url ?? updated.image_url;
        }
        updated.version = result.data.version ?? updated.version;
        updated.last_info_check = now;
      }
    } else if (!freshRemote.is_offline) {
      // just went offline - record when
      updated.offline_since = now;
    }

    await db.put(STORE_REMOTES, updated);
    debug(`health check for ${freshRemote.name}: ${isOnline ? "online" : "offline"}`);
    return isOnline;
  } catch (error) {
    // network error = offline - re-read from IDB before updating
    const freshRemote = await db.get(STORE_REMOTES, remote.remote_id);
    if (freshRemote) {
      const updated: Remote = {
        ...freshRemote,
        is_offline: true,
        last_checked: now,
        offline_since: freshRemote.is_offline ? freshRemote.offline_since : now,
        updated_at: now,
      };
      await db.put(STORE_REMOTES, updated);
    }
    errorLog(`health check failed for ${remote.name}:`, error);
    return false;
  }
}

// mark a remote as offline (without doing a health check)
export async function markRemoteOffline(remoteId: string): Promise<void> {
  const db = await initAppDB();
  const remote = await db.get(STORE_REMOTES, remoteId);
  if (!remote) return;

  const now = Date.now();
  await db.put(STORE_REMOTES, {
    ...remote,
    is_offline: true,
    offline_since: remote.is_offline ? remote.offline_since : now,
    last_checked: now,
    updated_at: now,
  });
  debug(`marked remote as offline: ${remote.name}`);
  notifyStatusChange(remoteId, true);
}

// mark a remote as online (without doing a health check)
export async function markRemoteOnline(remoteId: string): Promise<void> {
  const db = await initAppDB();
  const remote = await db.get(STORE_REMOTES, remoteId);
  if (!remote) return;

  const now = Date.now();
  await db.put(STORE_REMOTES, {
    ...remote,
    is_offline: false,
    offline_since: null,
    last_checked: now,
    last_connected_at: now,
    updated_at: now,
  });
  debug(`marked remote as online: ${remote.name}`);
  notifyStatusChange(remoteId, false);
  debug(`marked remote as online: ${remote.name}`);
}

// find the first online remote from a list
export async function findFirstOnlineRemote(
  remotes: Remote[],
): Promise<Remote | null> {
  for (const remote of remotes) {
    const isOnline = await checkRemoteHealth(remote);
    if (isOnline) {
      return remote;
    }
  }
  return null;
}

