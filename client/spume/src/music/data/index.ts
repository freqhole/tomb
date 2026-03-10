// data source exports and active source management
// integrates with remote management to auto-switch between local and remote sources

import { getClientForRemote, type ApiClient, type RemoteRef, type UserRoleName, type TransportType } from "../../app/api/client";
import { createSignal } from "solid-js";
import { appState, setActiveRemoteId } from "../../app/services/storage/db";
import {
  deactivateAllRemotes,
  getRemoteById,
  markRemoteOffline,
  setActiveRemote,
} from "../../app/services/remotes/remoteManager";
import { LocalMusicDataSource, localDataSource } from "./local/localSource";
import { RemoteMusicDataSource, RemoteOfflineError } from "./remote/remoteSource";
import type { MusicDataSource } from "./types";
import { debug, warn, error as errorLog } from "../../utils/logger";

// active data source (default to local)
const [activeSource, setActiveSource] =
  createSignal<MusicDataSource>(localDataSource);

// current remote info (for display and client creation)
const [currentRemote, setCurrentRemote] = createSignal<{
  remote_id: string;
  name: string;
  base_url?: string; // empty for P2P remotes
  api_key?: string;
  transport_type?: TransportType;
  peer_addr?: string; // for P2P remotes
} | null>(null);

// current authenticated user info (per remote)
export interface CurrentUser {
  userId: string;
  username: string;
  role: UserRoleName;
}
const [currentUser, setCurrentUser] = createSignal<CurrentUser | null>(null);

// get the current authenticated user (null if not connected to remote or not authenticated)
export function getCurrentUser(): CurrentUser | null {
  return currentUser();
}

// get the currently active data source
export function getDataSource(): MusicDataSource {
  return activeSource();
}

// get current remote info (null if using local)
export function getCurrentRemote() {
  return currentRemote();
}

/**
 * get a client for the current active remote.
 * returns null if no remote is active (using local source).
 * this is the main entry point for making API calls - handles transport selection.
 */
export async function getRemoteClient(): Promise<ApiClient | null> {
  const remote = currentRemote();
  if (!remote) return null;
  return getClientForRemote(remote);
}

// switch to local data source
export async function useLocalSource(): Promise<void> {
  debug("switching to local data source");
  setActiveSource(localDataSource);
  setCurrentRemote(null);
  setCurrentUser(null);

  // persist to app state and deactivate all remotes
  await setActiveRemoteId(null);
  await deactivateAllRemotes();
}

// switch to remote data source
export async function useRemoteSource(remote: RemoteRef): Promise<void> {
  const remoteName = remote.name ?? remote.base_url ?? `p2p-${remote.remote_id.slice(0, 8)}`;
  debug(`switching to remote data source: ${remoteName} (${remote.base_url || remote.peer_addr})`);
  const remoteSource = new RemoteMusicDataSource(remote);
  setActiveSource(remoteSource);
  setCurrentRemote({
    remote_id: remote.remote_id,
    name: remoteName,
    base_url: remote.base_url,
    api_key: remote.api_key,
    transport_type: remote.transport_type,
    peer_addr: remote.peer_addr,
  });

  // fetch current user info from whoami (uses session cookies)
  try {
    const client = await getClientForRemote(remote);
    const whoamiResult = await client.auth.whoami();
    if (whoamiResult.success && whoamiResult.data) {
      setCurrentUser({
        userId: whoamiResult.data.user_id,
        username: whoamiResult.data.username,
        role: whoamiResult.data.role as UserRoleName,
      });
      debug(`authenticated as user: ${whoamiResult.data.username} (${whoamiResult.data.user_id}), role: ${whoamiResult.data.role}`);
    } else {
      setCurrentUser(null);
    }
  } catch {
    setCurrentUser(null);
  }

  // persist to app state and mark remote as active
  await setActiveRemoteId(remote.remote_id);
  await setActiveRemote(remote.remote_id);
}

// check if remote is accessible by making a lightweight request
async function checkRemoteAccessible(remote: RemoteRef): Promise<boolean> {
  try {
    const client = await getClientForRemote(remote);
    // try whoami first - if we're authenticated, the remote is accessible
    const whoamiResult = await client.auth.whoami();
    if (whoamiResult.success) {
      return true;
    }

    // if not authenticated, try health check to verify server is reachable
    const healthResult = await client.app.healthCheck();
    return healthResult.success;
  } catch (error) {
    warn(`remote health check failed for ${remote.base_url}:`, error);
    return false;
  }
}

// initialize data source based on stored active remote
// call this on app startup
export async function initializeDataSource(): Promise<void> {
  try {
    const state = appState();
    const activeRemoteId = state?.active_remote_id;

    if (activeRemoteId) {
      debug(`checking stored active remote: ${activeRemoteId}`);

      // get remote from db
      const remote = await getRemoteById(activeRemoteId);

      if (!remote) {
        warn(`stored remote not found: ${activeRemoteId}, using local`);
        await useLocalSource();
        return;
      }

      // check if remote is accessible
      debug(
        `verifying remote accessibility: ${remote.name} (${remote.base_url})`,
      );
      const isAccessible = await checkRemoteAccessible(remote);

      if (isAccessible) {
        debug(`remote accessible, activating: ${remote.name}`);
        await useRemoteSource(remote);
      } else {
        // mark remote as offline in IDB so other code paths see the status
        await markRemoteOffline(remote.remote_id);
        warn(`remote not accessible: ${remote.name}, using local`);
        await useLocalSource();
      }
    } else {
      debug("no active remote, using local source");
      await useLocalSource();
    }
  } catch (error) {
    errorLog("failed to initialize data source, using local:", error);
    await useLocalSource();
  }
}

// export types and classes for direct use
export type {
  AlbumSummary,
  ArtistSummary,
  GenreSummary,
  MusicDataSource,
  PaginatedResponse,
  QueryParams,
  Song,
} from "./types";

export { LocalMusicDataSource, RemoteMusicDataSource, RemoteOfflineError };
