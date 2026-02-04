// remote server management - CRUD operations for remote configurations
// auth is handled via cookies, so no credentials stored here

import { app } from "freqhole-api-client";
import { initAppDB } from "../../../app/services/storage/db";
import { STORE_REMOTES, type Remote } from "../../../app/services/storage/types";

// get all remotes
export async function getAllRemotes(): Promise<Remote[]> {
  const db = await initAppDB();
  const remotes = await db.getAll(STORE_REMOTES);
  return remotes.sort((a, b) => b.created_at - a.created_at);
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
  base_url: string;
}): Promise<Remote> {
  const db = await initAppDB();

  // normalize url - remove trailing slash
  const baseUrl = data.base_url.replace(/\/$/, "");

  // check if remote with this url already exists
  const existingByUrl = await getRemoteByUrl(baseUrl);
  if (existingByUrl) {
    throw new Error(`remote already exists for this url: ${existingByUrl.name}`);
  }

  // fetch server info from /api/hello
  let serverInfo = null;
  try {
    const result = await app.getServerInfo(baseUrl);
    if (result.success && result.data) {
      serverInfo = result.data;
    }
  } catch (error) {
    console.warn(`failed to fetch server info from ${baseUrl}:`, error);
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
  const remoteName = data.name || serverInfo.name || baseUrl;

  const remote: Remote = {
    remote_id: remoteId,
    name: remoteName,
    base_url: baseUrl,
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
  };

  await db.put(STORE_REMOTES, remote);
  console.log(`created remote: ${remote.name} (${remote.base_url})`);

  return remote;
}

// update an existing remote
export async function updateRemote(
  remoteId: string,
  updates: Partial<Pick<Remote, "name" | "base_url">>,
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
  console.log(`updated remote: ${updated.name}`);

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
  console.log(`deleted remote: ${existing.name}`);
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

  console.log(`activated remote: ${remote.name}`);
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

  console.log("deactivated all remotes (using local source)");
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
    const result = await app.getServerInfo(remote.base_url);
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
      console.log(`refreshed server info for: ${remote.name}`);
    }
  } catch (error) {
    console.warn(`failed to refresh server info for ${remote.name}:`, error);
    throw error;
  }
}
