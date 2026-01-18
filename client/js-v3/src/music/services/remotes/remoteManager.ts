// remote server management - CRUD operations for remote configurations
// auth is handled via cookies, so no credentials stored here

import { initMusicDB } from "../storage/db";
import { STORE_REMOTES, type Remote } from "../storage/types";

// get all remotes
export async function getAllRemotes(): Promise<Remote[]> {
  const db = await initMusicDB();
  const remotes = await db.getAll(STORE_REMOTES);
  return remotes.sort((a, b) => b.created_at - a.created_at);
}

// get remote by id
export async function getRemoteById(
  remoteId: string,
): Promise<Remote | undefined> {
  const db = await initMusicDB();
  return db.get(STORE_REMOTES, remoteId);
}

// get currently active remote (if any)
export async function getActiveRemote(): Promise<Remote | null> {
  const db = await initMusicDB();
  const remotes = await db.getAllFromIndex(STORE_REMOTES, "by_is_active", 1);
  return remotes[0] || null;
}

// create a new remote
export async function createRemote(data: {
  name: string;
  base_url: string;
}): Promise<Remote> {
  const db = await initMusicDB();

  // normalize url - remove trailing slash
  const baseUrl = data.base_url.replace(/\/$/, "");

  const remote: Remote = {
    remote_id: crypto.randomUUID(),
    name: data.name,
    base_url: baseUrl,
    is_active: false,
    last_connected_at: null,
    created_at: Date.now(),
    updated_at: Date.now(),
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
  const db = await initMusicDB();

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
  const db = await initMusicDB();

  const existing = await db.get(STORE_REMOTES, remoteId);
  if (!existing) {
    throw new Error(`remote not found: ${remoteId}`);
  }

  await db.delete(STORE_REMOTES, remoteId);
  console.log(`deleted remote: ${existing.name}`);
}

// set a remote as active (deactivates all others)
export async function setActiveRemote(remoteId: string): Promise<void> {
  const db = await initMusicDB();

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
  const db = await initMusicDB();

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
  const db = await initMusicDB();

  const remote = await db.get(STORE_REMOTES, remoteId);
  if (!remote) return;

  await db.put(STORE_REMOTES, {
    ...remote,
    last_connected_at: Date.now(),
    updated_at: Date.now(),
  });
}
