import { createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useSongInteractions } from "../../../../services/songInteractions";
import { apiClient } from "../../../../../../lib/api-client";
import type { Album, Song } from "../../../../../../lib/music/schemas";

// Helper function for getting image URLs
export const getAlbumImageUrl = (blobId: string | null) => {
  if (!blobId) return null;
  return `${apiClient.getBaseUrl()}/api/blobs/${blobId}`;
};

// Format album duration from "HH:MM:SS" to readable format
export const formatAlbumDuration = (durationStr: string | null): string => {
  if (!durationStr) return "unknown";
  const parts = durationStr.split(":");
  if (parts.length === 3) {
    const hours = parseInt(parts[0] || "0");
    const minutes = parseInt(parts[1] || "0");
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }
  return durationStr;
};

// Album playback utilities
export function useAlbumPlayback() {
  const songInteractions = useSongInteractions();

  const playAlbum = (tracks: Song[], _albumName?: string) => {
    if (tracks.length > 0) {
      const firstTrack = tracks[0];
      if (firstTrack) {
        songInteractions.playSong(firstTrack, true); // Replace queue and start playing
        // Add remaining tracks to queue
        tracks.slice(1).forEach((track) => {
          songInteractions.queueSong(track);
        });
      }
    }
  };

  const shuffleAlbum = (tracks: Song[], _albumName?: string) => {
    if (tracks.length > 0) {
      const shuffled = [...tracks].sort(() => Math.random() - 0.5);
      const firstTrack = shuffled[0];
      if (firstTrack) {
        songInteractions.playSong(firstTrack, true); // Replace queue and start playing
        // Add remaining shuffled tracks to queue
        shuffled.slice(1).forEach((track) => {
          songInteractions.queueSong(track);
        });
      }
    }
  };

  const addAlbumToQueue = (tracks: Song[]) => {
    tracks.forEach((track) => {
      songInteractions.queueSong(track);
    });
  };

  return {
    playAlbum,
    shuffleAlbum,
    addAlbumToQueue,
  };
}

// Album navigation utilities
export function useAlbumNavigation() {
  const navigate = useNavigate();

  const navigateToAlbum = (album: Album) => {
    if (album.album) {
      const encodedAlbum = encodeURIComponent(album.album);
      navigate(`/album/${encodedAlbum}`);
    }
  };

  const navigateToArtist = (artistName: string | null) => {
    if (artistName) {
      const encodedArtist = encodeURIComponent(artistName);
      navigate(`/artist/${encodedArtist}`);
    }
  };

  const updateAlbumUrl = (album: Album) => {
    // Update URL without navigation (for split-panel views)
    if (album.album) {
      const encodedAlbum = encodeURIComponent(album.album);
      window.history.pushState(null, "", `#/album/${encodedAlbum}`);
    }
  };

  return {
    navigateToAlbum,
    navigateToArtist,
    updateAlbumUrl,
  };
}

// Album loading utilities
export function useAlbumLoader() {
  const [loadingTracks, setLoadingTracks] = createSignal(false);

  const loadAlbumTracks = async (album: Album): Promise<Song[]> => {
    if (!album?.album) return [];

    setLoadingTracks(true);

    try {
      const tracks = await apiClient.getAlbumTracks(
        album.album,
        album.artist || undefined
      );
      return tracks;
    } catch (error) {
      console.error("failed to load album tracks:", error);
      return [];
    } finally {
      setLoadingTracks(false);
    }
  };

  const findAlbumByName = async (
    albumName: string,
    artistName?: string | null
  ): Promise<Album | null> => {
    try {
      const response = await apiClient.getAlbums({ page: 1, page_size: 1000 });
      const album = response.albums.find((a) => {
        const albumMatch = a.album === albumName;
        if (!artistName) return albumMatch;
        return albumMatch && a.artist === artistName;
      });
      return album || null;
    } catch (error) {
      console.error("failed to load album summary:", error);
      return null;
    }
  };

  return {
    loadingTracks,
    loadAlbumTracks,
    findAlbumByName,
  };
}

// Scroll position management for album views
export function useAlbumScrollPosition() {
  const [scrollPosition, setScrollPosition] = createSignal(0);

  const saveScrollPosition = (container: HTMLElement | null) => {
    if (container) {
      setScrollPosition(container.scrollTop);
    }
  };

  const restoreScrollPosition = (container: HTMLElement | null) => {
    if (container && scrollPosition() > 0) {
      setTimeout(() => {
        container.scrollTop = scrollPosition();
      }, 100);
    }
  };

  const checkCameFromAlbumDetail = (): boolean => {
    const referrer = document.referrer;
    const currentHost = window.location.origin;
    return referrer.startsWith(currentHost) && referrer.includes("/album/");
  };

  return {
    scrollPosition,
    saveScrollPosition,
    restoreScrollPosition,
    checkCameFromAlbumDetail,
  };
}
