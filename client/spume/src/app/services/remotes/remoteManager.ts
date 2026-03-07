// remote server management - CRUD operations for remote configurations
// auth is handled via cookies, so no credentials stored here

import { getClientForRemote, getClientForRemoteAsync, httpRemote } from "../../api/client";
import { initAppDB } from "../storage/db";
import { STORE_REMOTES, type Remote } from "../storage/types";
import { debug, error as errorLog } from "../../../utils/logger";

// callback type for remote status changes
type RemoteStatusChangeListener = (remoteId: string, isOffline: boolean) => void;

// listeners for remote status changes (offline/online)
const statusChangeListeners = new Set<RemoteStatusChangeListener>();

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
  const remotes = await db.getAll(STORE_REMOTES);
  return remotes.sort((a, b) => b.created_at - a.created_at);
}

// get the tauri-managed remote (if exists)
export async function getTauriManagedRemote(): Promise<Remote | null> {
  const db = await initAppDB();
  const remotes = await db.getAll(STORE_REMOTES);
  return remotes.find((r) => r.is_tauri_managed) ?? null;
}

// create or update the tauri-managed remote
export async function upsertTauriRemote(config: {
  server_id: string;
  name: string;
  base_url: string;
}): Promise<Remote> {
  const db = await initAppDB();
  const existing = await getTauriManagedRemote();

  if (existing) {
    // update existing remote with new config
    const updated: Remote = {
      ...existing,
      name: config.name,
      base_url: config.base_url.replace(/\/$/, ""),
      server_id: config.server_id,
      // always set image_url for tauri remotes (server serves at /api/hello/image)
      image_url: "/api/hello/image",
      updated_at: Date.now(),
    };
    await db.put(STORE_REMOTES, updated);
    debug(`updated tauri remote: ${updated.name} (${updated.base_url})`);
    return updated;
  }

  // create new tauri-managed remote
  const remoteId = sanitizeServerId(config.server_id);
  const remote: Remote = {
    remote_id: remoteId,
    name: config.name,
    base_url: config.base_url.replace(/\/$/, ""),
    is_active: false,
    last_connected_at: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    server_id: config.server_id,
    description: null,
    // server image is served at /api/hello/image
    image_url: "/api/hello/image",
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
  return db.get(STORE_REMOTES, remoteId);
}

// get remote by url
export async function getRemoteByUrl(url: string): Promise<Remote | undefined> {
  const remotes = await getAllRemotes();
  return remotes.find((r) => r.base_url === url);
}

// get currently active remote (if any)
export async function getActiveRemote(): Promise<Remote | null> {
  const db = await initAppDB();
  const remotes = await db.getAllFromIndex(STORE_REMOTES, "by_is_active", 1);
  return remotes[0] || null;
}

// sanitize server id for url safety (alphanumeric, dash, underscore only)
function sanitizeServerId(serverId: string): string {
  return serverId
    .replace(/[^a-zA-Z0-9_-]/g, "-") // replace invalid chars with hyphens
    .replace(/-+/g, "-") // collapse multiple hyphens
    .replace(/^-|-$/g, "") // trim leading/trailing hyphens
    .toLowerCase();
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

  // fetch server info - use async client for P2P remotes
  let serverInfo = null;
  try {
    if (isP2P) {
      const client = await getClientForRemoteAsync({ remote_id: "temp", peer_addr: data.peer_addr });
      const result = await client.app.serverInfo();
      if (result.success && result.data) {
        serverInfo = result.data;
      }
    } else {
      const result = await getClientForRemote(httpRemote(baseUrl)).app.serverInfo();
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

  // use server_id as the remote_id (sanitized for URL safety)
  const remoteId = sanitizeServerId(serverInfo.server_id);

  // check if remote with this id already exists
  const existingById = await getRemoteById(remoteId);
  if (existingById) {
    throw new Error(`remote already exists with id "${remoteId}" (${existingById.name})`);
  }

  // use server name from /api/hello if no name provided
  const remoteName = data.name || serverInfo.name || baseUrl || `p2p-${remoteId.slice(0, 8)}`;

  const remote: Remote = {
    remote_id: remoteId,
    name: remoteName,
    base_url: baseUrl,
    peer_addr: data.peer_addr,
    is_active: false,
    last_connected_at: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    // server info fields
    server_id: serverInfo.server_id,
    description: serverInfo.description ?? null,
    image_url: serverInfo.image_url ?? null,
    version: serverInfo.version,
    last_info_check: Date.now(),
    // api key auth (optional)
    api_key: data.api_key,
  };

  await db.put(STORE_REMOTES, remote);
  debug(`created remote: ${remote.name} (${remote.base_url})`);

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
    const result = await getClientForRemote(remote).app.serverInfo();
    if (result.success && result.data) {
      const serverInfo = result.data;
      await db.put(STORE_REMOTES, {
        ...remote,
        server_id: serverInfo.server_id,
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

// check if a remote uses P2P transport
export function isP2PTransport(remote: Remote): boolean {
  const transportType = remote.transport_type ?? (remote.peer_addr ? 'wasm' : 'http');
  return transportType === 'wasm';
}

// check if a remote is online (quick health check via /api/hello)
// returns true if online, false if offline
// also updates server info (image_url, version, etc.) when online
export async function checkRemoteHealth(remote: Remote): Promise<boolean> {
  const db = await initAppDB();
  const now = Date.now();

  try {
    // use async client getter for P2P remotes (starts midden node if needed)
    const client = await getClientForRemoteAsync(remote);
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
      if (result.data) {
        updated.server_id = result.data.server_id;
        updated.description = result.data.description ?? updated.description;
        updated.image_url = result.data.image_url ?? updated.image_url;
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

