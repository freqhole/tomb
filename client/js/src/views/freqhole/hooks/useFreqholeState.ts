/* @jsxImportSource solid-js */
import { onMount } from "solid-js";
import { useMusicState } from "./useMusicState";
import { usePlayerState } from "./usePlayerState";
import { useViewState } from "./useViewState";
import type { Song, Playlist, Album, ArtistSummary } from "./usePlayerQueue.js";

export interface FreqholeStateActions {
  // Combined actions that work across state domains
  playAndQueue: (song: Song) => void;
  addToPlaylistWithModal: (songs: Song[]) => void;
  playPlaylistAndView: (playlist: Playlist) => Promise<void>;
  playArtistAndView: (artist: ArtistSummary) => Promise<void>;
  playAlbumAndView: (album: Album) => Promise<void>;

  // Playlist management with UI updates
  createPlaylistWithModal: () => Promise<void>;
  updatePlaylistWithModal: () => Promise<void>;
  addSongsToPlaylistWithModal: () => Promise<void>;

  // Combined cleanup and initialization
  initialize: () => Promise<void>;
  cleanup: () => void;
}

export const useFreqholeState = () => {
  // Initialize all state hooks
  const music = useMusicState();
  const player = usePlayerState();
  const view = useViewState();

  // Initialize data on mount
  onMount(async () => {
    await initialize();
  });

  // Combined initialization
  const initialize = async () => {
    try {
      // Load initial data
      await music.actions.fetchData(music.state.currentView());
      await music.actions.ensurePlaylistsLoaded();
    } catch (error) {
      console.error("Failed to initialize Freqhole state:", error);
    }
  };

  // Combined cleanup
  const cleanup = () => {
    // Close any open modals
    view.actions.closePlaylistModal();
    view.actions.closePlaylistDropdown();

    // Clear any errors
    music.actions.clearError();
    player.clearPlayerError();

    // Stop playback
    player.stop();
  };

  // Play song and add to queue if needed
  const playAndQueue = (song: Song) => {
    player.playSong(song, true);
  };

  // Open playlist modal with selected songs
  const addToPlaylistWithModal = (songs: Song[]) => {
    view.actions.openCreatePlaylistModal(songs);
  };

  // Play playlist and view its details
  const playPlaylistAndView = async (playlist: Playlist) => {
    await Promise.all([
      music.actions.viewPlaylist(playlist),
      player.playPlaylist(playlist),
    ]);
  };

  // Play artist and view their songs
  const playArtistAndView = async (artist: ArtistSummary) => {
    await Promise.all([
      music.actions.viewArtist(artist),
      player.playArtist(artist),
    ]);
  };

  // Play album and view its tracks
  const playAlbumAndView = async (album: Album) => {
    await Promise.all([
      music.actions.viewAlbum(album),
      player.playAlbum(album),
    ]);
  };

  // Create playlist with modal management
  const createPlaylistWithModal = async () => {
    const form = view.state.playlistForm();
    const selectedSongs = view.state.selectedSongs();

    try {
      await music.actions.createPlaylist(form);

      // If songs were selected, add them to the new playlist
      if (selectedSongs.length > 0) {
        // Note: This would need the playlist ID from the create response
        // For now, we'll just close the modal
        view.actions.clearSelectedSongs();
      }

      view.actions.closePlaylistModal();
    } catch (error) {
      console.error("Failed to create playlist:", error);
    }
  };

  // Update playlist with modal management
  const updatePlaylistWithModal = async () => {
    const form = view.state.playlistForm();
    const editingPlaylist = view.state.editingPlaylist();

    if (!editingPlaylist) return;

    try {
      await music.actions.updatePlaylist(editingPlaylist.id, form);
      view.actions.closePlaylistModal();
    } catch (error) {
      console.error("Failed to update playlist:", error);
    }
  };

  // Add songs to playlist with modal management
  const addSongsToPlaylistWithModal = async () => {
    const selectedSongs = view.state.selectedSongs();
    const editingPlaylist = view.state.editingPlaylist();

    if (!editingPlaylist || selectedSongs.length === 0) return;

    try {
      await music.actions.addSongsToPlaylist(editingPlaylist.id, selectedSongs);
      view.actions.closePlaylistModal();
    } catch (error) {
      console.error("Failed to add songs to playlist:", error);
    }
  };

  // Combined view change with transition
  const changeViewWithTransition = async (
    newView: "music" | "artists" | "albums" | "playlists"
  ) => {
    view.actions.setViewTransition("exiting");

    setTimeout(() => {
      music.actions.changeView(newView);
      view.actions.setViewTransition("entering");

      setTimeout(() => {
        view.actions.setViewTransition("idle");
      }, 200);
    }, 100);
  };

  // Get combined loading state
  const isLoading = () => {
    return music.state.loading() || player.isLoading();
  };

  // Get combined error state
  const getError = () => {
    return music.state.error() || player.playerError();
  };

  // Clear all errors
  const clearAllErrors = () => {
    music.actions.clearError();
    player.clearPlayerError();
  };

  return {
    // Individual state hooks
    music,
    player,
    view,

    // Combined state
    isLoading,
    getError,

    // Combined actions
    actions: {
      // Initialization
      initialize,
      cleanup,

      // Playback
      playAndQueue,
      playPlaylistAndView,
      playArtistAndView,
      playAlbumAndView,

      // Playlist management
      addToPlaylistWithModal,
      createPlaylistWithModal,
      updatePlaylistWithModal,
      addSongsToPlaylistWithModal,

      // View management
      changeViewWithTransition,

      // Error handling
      clearAllErrors,
    },
  };
};
