import { createSignal, createRoot } from "solid-js";
import { useGlobalEvents } from "../hooks/useGlobalEvents";
import type { Song } from "../../../lib/music/schemas/song";

/**
 * Global song state management service
 * Coordinates song updates across all components (player, songs list, etc.)
 */
export function createSongStateService() {
  const [songs, setSongs] = createSignal<Map<string, Song>>(new Map());
  const events = useGlobalEvents();

  // Update a single song in the global state
  const updateSong = (songId: string, updates: Partial<Song>) => {
    setSongs((currentSongs) => {
      const newSongs = new Map(currentSongs);
      const existingSong = newSongs.get(songId);

      if (existingSong) {
        // Check if the updates would actually change anything
        const hasChanges = Object.keys(updates).some(
          (key) =>
            existingSong[key as keyof Song] !== updates[key as keyof Song]
        );

        if (hasChanges) {
          const updatedSong = { ...existingSong, ...updates };
          newSongs.set(songId, updatedSong);
          // Updated song state for ${songId}
        }
      } else {
        console.warn(`attempted to update non-existent song: ${songId}`);
      }

      return newSongs;
    });
  };

  // Add or update multiple songs
  const setSongList = (songList: Song[]) => {
    setSongs((currentSongs) => {
      const newSongs = new Map(currentSongs);
      let updateCount = 0;

      songList.forEach((song) => {
        const existing = newSongs.get(song.id);
        // Only update if song doesn't exist or if it's actually different
        if (
          !existing ||
          existing.user_is_favorite !== song.user_is_favorite ||
          existing.user_rating !== song.user_rating ||
          existing.preference_updated_at !== song.preference_updated_at
        ) {
          newSongs.set(song.id, song);
          updateCount++;
        }
      });

      if (updateCount > 0) {
        // Updated ${updateCount} songs in global state
      }
      return newSongs;
    });
  };

  // Get a song by ID
  const getSong = (songId: string): Song | undefined => {
    return songs().get(songId);
  };

  // Get all songs as array
  const getAllSongs = (): Song[] => {
    return Array.from(songs().values());
  };

  // Listen for global events and update song state
  events.on("song:favorite", ({ song }) => {
    updateSong(song.id, { user_is_favorite: true });
  });

  events.on("song:unfavorite", ({ song }) => {
    updateSong(song.id, { user_is_favorite: false });
  });

  events.on(
    "song:rating-updated",
    ({ songId, rating }: { songId: string; rating: number }) => {
      updateSong(songId, { user_rating: rating });
    }
  );

  // Listen for targeted song updates
  events.on("songs:updated", ({ songs: updatedSongs }) => {
    setSongList(updatedSongs);
    console.log(`updated ${updatedSongs.length} songs via targeted update`);
  });

  // Clear state on data reload
  events.on("data:reload", ({ type }) => {
    if (type === "songs") {
      setSongs(new Map());
      // Cleared song state cache for reload
    }
  });

  return {
    // State accessors
    songs,
    getSong,
    getAllSongs,

    // State mutators
    updateSong,
    setSongList,

    // Utility methods
    isFavorite: (songId: string): boolean => {
      const song = getSong(songId);
      return song?.user_is_favorite || false;
    },

    getRating: (songId: string): number => {
      const song = getSong(songId);
      return song?.user_rating || 0;
    },

    // Update rating for a song
    updateRating: (songId: string, rating: number) => {
      updateSong(songId, { user_rating: rating });
    },

    // Get updated song with current state
    getUpdatedSong: (originalSong: Song): Song => {
      const cachedSong = getSong(originalSong.id);
      if (cachedSong) {
        // Merge original with all cached updates
        return {
          ...originalSong,
          ...cachedSong,
        };
      }
      return originalSong;
    },
  };
}

// Create global instance
export const songStateService = createRoot(() => createSongStateService());

// Hook for using the song state service
export function useSongState() {
  return songStateService;
}

// Helper hook for getting a specific song with live updates
export function useLiveSong(songId: string | undefined) {
  const songState = useSongState();

  if (!songId) return undefined;

  return songState.getSong(songId);
}

// Helper hook for keeping a song object in sync with global state
export function useSyncedSong(
  song: Song | null | undefined
): Song | null | undefined {
  const songState = useSongState();

  if (!song) return song;

  return songState.getUpdatedSong(song);
}
