import { createMemo, createSignal } from "solid-js";
import { useStore, reactiveActions, storeActions } from "./index";

// comprehensive search hook that bridges old useSearchContext API
export const useSearch = () => {
  const [store] = useStore();
  const [activeTab, setActiveTab] = createSignal<
    "all" | "songs" | "artists" | "albums" | "playlists"
  >("all");

  // bridge methods to match old useSearchContext API
  const searchQuery = () => store.search.query;
  const setSearchQuery = (query: string, executeSearch = false) => {
    storeActions.setSearchQuery(query);
    if (executeSearch) {
      // trigger search through reactive resources
      // resources will automatically update based on store.search.query
    }
  };

  // extract arrays from API response structure
  const songs = () => {
    const result = reactiveActions.resources?.songs();
    if (result && typeof result === "object" && "songs" in result) {
      return (result as any).songs || [];
    }
    return Array.isArray(result) ? result : [];
  };

  const artists = () => {
    const result = reactiveActions.resources?.artists();
    if (result && typeof result === "object" && "artists" in result) {
      return (result as any).artists || [];
    }
    return Array.isArray(result) ? result : [];
  };

  const albums = () => {
    const result = reactiveActions.resources?.albums();
    if (result && typeof result === "object" && "albums" in result) {
      return (result as any).albums || [];
    }
    return Array.isArray(result) ? result : [];
  };

  const loading = () => reactiveActions.resources?.songs?.loading || false;
  const error = () => reactiveActions.resources?.songs?.error || null;

  const hasResults = () => {
    const songsData = songs();
    const artistsData = artists();
    const albumsData = albums();
    return (
      songsData.length > 0 || artistsData.length > 0 || albumsData.length > 0
    );
  };

  const totalCount = () => {
    return songs().length + artists().length + albums().length;
  };

  const clear = () => {
    storeActions.clearSearch();
    setActiveTab("all");
  };

  // placeholder suggestions - can be enhanced later
  const suggestions = () => [];
  const onSuggestionSelect = (suggestion: string) => {
    setSearchQuery(suggestion, true);
  };

  // pagination support - extracted from API response
  const pagination = () => {
    const result = reactiveActions.resources?.songs();
    if (result && typeof result === "object" && "pagination" in result) {
      return (result as any).pagination;
    }
    return { page: 1, page_size: 50, total_pages: 1, has_next: false };
  };

  const loadMore = () => {
    // TODO: implement pagination loading in future phases
    console.log("loadMore not implemented yet");
  };

  return {
    // state
    searchQuery,
    activeTab,
    songs,
    artists,
    albums,
    loading,
    error,
    hasResults,
    totalCount,
    suggestions,
    pagination,

    // actions
    setSearchQuery,
    setActiveTab,
    clear,
    onSuggestionSelect,
    loadMore,
  };
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
