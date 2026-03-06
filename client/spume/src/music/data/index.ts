// data source exports and active source management
// integrates with remote management to auto-switch between local and remote sources

import { createHttpClient, type UserRoleName } from "../../app/api/client";
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

// current remote info (for display)
const [currentRemote, setCurrentRemote] = createSignal<{
  remote_id: string;
  name: string;
  base_url: string;
  api_key?: string;
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
export async function useRemoteSource(
  remoteId: string,
  name: string,
  baseUrl: string,
): Promise<void> {
  debug(`switching to remote data source: ${name} (${baseUrl})`);
  const remoteSource = new RemoteMusicDataSource(baseUrl, remoteId);
  setActiveSource(remoteSource);
  setCurrentRemote({ remote_id: remoteId, name, base_url: baseUrl });

  // fetch current user info from whoami (uses session cookies)
  try {
    const client = createHttpClient(baseUrl);
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
  await setActiveRemoteId(remoteId);
  await setActiveRemote(remoteId);
}

// check if remote is accessible by making a lightweight request
async function checkRemoteAccessible(baseUrl: string): Promise<boolean> {
  try {
    const client = createHttpClient(baseUrl);
    // try whoami first - if we're authenticated, the remote is accessible
    const whoamiResult = await client.auth.whoami();
    if (whoamiResult.success) {
      return true;
    }

    // if not authenticated, try health check to verify server is reachable
    const healthResult = await client.app.healthCheck();
    return healthResult.success;
  } catch (error) {
    warn(`remote health check failed for ${baseUrl}:`, error);
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
      const isAccessible = await checkRemoteAccessible(remote.base_url);

      if (isAccessible) {
        debug(`remote accessible, activating: ${remote.name}`);
        await useRemoteSource(remote.remote_id, remote.name, remote.base_url);
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
