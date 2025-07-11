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

  // Play playlist - pure player action, no view changes
  const playPlaylist = async (playlist: Playlist) => {
    // Just play the playlist, don't change views or load playlist details
    await player.playPlaylist(playlist);
  };

  // Play playlist and view its details (intentional cross-cutting workflow)
  const playPlaylistAndView = async (playlist: Playlist) => {
    // First start playing (immediate feedback)
    await player.playPlaylist(playlist);

    // Then navigate to playlist view only if we're already on playlists view
    const currentView = music.state.currentView();
    if (currentView === "playlists") {
      // Only load playlist details if we're staying in playlists view
      await music.actions.viewPlaylist(playlist);
    }
  };

  // Play artist - pure player action, no view changes
  const playArtist = async (artist: ArtistSummary) => {
    // Just play the artist's songs, don't change views or load artist details
    await player.playArtist(artist);
  };

  // Play artist and view their songs (intentional cross-cutting workflow)
  const playArtistAndView = async (artist: ArtistSummary) => {
    // First start playing (immediate feedback)
    await player.playArtist(artist);

    // Then navigate to artist view only if we're already on artists view
    const currentView = music.state.currentView();
    if (currentView === "artists") {
      // Only load artist details if we're staying in artists view
      await music.actions.viewArtist(artist);
    }
  };

  // Play album - pure player action, no view changes
  const playAlbum = async (album: Album) => {
    // Just play the album, don't change views or load album details
    await player.playAlbum(album);
  };

  // Play album and view its tracks (intentional cross-cutting workflow)
  const playAlbumAndView = async (album: Album) => {
    // First start playing (immediate feedback)
    await player.playAlbum(album);

    // Then navigate to album view only if we're already on albums view
    const currentView = music.state.currentView();
    if (currentView === "albums") {
      // Only load album details if we're staying in albums view
      await music.actions.viewAlbum(album);
    }
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

  // Get view-only loading state (player loading doesn't affect view)
  const isLoading = () => {
    return music.state.loading();
  };

  // Get player-only loading state
  const isPlayerLoading = () => {
    return player.isLoading();
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

    // Scoped loading states
    isLoading, // View loading only
    isPlayerLoading, // Player loading only
    getError,

    // Combined actions
    actions: {
      // Initialization
      initialize,
      cleanup,

      // Playback (pure player actions - no view changes)
      playAndQueue,
      playPlaylist,
      playArtist,
      playAlbum,

      // Cross-cutting workflows (intentional player + view coupling)
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
