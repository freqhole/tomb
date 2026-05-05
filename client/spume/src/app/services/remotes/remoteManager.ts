// remote server management - CRUD operations and lifecycle helpers for
// remote configurations.
//
// auth is handled via cookies, so no credentials stored here.
//
// storage is delegated to a `RemoteBackend` selected at runtime
// (sqlite in tauri/charnel, indexeddb in pure-web). this module owns the
// business logic: slug generation, server-info fetch, image url handling,
// status listeners, etc.

import {
  getClientForRemote,
  httpRemote,
  isCharnelAvailable,
} from "../../api/client";
import {
  type Remote,
  type HttpRemote,
  type P2PRemote,
  isHttpRemote,
  isP2PRemote,
} from "../storage/types";
import { debug, error as errorLog } from "../../../utils/logger";
import { getBackend } from "./backends";

// ============================================================================
// listener registry (in-memory, per process)
// ============================================================================

type RemoteStatusChangeListener = (remoteId: string, isOffline: boolean) => void;
const statusChangeListeners = new Set<RemoteStatusChangeListener>();

type SwitchToLocalListener = () => void;
let switchToLocalListener: SwitchToLocalListener | null = null;

// register a handler for "switch to local" action (only one handler at a time)
export function onSwitchToLocal(listener: SwitchToLocalListener): () => void {
  switchToLocalListener = listener;
  return () => {
    switchToLocalListener = null;
  };
}

// trigger the "switch to local" action (called from toast action button)
export function triggerSwitchToLocal(): void {
  if (switchToLocalListener) {
    switchToLocalListener();
  }
}

// register a listener for remote status changes
// returns unsubscribe function
export function onRemoteStatusChange(
  listener: RemoteStatusChangeListener,
): () => void {
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

// ============================================================================
// tauri-only helpers
// ============================================================================

// tauri convertFileSrc - dynamically loaded for asset:// url conversion
let convertFileSrc: ((path: string) => string) | null = null;

async function ensureConvertFileSrc(): Promise<
  ((path: string) => string) | null
> {
  if (convertFileSrc) return convertFileSrc;
  if (!isCharnelAvailable()) return null;
  try {
    const tauri = await import("@tauri-apps/api/core");
    convertFileSrc = tauri.convertFileSrc;
    return convertFileSrc;
  } catch {
    return null;
  }
}

// ============================================================================
// reads
// ============================================================================

// short-lived in-memory cache for getRemoteById, since hot paths (blob
// pre-cache, analytics queue, audio source resolution, etc.) call it many
// times per second per remote. backend.get() goes through tauri ipc on
// charnel, so even a few-hundred-ms ttl collapses thousands of calls.
//
// invalidated explicitly on every write below; the ttl is just a safety net
// (and lets in-flight reads dedupe via the shared promise).
const REMOTE_CACHE_TTL_MS = 2_000;
type RemoteCacheEntry = {
  value: Remote | undefined;
  expiresAt: number;
};
const remoteByIdCache = new Map<string, RemoteCacheEntry>();
const remoteByIdInflight = new Map<string, Promise<Remote | undefined>>();

function invalidateRemoteCache(remoteId?: string): void {
  if (remoteId) {
    remoteByIdCache.delete(remoteId);
  } else {
    remoteByIdCache.clear();
  }
}

// get all remotes (sorted by created_at desc)
export async function getAllRemotes(): Promise<Remote[]> {
  const all = await getBackend().list();
  return all.sort((a, b) => b.created_at - a.created_at);
}

// get the tauri-managed remote (if exists)
export async function getTauriManagedRemote(): Promise<Remote | null> {
  const all = await getBackend().list();
  return all.find((r) => r.is_charnel_managed) ?? null;
}

// get remote by id
export async function getRemoteById(
  remoteId: string,
): Promise<Remote | undefined> {
  const now = Date.now();
  const cached = remoteByIdCache.get(remoteId);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  // dedupe concurrent lookups
  const inflight = remoteByIdInflight.get(remoteId);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const value = await getBackend().get(remoteId);
      remoteByIdCache.set(remoteId, {
        value,
        expiresAt: Date.now() + REMOTE_CACHE_TTL_MS,
      });
      return value;
    } finally {
      remoteByIdInflight.delete(remoteId);
    }
  })();
  remoteByIdInflight.set(remoteId, promise);
  return promise;
}

// find a P2P remote by its peer address (node_id or endpoint JSON containing node_id)
// used to map peer-offline events to the correct remote.
export async function getRemoteByPeerAddr(
  peerAddr: string,
): Promise<Remote | undefined> {
  return getBackend().getByPeerAddr(peerAddr);
}

// get remote by url
export async function getRemoteByUrl(
  url: string,
): Promise<Remote | undefined> {
  const remotes = await getBackend().list();
  return remotes.find((r) => isHttpRemote(r) && r.base_url === url);
}

// get currently active remote (if any)
export async function getActiveRemote(): Promise<Remote | null> {
  const all = await getBackend().list();
  return all.find((r) => r.is_active) ?? null;
}

// ============================================================================
// id generation
// ============================================================================

/**
 * generate a URL-safe slug from a name.
 * e.g., "My Music Server" -> "my-music-server"
 */
function generateSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-") // replace non-alphanumeric with hyphens
      .replace(/-+/g, "-") // collapse multiple hyphens
      .replace(/^-|-$/g, "") || "remote" // fallback if name is empty after sanitization
  );
}

/**
 * generate a unique remote_id by checking existing IDs and appending suffix if needed.
 * e.g., "my-server" -> "my-server" (if unique)
 *       "my-server" -> "my-server-2" (if "my-server" exists)
 */
async function generateUniqueRemoteId(baseName: string): Promise<string> {
  const baseSlug = generateSlug(baseName);
  const remotes = await getBackend().list();
  const existingIds = new Set(remotes.map((r) => r.remote_id));

  if (!existingIds.has(baseSlug)) {
    return baseSlug;
  }

  let counter = 2;
  while (existingIds.has(`${baseSlug}-${counter}`)) {
    counter++;
  }
  return `${baseSlug}-${counter}`;
}

// ============================================================================
// writes
// ============================================================================

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

  const backend = getBackend();
  const existing = await getTauriManagedRemote();

  // convert file path to asset:// URL if available
  let imageUrl: string | null = null;
  if (config.server_image_path) {
    const convert = await ensureConvertFileSrc();
    if (convert) {
      imageUrl = convert(config.server_image_path);
      console.log(
        "[upsertTauriRemote] converted server_image_path to asset URL:",
        imageUrl,
      );
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
      // clear base_url for charnel-managed remotes (they use IPC dispatch)
      // keep it for regular HTTP remotes
      ...(existing.is_charnel_managed
        ? { base_url: undefined }
        : isHttpRemote(existing)
          ? { base_url: config.base_url.replace(/\/$/, "") }
          : {}),
    };
    await backend.put(updated);
    invalidateRemoteCache(updated.remote_id);
    console.log("[upsertTauriRemote] updated existing remote:", {
      name: updated.name,
      image_url: updated.image_url,
      updated_at: updated.updated_at,
    });
    notifyStatusChange(updated.remote_id, updated.is_offline ?? false);
    return updated;
  }

  // create new tauri-managed remote (always HTTP for tauri)
  const remoteId = await generateUniqueRemoteId(config.name);
  const remote: HttpRemote = {
    transport: "http",
    remote_id: remoteId,
    name: config.name,
    // no base_url for charnel-managed - uses IPC dispatch
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
    is_charnel_managed: true,
  };
  await backend.put(remote);
  invalidateRemoteCache(remote.remote_id);
  debug(`created tauri remote: ${remote.name} (${remote.base_url})`);
  return remote;
}

// refresh tauri-managed remote's timestamp (for cache-busting server image)
export async function refreshTauriRemoteTimestamp(): Promise<void> {
  const existing = await getTauriManagedRemote();
  if (!existing) {
    debug("refreshTauriRemoteTimestamp: no tauri-managed remote found");
    return;
  }
  const updated: Remote = { ...existing, updated_at: Date.now() };
  await getBackend().put(updated);
  invalidateRemoteCache(updated.remote_id);
  debug(`refreshTauriRemoteTimestamp: updated to ${updated.updated_at}`);
  notifyStatusChange(existing.remote_id, existing.is_offline ?? false);
}

// create a new remote
export async function createRemote(data: {
  name?: string; // optional - uses server name from /api/hello if not provided
  base_url?: string; // required for HTTP remotes
  peer_addr?: string; // node_id or JSON endpoint for P2P remotes
  api_key?: string; // optional - for api key authentication
}): Promise<Remote> {
  const isP2P = !!data.peer_addr;
  const baseUrl = data.base_url?.replace(/\/$/, "") ?? "";

  if (!isP2P && !baseUrl) {
    throw new Error("base_url is required for HTTP remotes");
  }

  // check if remote with this url/peer already exists
  if (baseUrl) {
    const existingByUrl = await getRemoteByUrl(baseUrl);
    if (existingByUrl) {
      throw new Error(
        `remote already exists for this url: ${existingByUrl.name}`,
      );
    }
  }

  if (isP2P && data.peer_addr) {
    const existingByPeer = await getRemoteByPeerAddr(data.peer_addr);
    if (existingByPeer) {
      throw new Error(
        `remote already exists for this peer: ${existingByPeer.name}`,
      );
    }
  }

  // fetch server info - use async client for P2P remotes
  let serverInfo = null;
  try {
    if (isP2P) {
      const client = await getClientForRemote({
        peer_addr: data.peer_addr,
        transport: isCharnelAvailable() ? "app" : "wasm",
      });
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
  const baseName =
    data.name ||
    serverInfo.name ||
    baseUrl ||
    `p2p-${(data.peer_addr ?? "").slice(0, 8)}`;

  // disambiguate against any existing remote with the same display name.
  // the unique-id check above only protects against duplicate base_url /
  // peer_addr — two distinct servers can legitimately advertise the same
  // server.name (the default for fresh freqhole installs is "freqhole",
  // and on android it's "local library"), so we'd otherwise end up with
  // two indistinguishable rows in the remote picker.
  const allExisting = await getBackend().list();
  const takenNames = new Set(allExisting.map((r) => r.name));
  let remoteName = baseName;
  if (takenNames.has(remoteName)) {
    let counter = 2;
    while (takenNames.has(`${baseName} (${counter})`)) {
      counter++;
    }
    remoteName = `${baseName} (${counter})`;
    debug(
      `remote name "${baseName}" already in use; using "${remoteName}" instead`,
    );
  }

  const remoteId = await generateUniqueRemoteId(remoteName);

  const commonFields = {
    remote_id: remoteId,
    name: remoteName,
    is_active: false,
    last_connected_at: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    description: serverInfo.description ?? null,
    image_url: serverInfo.image_url ?? null,
    image_blob_id: serverInfo.image_blob_id ?? null,
    version: serverInfo.version,
    last_info_check: Date.now(),
    api_key: data.api_key,
  };

  const remote: Remote = isP2P
    ? ({
        ...commonFields,
        transport: isCharnelAvailable() ? "app" : "wasm",
        peer_addr: data.peer_addr!,
        base_url: baseUrl || undefined,
      } as P2PRemote)
    : ({
        ...commonFields,
        transport: "http",
        base_url: baseUrl,
      } as HttpRemote);

  await getBackend().put(remote);
  invalidateRemoteCache(remote.remote_id);
  debug(
    `created remote: ${remote.name} (${isHttpRemote(remote) ? remote.base_url : remote.peer_addr})`,
  );

  return remote;
}

// update an existing remote
export async function updateRemote(
  remoteId: string,
  updates: Partial<Pick<Remote, "name" | "base_url" | "api_key">>,
): Promise<Remote> {
  const existing = await getBackend().get(remoteId);
  if (!existing) {
    throw new Error(`remote not found: ${remoteId}`);
  }

  const updated: Remote = {
    ...existing,
    ...updates,
    updated_at: Date.now(),
  };

  if (updates.base_url) {
    updated.base_url = updates.base_url.replace(/\/$/, "");
  }

  await getBackend().put(updated);
  invalidateRemoteCache(updated.remote_id);
  debug(`updated remote: ${updated.name}`);

  return updated;
}

// delete a remote
export async function deleteRemote(remoteId: string): Promise<void> {
  const backend = getBackend();
  const existing = await backend.get(remoteId);
  if (!existing) {
    throw new Error(`remote not found: ${remoteId}`);
  }
  await backend.remove(remoteId);
  invalidateRemoteCache(remoteId);
  debug(`deleted remote: ${existing.name}`);
}

// set a remote as active (deactivates all others)
export async function setActiveRemote(remoteId: string): Promise<void> {
  const backend = getBackend();
  const remote = await backend.get(remoteId);
  if (!remote) {
    throw new Error(`remote not found: ${remoteId}`);
  }
  await backend.markActive(remoteId);
  // markActive flips is_active on every row, so blast the whole cache.
  invalidateRemoteCache();
  debug(`activated remote: ${remote.name}`);
}

// deactivate all remotes (switch to local)
export async function deactivateAllRemotes(): Promise<void> {
  const backend = getBackend();
  const all = await backend.list();
  const now = Date.now();
  for (const remote of all) {
    if (remote.is_active) {
      await backend.put({
        ...remote,
        is_active: false,
        updated_at: now,
      });
      invalidateRemoteCache(remote.remote_id);
    }
  }
  debug("deactivated all remotes (using local source)");
}

// update last_connected_at timestamp for a remote
export async function updateRemoteConnectionTime(
  remoteId: string,
): Promise<void> {
  const backend = getBackend();
  const remote = await backend.get(remoteId);
  if (!remote) return;

  await backend.put({
    ...remote,
    last_connected_at: Date.now(),
    updated_at: Date.now(),
  });
  invalidateRemoteCache(remoteId);
}

// refresh server info for a remote (fetch from /api/hello)
export async function refreshServerInfo(remoteId: string): Promise<void> {
  const backend = getBackend();
  const remote = await backend.get(remoteId);
  if (!remote) {
    throw new Error(`remote not found: ${remoteId}`);
  }

  try {
    const client = await getClientForRemote(remote);
    const result = await client.app.serverInfo();
    if (result.success && result.data) {
      const serverInfo = result.data;
      // charnel-managed remotes get name + image_url pushed locally via
      // upsertTauriRemote (asset:// urls, local config), so skip those
      // two fields here to avoid stomping the local view.
      const isCharnelManaged = !!remote.is_charnel_managed;
      await backend.put({
        ...remote,
        name:
          !isCharnelManaged && serverInfo.name ? serverInfo.name : remote.name,
        description: serverInfo.description ?? remote.description,
        image_url: isCharnelManaged
          ? remote.image_url
          : (serverInfo.image_url ?? remote.image_url),
        image_blob_id: serverInfo.image_blob_id ?? remote.image_blob_id,
        version: serverInfo.version ?? remote.version,
        last_info_check: Date.now(),
        updated_at: Date.now(),
      });
      invalidateRemoteCache(remote.remote_id);
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

// check if a remote is online (quick health check via /api/hello).
// returns true if online, false if offline. also updates server info
// (image_url, version, etc.) when online.
export async function checkRemoteHealth(remote: Remote): Promise<boolean> {
  const backend = getBackend();
  const now = Date.now();

  try {
    // use async client getter for P2P remotes (starts midden node if needed)
    const client = await getClientForRemote(remote);
    const result = await client.app.serverInfo();
    const isOnline = result.success && !!result.data;

    // re-read remote to get latest data (avoids overwriting with stale data)
    const fresh = await backend.get(remote.remote_id);
    if (!fresh) {
      debug(`health check: remote ${remote.remote_id} not found`);
      return isOnline;
    }

    const updated: Remote = {
      ...fresh,
      is_offline: !isOnline,
      last_checked: now,
      updated_at: now,
    };

    if (isOnline) {
      updated.offline_since = null;
      updated.last_connected_at = now;

      // also update server info if we got it (self-heals missing image_url, etc.)
      // but don't overwrite local image_url / name for tauri-managed remotes
      // (they use asset:// URLs and a name set from local config).
      if (result.data) {
        updated.description = result.data.description ?? updated.description;
        if (!fresh.is_charnel_managed) {
          updated.image_url = result.data.image_url ?? updated.image_url;
          if (result.data.name) {
            updated.name = result.data.name;
          }
        }
        updated.image_blob_id =
          result.data.image_blob_id ?? updated.image_blob_id;
        updated.version = result.data.version ?? updated.version;
        updated.last_info_check = now;
      }
    } else if (!fresh.is_offline) {
      updated.offline_since = now;
    }

    await backend.put(updated);
    invalidateRemoteCache(updated.remote_id);
    debug(
      `health check for ${fresh.name}: ${isOnline ? "online" : "offline"}`,
    );
    return isOnline;
  } catch (error) {
    // network error = offline - re-read before updating
    const fresh = await backend.get(remote.remote_id);
    if (fresh) {
      await backend.put({
        ...fresh,
        is_offline: true,
        last_checked: now,
        offline_since: fresh.is_offline ? fresh.offline_since : now,
        updated_at: now,
      });
      invalidateRemoteCache(fresh.remote_id);
    }
    errorLog(`health check failed for ${remote.name}:`, error);
    return false;
  }
}

// mark a remote as offline (without doing a health check)
export async function markRemoteOffline(remoteId: string): Promise<void> {
  const backend = getBackend();
  const remote = await backend.get(remoteId);
  if (!remote) return;

  const now = Date.now();
  await backend.put({
    ...remote,
    is_offline: true,
    offline_since: remote.is_offline ? remote.offline_since : now,
    last_checked: now,
    updated_at: now,
  });
  invalidateRemoteCache(remoteId);
  debug(`marked remote as offline: ${remote.name}`);
  notifyStatusChange(remoteId, true);
}

// mark a remote as online (without doing a health check)
export async function markRemoteOnline(remoteId: string): Promise<void> {
  const backend = getBackend();
  const remote = await backend.get(remoteId);
  if (!remote) return;

  const now = Date.now();
  await backend.put({
    ...remote,
    is_offline: false,
    offline_since: null,
    last_checked: now,
    last_connected_at: now,
    updated_at: now,
  });
  invalidateRemoteCache(remoteId);
  debug(`marked remote as online: ${remote.name}`);
  notifyStatusChange(remoteId, false);
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
