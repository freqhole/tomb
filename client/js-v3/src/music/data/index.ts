// data source exports and active source management
// integrates with remote management to auto-switch between local and remote sources

import { createEffect, createSignal } from "solid-js";
import { getActiveRemote } from "../services/remotes/remoteManager";
import { LocalMusicDataSource, localDataSource } from "./localSource";
import { RemoteMusicDataSource } from "./remoteSource";
import type { MusicDataSource } from "./types";

// active data source (default to local)
const [activeSource, setActiveSource] =
  createSignal<MusicDataSource>(localDataSource);

// current remote info (for display)
const [currentRemote, setCurrentRemote] = createSignal<{
  id: string;
  name: string;
  url: string;
} | null>(null);

// get the currently active data source
export function getDataSource(): MusicDataSource {
  return activeSource();
}

// get current remote info (null if using local)
export function getCurrentRemote() {
  return currentRemote();
}

// switch to local data source
export function useLocalSource(): void {
  console.log("switching to local data source");
  setActiveSource(localDataSource);
  setCurrentRemote(null);
}

// switch to remote data source
export function useRemoteSource(
  remoteId: string,
  name: string,
  baseUrl: string,
): void {
  console.log(`switching to remote data source: ${name} (${baseUrl})`);
  const remoteSource = new RemoteMusicDataSource(baseUrl);
  setActiveSource(remoteSource);
  setCurrentRemote({ id: remoteId, name, url: baseUrl });
}

// initialize data source based on stored active remote
// call this on app startup
export async function initializeDataSource(): Promise<void> {
  try {
    const activeRemote = await getActiveRemote();

    if (activeRemote) {
      console.log(
        `found active remote: ${activeRemote.name} (${activeRemote.base_url})`,
      );
      useRemoteSource(
        activeRemote.remote_id,
        activeRemote.name,
        activeRemote.base_url,
      );
    } else {
      console.log("no active remote, using local source");
      useLocalSource();
    }
  } catch (error) {
    console.error("failed to initialize data source, using local:", error);
    useLocalSource();
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
