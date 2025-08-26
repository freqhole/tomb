/* @jsxImportSource solid-js */
import { createContext, useContext, ParentComponent } from "solid-js";
import { usePlaylistManager } from "../hooks/usePlaylistManager.js";

import { useSongState } from "../hooks/useSongState.js";
import { useUIState } from "../hooks/useUIState.js";
import { useDragAndDrop } from "../hooks/useDragAndDrop.js";
import { useImageModal } from "../hooks/useImageModal.js";

// Create context type
interface PlaylistzContextType {
  playlistManager: ReturnType<typeof usePlaylistManager>;
  songState: ReturnType<typeof useSongState>;
  uiState: ReturnType<typeof useUIState>;
  dragAndDrop: ReturnType<typeof useDragAndDrop>;
  imageModal: ReturnType<typeof useImageModal>;
}

// Create context
const PlaylistzContext = createContext<PlaylistzContextType>();

// Provider component
export const PlaylistzProvider: ParentComponent = (props) => {
  // Initialize all hooks once at the top level
  const playlistManager = usePlaylistManager();
  const songState = useSongState();
  const uiState = useUIState();
  const dragAndDrop = useDragAndDrop();
  const imageModal = useImageModal();

  const contextValue: PlaylistzContextType = {
    playlistManager,
    songState,
    uiState,
    dragAndDrop,
    imageModal,
  };

  return (
    <PlaylistzContext.Provider value={contextValue}>
      {props.children}
    </PlaylistzContext.Provider>
  );
};

// Hook to use the context
export function usePlaylistzContext() {
  const context = useContext(PlaylistzContext);
  if (!context) {
    throw new Error(
      "usePlaylistzContext must be used within a PlaylistzProvider"
    );
  }
  return context;
}

// Individual hooks for convenience
export function usePlaylistzManager() {
  return usePlaylistzContext().playlistManager;
}

export function usePlaylistzSongs() {
  return usePlaylistzContext().songState;
}

export function usePlaylistzUI() {
  return usePlaylistzContext().uiState;
}

export function usePlaylistzDragDrop() {
  return usePlaylistzContext().dragAndDrop;
}

export function usePlaylistzImageModal() {
  return usePlaylistzContext().imageModal;
}
