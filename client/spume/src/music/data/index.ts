// data source exports and active source management
// integrates with remote management to auto-switch between local and remote sources

import { getClientForRemote, type ApiClient, type RemoteRef, type UserRoleName } from "../../app/api/client";
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
import { preCacheRemoteTransport } from "../services/storage/blobResolver";
import {
  getCurrentUser,
  setCurrentUserState,
  getCurrentRemote,
  setCurrentRemoteState,
  type CurrentUser,
} from "./currentState";
import { patchAuthInfo } from "../../app/services/remotes/authStatusStore";

// re-export from currentState for backward compatibility
export { getCurrentUser, getCurrentRemote, type CurrentUser };

// active data source (default to local)
const [activeSource, setActiveSource] =
  createSignal<MusicDataSource>(localDataSource);

// get the currently active data source
export function getDataSource(): MusicDataSource {
  return activeSource();
}

/**
 * get a client for the current active remote.
 * returns null if no remote is active (using local source).
 * this is the main entry point for making API calls - handles transport selection.
 */
export async function getRemoteClient(): Promise<ApiClient | null> {
  const remote = getCurrentRemote();
  if (!remote) return null;
  return getClientForRemote(remote);
}

// switch to local data source
export async function useLocalSource(): Promise<void> {
  debug("switching to local data source");
  setActiveSource(localDataSource);
  setCurrentRemoteState(null);
  setCurrentUserState(null);

  // persist to app state and deactivate all remotes
  await setActiveRemoteId(null);
  await deactivateAllRemotes();
}

// switch to remote data source
export async function useRemoteSource(remote: RemoteRef): Promise<void> {
  // require remote_id for switching
  const remoteId = remote.remote_id;
  if (!remoteId) {
    throw new Error("remote_id required to switch remote source");
  }
  
  // pre-cache transport info for blob resolution (prevents flicker on image load)
  await preCacheRemoteTransport(remoteId);
  
  const resolvedName = remote.name ?? remote.base_url ?? `p2p-${remoteId.slice(0, 8)}`;
  const resolvedAddress = remote.base_url || remote.peer_addr;
  debug(`switching to remote data source: ${resolvedName} (${resolvedAddress})`);
  const remoteSource = new RemoteMusicDataSource(remote);
  setActiveSource(remoteSource);
  setCurrentRemoteState({
    remote_id: remoteId,
    name: resolvedName,
    base_url: remote.base_url,
    transport_type: remote.transport ?? remote.transport_type,
    peer_addr: remote.peer_addr,
    is_charnel_managed: remote.is_charnel_managed,
  });

  // fetch current user info from whoami (uses session cookies)
  try {
    const client = await getClientForRemote(remote);
    const whoamiResult = await client.auth.whoami();
    if (whoamiResult.success && whoamiResult.data) {
      setCurrentUserState({
        userId: whoamiResult.data.user_id,
        username: whoamiResult.data.username,
        role: whoamiResult.data.role as UserRoleName,
      });
      // mirror into the global auth status store so any view that gates
      // on admin role (graph viz edit buttons, etc.) sees the freshly
      // authenticated state without needing its own whoami round-trip.
      patchAuthInfo(remoteId, {
        loggedIn: true,
        username: whoamiResult.data.username,
        role: whoamiResult.data.role,
      });
      debug(`authenticated as user: ${whoamiResult.data.username} (${whoamiResult.data.user_id}), role: ${whoamiResult.data.role}`);
    } else {
      setCurrentUserState(null);
      patchAuthInfo(remoteId, { loggedIn: false });
    }
  } catch {
    setCurrentUserState(null);
  }

  // persist to app state and mark remote as active
  await setActiveRemoteId(remoteId);
  await setActiveRemote(remoteId);
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
