import { createMemo } from "solid-js";
import { useStore, reactiveActions } from "./index";

// granular hooks for specific functionality
export const useSearch = () => {
  const [store, actions] = useStore();
  return [
    store.search,
    {
      setQuery: actions.setSearchQuery,
      clearSearch: actions.clearSearch,
    },
  ] as const;
};

export const useTagFilters = () => {
  const [store, actions] = useStore();

  // memoized available tags excluding selected ones
  const unselectedTags = createMemo(() => {
    const available = reactiveActions.resources?.availableTags() || [];
    const selected = store.filters.tags;
    return available.filter((tag: any) => {
      const tagValue = tag?.value || tag;
      return !selected.includes(tagValue);
    });
  });

  return [
    {
      selectedTags: store.filters.tags,
      availableTags: reactiveActions.resources?.availableTags,
      unselectedTags: unselectedTags,
      loading: reactiveActions.resources?.availableTags?.loading,
      error: reactiveActions.resources?.availableTags?.error,
    },
    {
      addTag: (tag: string) => actions.addTagFilter(tag),
      removeTag: (tag: string) => actions.removeTagFilter(tag),
      clearTags: () => actions.clearTagFilters(),
    },
  ] as const;
};

export const useDataSections = () => {
  return {
    songs: {
      data: reactiveActions.resources?.songs,
      loading: reactiveActions.resources?.songs?.loading,
      error: reactiveActions.resources?.songs?.error,
    },
    artists: {
      data: reactiveActions.resources?.artists,
      loading: reactiveActions.resources?.artists?.loading,
      error: reactiveActions.resources?.artists?.error,
    },
    albums: {
      data: reactiveActions.resources?.albums,
      loading: reactiveActions.resources?.albums?.loading,
      error: reactiveActions.resources?.albums?.error,
    },
    playlists: {
      data: reactiveActions.resources?.playlists,
      loading: reactiveActions.resources?.playlists?.loading,
      error: reactiveActions.resources?.playlists?.error,
    },
  };
};

// hook for nav-specific data (always loaded)
export const useNavigation = () => {
  return {
    recentPlaylists: reactiveActions.resources?.recentPlaylists,
    // router handles current view, not store
  };
};

// hook for tag management in context menus
export const useTagManagement = () => {
  return {
    availableTags: reactiveActions.resources?.availableTags,
    addTagToSongs: reactiveActions.addTagToSongs,
    removeTagFromSongs: reactiveActions.removeTagFromSongs,
    loading: reactiveActions.resources?.availableTags?.loading,
  };
};

// hook for currently playing indicators across the app
export const useCurrentlyPlaying = () => {
  const [store] = useStore();

  // memoized indicator for any song
  const isCurrentlyPlaying = createMemo(() => (songId: string) => {
    return store.player.currentSong?.id === songId;
  });

  return {
    currentSong: store.player.currentSong,
    isPlaying: store.player.isPlaying,
    isCurrentlyPlaying: isCurrentlyPlaying,
    setCurrentlyPlaying: reactiveActions.setCurrentlyPlaying,
  };
};
