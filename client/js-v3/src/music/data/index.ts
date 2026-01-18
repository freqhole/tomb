// data source exports and active source management
import { createSignal } from "solid-js";
import { LocalMusicDataSource, localDataSource } from "./localSource";
import { RemoteMusicDataSource } from "./remoteSource";
import type { MusicDataSource } from "./types";

// active data source (default to local)
const [activeSource, setActiveSource] = createSignal<MusicDataSource>(localDataSource);

// get the currently active data source
export function getDataSource(): MusicDataSource {
  return activeSource();
}

// switch to local data source
export function useLocalSource(): void {
  console.log("switching to local data source");
  setActiveSource(localDataSource);
}

// switch to remote data source
export function useRemoteSource(baseUrl: string, apiKey?: string): void {
  console.log(`switching to remote data source: ${baseUrl}`);
  const remoteSource = new RemoteMusicDataSource(baseUrl, apiKey);
  setActiveSource(remoteSource);
}

// export types and classes for direct use
export type {
    Album,
    Artist,
    Genre, MusicDataSource, PaginatedResponse, Playlist, QueryParams, Song
} from "./types";

export { LocalMusicDataSource, RemoteMusicDataSource };
