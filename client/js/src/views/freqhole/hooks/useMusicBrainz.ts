import { createSignal, createResource } from "solid-js";
import { apiClient } from "../../../lib/api-client";
import type { Song } from "../../../lib/music/schemas/song";
import type {
  MusicBrainzMatch,
  MusicBrainzSearchRequest,
  SongWithMatches,
} from "../../../lib/musicbrainz/api-methods";

export interface UseMusicBrainzOptions {
  onError?: (error: string) => void;
  onSuccess?: (message: string) => void;
}

export function useMusicBrainz(options: UseMusicBrainzOptions = {}) {
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // get musicbrainz configuration
  const [config] = createResource(async () => {
    try {
      return await apiClient.getMusicBrainzConfig();
    } catch (err) {
      console.error("failed to load musicbrainz config:", err);
      return null;
    }
  });

  // get matches for songs
  const getMatches = async (songs: Song[]): Promise<SongWithMatches[]> => {
    if (songs.length === 0) return [];

    try {
      setIsLoading(true);
      setError(null);

      const songIds = songs.map(s => s.id);
      const response = await apiClient.getSongMatches(songIds);

      return response.songs;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "failed to load matches";
      setError(errorMessage);
      options.onError?.(errorMessage);
      return [];
    } finally {
      setIsLoading(false);
    }
  };

  // search musicbrainz
  const search = async (query: MusicBrainzSearchRequest): Promise<MusicBrainzMatch[]> => {
    if (!query.title && !query.artist && !query.album) {
      const errorMessage = "please provide at least one search term";
      setError(errorMessage);
      options.onError?.(errorMessage);
      return [];
    }

    try {
      setIsLoading(true);
      setError(null);

      const response = await apiClient.searchMusicBrainz(query);
      return response.results;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "search failed";
      setError(errorMessage);
      options.onError?.(errorMessage);
      return [];
    } finally {
      setIsLoading(false);
    }
  };

  // apply match to songs
  const applyMatch = async (songs: Song[], match: MusicBrainzMatch): Promise<boolean> => {
    if (songs.length === 0) {
      const errorMessage = "no songs provided";
      setError(errorMessage);
      options.onError?.(errorMessage);
      return false;
    }

    try {
      setIsLoading(true);
      setError(null);

      const songIds = songs.map(s => s.id);
      await apiClient.applyMusicBrainzMetadata(songIds, match);

      const successMessage = `applied musicbrainz metadata to ${songIds.length} song${songIds.length === 1 ? "" : "s"}`;
      options.onSuccess?.(successMessage);
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "failed to apply metadata";
      setError(errorMessage);
      options.onError?.(errorMessage);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  // scan songs for matches
  const scanForMatches = async (
    songs: Song[],
    scanOptions?: {
      force_rescan?: boolean;
      confidence_threshold?: number;
    }
  ): Promise<SongWithMatches[]> => {
    if (songs.length === 0) return [];

    try {
      setIsLoading(true);
      setError(null);

      const songIds = songs.map(s => s.id);
      const response = await apiClient.scanSongsForMatches(songIds, scanOptions);

      return response.songs;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "scan failed";
      setError(errorMessage);
      options.onError?.(errorMessage);
      return [];
    } finally {
      setIsLoading(false);
    }
  };

  // clear error state
  const clearError = () => setError(null);

  return {
    // state
    config,
    isLoading,
    error,

    // actions
    getMatches,
    search,
    applyMatch,
    scanForMatches,
    clearError,

    // computed
    isEnabled: () => config()?.enabled ?? false,
  };
}
