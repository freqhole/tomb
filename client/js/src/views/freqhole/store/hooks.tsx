import { createMemo, createSignal } from "solid-js";
import { useStore, useReactiveActions, storeActions } from "./index";

// comprehensive search hook that bridges old useSearchContext API
export const useSearch = () => {
  const [store] = useStore();
  const reactiveActions = useReactiveActions();
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

  // actual suggestions from reactive store
  const suggestions = () => reactiveActions.resources?.suggestions() || [];
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
  const [store] = useStore();
  const reactiveActions = useReactiveActions();

  // memoized available tags excluding selected ones
  const unselectedTags = createMemo(() => {
    const available = reactiveActions.resources?.availableTags() || [];
    const selected = store.filters.tags;
    return available.filter((tag) => {
      return !selected.includes(tag.value);
    });
  });

  return [
    {
      selectedTags: () => store.filters.tags,
      availableTags: reactiveActions.resources?.availableTags,
      unselectedTags: unselectedTags,
      loading: () => reactiveActions.resources?.availableTags?.loading,
      error: () => reactiveActions.resources?.availableTags?.error,
    },
    {
      // Use reactive actions instead of legacy store actions
      addTag: reactiveActions.addTagFilter,
      removeTag: reactiveActions.removeTagFilter,
      clearTags: reactiveActions.clearTagFilters,
    },
  ] as const;
};

export const useDataSections = () => {
  const reactiveActions = useReactiveActions();

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
  const reactiveActions = useReactiveActions();

  return {
    recentPlaylists: reactiveActions.resources?.recentPlaylists,
    // router handles current view, not store
  };
};

// hook for tag management in context menus
export const useTagManagement = () => {
  const reactiveActions = useReactiveActions();

  return {
    availableTags: reactiveActions.resources?.availableTags,
    mutateAvailableTags: reactiveActions.mutateAvailableTags,
    addTagToSongs: reactiveActions.addTagToSongs,
    removeTagFromSongs: reactiveActions.removeTagFromSongs,
    loading: reactiveActions.resources?.availableTags?.loading,
  };
};

// hook for currently playing indicators across the app
export const useCurrentlyPlaying = () => {
  const [store] = useStore();
  const reactiveActions = useReactiveActions();

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
