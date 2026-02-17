// data source exports and active source management
// integrates with remote management to auto-switch between local and remote sources

import * as apiClient from "freqhole-api-client";
import { createSignal } from "solid-js";
import { appState, setActiveRemoteId } from "../../app/services/storage/db";
import {
  deactivateAllRemotes,
  getRemoteById,
  setActiveRemote,
} from "../../app/services/remotes/remoteManager";
import { LocalMusicDataSource, localDataSource } from "./local/localSource";
import { RemoteMusicDataSource } from "./remote/remoteSource";
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
} | null>(null);

// current authenticated user id (per remote)
const [currentUserId, setCurrentUserId] = createSignal<string | null>(null);

// get the current authenticated user id
export function getCurrentUserId() {
  return currentUserId();
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
  setCurrentUserId(null);

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

  // fetch current user id from whoami
  try {
    const whoamiResult = await apiClient.auth.whoami(baseUrl);
    if (whoamiResult.success && whoamiResult.data) {
      setCurrentUserId(whoamiResult.data.user_id);
      debug(`authenticated as user: ${whoamiResult.data.username} (${whoamiResult.data.user_id})`);
    } else {
      setCurrentUserId(null);
    }
  } catch {
    setCurrentUserId(null);
  }

  // persist to app state and mark remote as active
  await setActiveRemoteId(remoteId);
  await setActiveRemote(remoteId);
}

// check if remote is accessible by making a lightweight request
async function checkRemoteAccessible(baseUrl: string): Promise<boolean> {
  try {
    // try whoami first - if we're authenticated, the remote is accessible
    const whoamiResult = await apiClient.auth.whoami(baseUrl);
    if (whoamiResult.success) {
      return true;
    }

    // if not authenticated, try health check to verify server is reachable
    const healthResult = await apiClient.app.healthCheck(baseUrl);
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

export { LocalMusicDataSource, RemoteMusicDataSource };
