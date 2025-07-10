/* @jsxImportSource solid-js */
import { createSignal } from "solid-js";

export interface Song {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  duration_seconds?: number;
  thumbnail_blob_id?: string;
  media_blob_id: string;
}

export interface QueueItem {
  song: Song;
  id: string;
}

export interface PlaylistSong {
  position: number;
  song: Song;
  added_at: string;
}

export interface Playlist {
  id: string;
  title: string;
  description?: string;
  is_public: boolean;
  is_collaborative: boolean;
  song_count?: number;
  created_at: string;
}

export interface ArtistSummary {
  artist: string;
  song_count: number;
  album_count: number;
  total_duration: number;
  genres: string[];
  avg_rating?: number;
  favorite_count: number;
}

export interface Album {
  album: string;
  artist: string;
  year?: number;
  track_count: number;
  disc_count: number;
  total_duration: number;
  genres: string[];
  avg_rating?: number;
  favorite_count: number;
  album_thumbnail_id?: string;
}

export const useQueue = () => {
  const [playQueue, setPlayQueue] = createSignal<QueueItem[]>([]);
  const [currentQueueIndex, setCurrentQueueIndex] = createSignal(0);
  const [showQueue, setShowQueue] = createSignal(false);

  // Add a song to the queue
  const addToQueue = (song: Song) => {
    // Check if song is already in queue
    const existingItem = playQueue().find((item) => item.song.id === song.id);
    if (existingItem) return;

    const queueItem: QueueItem = {
      song,
      id: `queue-${song.id}-${Date.now()}`,
    };
    setPlayQueue((prev) => [...prev, queueItem]);
  };

  // Remove a song from the queue
  const removeFromQueue = (queueId: string) => {
    setPlayQueue((prev) => prev.filter((item) => item.id !== queueId));
  };

  // Clear the entire queue
  const clearQueue = () => {
    setPlayQueue([]);
    setCurrentQueueIndex(0);
  };

  // Move to next song in queue
  const moveToNext = () => {
    const queue = playQueue();
    const currentIndex = currentQueueIndex();
    if (currentIndex < queue.length - 1) {
      setCurrentQueueIndex(currentIndex + 1);
      return queue[currentIndex + 1];
    }
    return null;
  };

  // Move to previous song in queue
  const moveToPrevious = () => {
    const queue = playQueue();
    const currentIndex = currentQueueIndex();
    if (currentIndex > 0) {
      setCurrentQueueIndex(currentIndex - 1);
      return queue[currentIndex - 1];
    }
    return null;
  };

  // Jump to specific index in queue
  const jumpToIndex = (index: number) => {
    const queue = playQueue();
    if (index >= 0 && index < queue.length) {
      setCurrentQueueIndex(index);
      return queue[index];
    }
    return null;
  };

  // Set queue from playlist
  const setQueueFromPlaylist = (playlist: Playlist, songs: PlaylistSong[]) => {
    const newQueue: QueueItem[] = songs.map(
      (item: PlaylistSong, index: number) => ({
        song: item.song,
        id: `playlist-${playlist.id}-${index}`,
      })
    );
    setPlayQueue(newQueue);
    setCurrentQueueIndex(0);
    return newQueue.length > 0 ? newQueue[0] : null;
  };

  // Set queue from artist songs
  const setQueueFromArtist = (artist: ArtistSummary, songs: Song[]) => {
    const newQueue: QueueItem[] = songs.map(
      (song: Song, index: number) => ({
        song,
        id: `artist-${artist.artist}-${index}`,
      })
    );
    setPlayQueue(newQueue);
    setCurrentQueueIndex(0);
    return newQueue.length > 0 ? newQueue[0] : null;
  };

  // Set queue from album songs
  const setQueueFromAlbum = (album: Album, songs: Song[]) => {
    const newQueue: QueueItem[] = songs.map(
      (song: Song, index: number) => ({
        song,
        id: `album-${album.album}-${index}`,
      })
    );
    setPlayQueue(newQueue);
    setCurrentQueueIndex(0);
    return newQueue.length > 0 ? newQueue[0] : null;
  };

  // Add song to queue if empty (for single song play)
  const addToQueueIfEmpty = (song: Song) => {
    if (playQueue().length === 0) {
      const queueItem: QueueItem = {
        song,
        id: `queue-${song.id}-${Date.now()}`,
      };
      setPlayQueue([queueItem]);
      setCurrentQueueIndex(0);
    }
  };

  // Get current queue item
  const getCurrentQueueItem = () => {
    const queue = playQueue();
    const index = currentQueueIndex();
    return queue[index] || null;
  };

  // Check if can go to next
  const canGoNext = () => {
    return currentQueueIndex() < playQueue().length - 1;
  };

  // Check if can go to previous
  const canGoPrevious = () => {
    return currentQueueIndex() > 0;
  };

  // Toggle queue visibility
  const toggleQueue = () => {
    setShowQueue(!showQueue());
  };

  return {
    // State
    playQueue,
    currentQueueIndex,
    showQueue,

    // Actions
    addToQueue,
    removeFromQueue,
    clearQueue,
    moveToNext,
    moveToPrevious,
    jumpToIndex,
    setQueueFromPlaylist,
    setQueueFromArtist,
    setQueueFromAlbum,
    addToQueueIfEmpty,
    toggleQueue,

    // Getters
    getCurrentQueueItem,
    canGoNext,
    canGoPrevious,

    // Setters (for external control)
    setShowQueue,
    setCurrentQueueIndex,
  };
};
