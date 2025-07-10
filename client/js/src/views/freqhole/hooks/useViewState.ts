/* @jsxImportSource solid-js */
import { createSignal } from "solid-js";
import type { Song, Playlist } from "./usePlayerQueue.js";

export interface ViewState {
  // Modal states
  showPlaylistModal: boolean;
  playlistModalMode: "create" | "edit" | "add-songs";
  selectedSongs: Song[];
  editingPlaylist: Playlist | null;
  showPlaylistDropdown: string | null;

  // Playlist form state
  playlistForm: {
    title: string;
    description: string;
    is_public: boolean;
  };

  // Animation states
  viewTransition: "entering" | "exiting" | "idle";
}

export interface ViewStateActions {
  // Modal management
  openCreatePlaylistModal: (songsToAdd?: Song[]) => void;
  openEditPlaylistModal: (playlist: Playlist) => void;
  openAddSongsModal: (playlist: Playlist, songs: Song[]) => void;
  closePlaylistModal: () => void;

  // Playlist dropdown
  togglePlaylistDropdown: (songId: string | null) => void;
  closePlaylistDropdown: () => void;

  // Form management
  updatePlaylistForm: (
    updates: Partial<{ title: string; description: string; is_public: boolean }>
  ) => void;
  resetPlaylistForm: () => void;

  // Song selection
  addSelectedSong: (song: Song) => void;
  removeSelectedSong: (songId: string) => void;
  clearSelectedSongs: () => void;
  setSelectedSongs: (songs: Song[]) => void;

  // Animation control
  setViewTransition: (state: "entering" | "exiting" | "idle") => void;

  // Utility
  isModalOpen: () => boolean;
  hasSelectedSongs: () => boolean;
}

export const useViewState = () => {
  // Modal states
  const [showPlaylistModal, setShowPlaylistModal] = createSignal(false);
  const [playlistModalMode, setPlaylistModalMode] = createSignal<
    "create" | "edit" | "add-songs"
  >("create");
  const [selectedSongs, setSelectedSongs] = createSignal<Song[]>([]);
  const [editingPlaylist, setEditingPlaylist] = createSignal<Playlist | null>(
    null
  );
  const [showPlaylistDropdown, setShowPlaylistDropdown] = createSignal<
    string | null
  >(null);

  // Playlist form state
  const [playlistForm, setPlaylistForm] = createSignal({
    title: "",
    description: "",
    is_public: false,
  });

  // Animation states
  const [viewTransition, setViewTransition] = createSignal<
    "entering" | "exiting" | "idle"
  >("idle");

  // Modal management functions
  const openCreatePlaylistModal = (songsToAdd?: Song[]) => {
    setPlaylistModalMode("create");
    setSelectedSongs(songsToAdd || []);
    setPlaylistForm({ title: "", description: "", is_public: false });
    setEditingPlaylist(null);
    setShowPlaylistModal(true);
  };

  const openEditPlaylistModal = (playlist: Playlist) => {
    setPlaylistModalMode("edit");
    setEditingPlaylist(playlist);
    setPlaylistForm({
      title: playlist.title,
      description: playlist.description || "",
      is_public: playlist.is_public,
    });
    setSelectedSongs([]);
    setShowPlaylistModal(true);
  };

  const openAddSongsModal = (playlist: Playlist, songs: Song[]) => {
    setPlaylistModalMode("add-songs");
    setEditingPlaylist(playlist);
    setSelectedSongs(songs);
    setPlaylistForm({
      title: playlist.title,
      description: playlist.description || "",
      is_public: playlist.is_public,
    });
    setShowPlaylistModal(true);
  };

  const closePlaylistModal = () => {
    setShowPlaylistModal(false);
    setSelectedSongs([]);
    setEditingPlaylist(null);
    setPlaylistForm({ title: "", description: "", is_public: false });
    setPlaylistModalMode("create");
  };

  // Playlist dropdown management
  const togglePlaylistDropdown = (songId: string | null) => {
    setShowPlaylistDropdown(showPlaylistDropdown() === songId ? null : songId);
  };

  const closePlaylistDropdown = () => {
    setShowPlaylistDropdown(null);
  };

  // Form management
  const updatePlaylistForm = (
    updates: Partial<{ title: string; description: string; is_public: boolean }>
  ) => {
    setPlaylistForm((prev) => ({ ...prev, ...updates }));
  };

  const resetPlaylistForm = () => {
    setPlaylistForm({ title: "", description: "", is_public: false });
  };

  // Song selection management
  const addSelectedSong = (song: Song) => {
    setSelectedSongs((prev) => {
      if (prev.some((s) => s.id === song.id)) {
        return prev;
      }
      return [...prev, song];
    });
  };

  const removeSelectedSong = (songId: string) => {
    setSelectedSongs((prev) => prev.filter((song) => song.id !== songId));
  };

  const clearSelectedSongs = () => {
    setSelectedSongs([]);
  };

  // Utility functions
  const isModalOpen = () => showPlaylistModal();

  const hasSelectedSongs = () => selectedSongs().length > 0;

  return {
    // State
    state: {
      showPlaylistModal,
      playlistModalMode,
      selectedSongs,
      editingPlaylist,
      showPlaylistDropdown,
      playlistForm,
      viewTransition,
    },

    // Actions
    actions: {
      openCreatePlaylistModal,
      openEditPlaylistModal,
      openAddSongsModal,
      closePlaylistModal,
      togglePlaylistDropdown,
      closePlaylistDropdown,
      updatePlaylistForm,
      resetPlaylistForm,
      addSelectedSong,
      removeSelectedSong,
      clearSelectedSongs,
      setSelectedSongs,
      setViewTransition,
      isModalOpen,
      hasSelectedSongs,
    },
  };
};
