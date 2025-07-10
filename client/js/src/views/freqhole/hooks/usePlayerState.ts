/* @jsxImportSource solid-js */
import { createSignal } from "solid-js";
import { usePlayerQueue } from "./usePlayerQueue";
import { apiClient } from "../../../lib/api-client.js";
import type {
  Song,
  Album,
  ArtistSummary,
  Playlist,
  PlaylistSong,
} from "./usePlayerQueue.js";

export interface PlayerStateActions {
  // High-level play operations
  playPlaylist: (playlist: Playlist) => Promise<void>;
  playArtist: (artist: ArtistSummary) => Promise<void>;
  playAlbum: (album: Album) => Promise<void>;

  // Utility functions
  formatTime: (seconds: number) => string;
  seekTo: (percentage: number) => void;

  // Error handling
  clearPlayerError: () => void;
}

export const usePlayerState = () => {
  const playerQueue = usePlayerQueue({
    initialVolume: 0.7,
    autoPlay: true,
    autoNext: true,
  });

  const [playerError, setPlayerError] = createSignal<string | null>(null);

  // Transform song data to match expected format
  const transformSong = (song: any): Song => ({
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    duration_seconds: song.duration_seconds,
    thumbnail_blob_id: song.thumbnail_blob_id,
    media_blob_id: song.id,
  });

  // Transform album track data
  const transformAlbumTrack = (track: any, album: Album): Song => ({
    id: track.song_id,
    title: track.title,
    artist: track.artist,
    album: album.album,
    duration_seconds: track.duration
      ? parseFloat(
          track.duration
            .split(":")
            .reduce((acc: number, time: string) => 60 * acc + +time)
        )
      : undefined,
    thumbnail_blob_id: track.thumbnail_id,
    media_blob_id: track.media_blob_id,
  });

  // Play entire playlist
  const playPlaylist = async (playlist: Playlist) => {
    try {
      setPlayerError(null);
      const songs = await apiClient.getPlaylistSongs(playlist.id);

      if (songs.length > 0) {
        const transformedSongs = songs.map((song) => transformSong(song));

        // Convert to playlist songs format for queue
        const playlistSongs: PlaylistSong[] = transformedSongs.map(
          (song, index) => ({
            position: index + 1,
            song,
            added_at: new Date().toISOString(),
          })
        );

        playerQueue.setQueueFromPlaylist(
          {
            ...playlist,
            description: playlist.description || undefined,
            song_count: playlist.song_count || undefined,
          },
          playlistSongs
        );
      }
    } catch (err) {
      setPlayerError(
        err instanceof Error ? err.message : "Failed to load playlist"
      );
    }
  };

  // Play all songs from an artist
  const playArtist = async (artist: ArtistSummary) => {
    try {
      setPlayerError(null);
      const songs = await apiClient.getArtistSongs(artist.artist, 1000);

      if (songs.length > 0) {
        const transformedSongs = songs.map(transformSong);
        playerQueue.setQueueFromArtist(artist, transformedSongs);
      }
    } catch (err) {
      setPlayerError(
        err instanceof Error ? err.message : "Failed to load artist songs"
      );
    }
  };

  // Play all tracks from an album
  const playAlbum = async (album: Album) => {
    try {
      setPlayerError(null);
      const tracks = await apiClient.getAlbumTracks(
        album.album || "",
        album.artist || ""
      );

      if (tracks.length > 0) {
        const transformedSongs = tracks.map((track) =>
          transformAlbumTrack(track, album)
        );
        playerQueue.setQueueFromAlbum(album, transformedSongs);
      }
    } catch (err) {
      setPlayerError(
        err instanceof Error ? err.message : "Failed to load album tracks"
      );
    }
  };

  // Format time helper
  const formatTime = (seconds: number): string => {
    if (isNaN(seconds) || seconds < 0) return "0:00";
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  // Seek to percentage
  const seekTo = (percentage: number) => {
    const audio = playerQueue.audioElement();
    const dur = playerQueue.duration();

    if (!audio || !dur) return;

    const seekTime = (percentage / 100) * dur;
    audio.currentTime = seekTime;
  };

  // Clear player error
  const clearPlayerError = () => {
    setPlayerError(null);
  };

  return {
    // All player queue functionality
    ...playerQueue,

    // Additional player error state
    playerError,

    // High-level actions
    playPlaylist,
    playArtist,
    playAlbum,
    formatTime,
    seekTo,
    clearPlayerError,
  };
};
