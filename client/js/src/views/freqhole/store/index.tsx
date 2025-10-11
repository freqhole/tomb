import { createStore } from "solid-js/store";
import { createContext, useContext, ParentComponent, JSX } from "solid-js";
import { apiClient } from "../../../lib/api-client";
import { createStoreActions } from "./actions";
import { createSearchActions } from "./search-actions";

// define the main store interface
export interface FreqholeStore {
  layout: {
    queueOpen: boolean;
    breakpoint: "desktop" | "tablet" | "mobile";
    sidebarCollapsed: boolean;
  };
  navigation: {
    currentView: "songs" | "artists" | "albums" | "playlists" | "genres";
    selectedArtist: any | null;
    selectedAlbum: any | null;
    selectedPlaylist: any | null;
    selectedGenre: string | null;
  };
  player: {
    currentSong: any | null;
    isPlaying: boolean;
    volume: number;
    repeat: boolean;
    shuffle: boolean;
    duration: number;
    currentTime: number;
  };
  queue: {
    items: any[];
    currentIndex: number;
    history: any[];
  };
  search: {
    query: string;
    results: {
      songs: any[];
      artists: any[];
      albums: any[];
      genres?: any[];
      playlists?: any[];
    };
    params: {
      include_genres: boolean;
      include_playlists: boolean;
      page: number;
      page_size: number;
      sort_by?: string;
      sort_direction?: "asc" | "desc";
    };
    pagination: {
      total_count: number;
      total_pages: number;
      has_next: boolean;
      has_prev: boolean;
      current_page: number;
    };
    isActive: boolean;
    loading: boolean;
    query_time_ms?: number;
  };
  filters: {
    tags: string[];
    favoritesOnly: boolean;
  };
  genres: {
    selectedGenre: string | null;
    viewMode: "artists" | "albums";
    currentPage: number;
    loading: boolean;
  };
  sort: {
    field: string;
    direction: "asc" | "desc";
  };
  auth: {
    isAuthenticated: boolean;
    currentUser: any | null;
    token: string | null;
  };
  ui: {
    modals: {
      authModal: boolean;
      playlistModal: boolean;
      createPlaylistModal: boolean;
    };
    contextMenu: {
      isOpen: boolean;
      x: number;
      y: number;
      actions: any[];
    };
    notifications: any[];
  };

  // server context for multi-server preparation
  server: {
    apiClient: typeof apiClient;
    baseUrl: string;
    serverId: string;
  };
}

// initial state
const initialState: FreqholeStore = {
  layout: {
    queueOpen: false,
    breakpoint: "desktop",
    sidebarCollapsed: false,
  },
  navigation: {
    currentView: "songs",
    selectedArtist: null,
    selectedAlbum: null,
    selectedPlaylist: null,
    selectedGenre: null,
  },
  player: {
    currentSong: null,
    isPlaying: false,
    volume: 0.8,
    repeat: false,
    shuffle: false,
    duration: 0,
    currentTime: 0,
  },
  queue: {
    items: [],
    currentIndex: 0,
    history: [],
  },
  search: {
    query: "",
    results: {
      songs: [],
      artists: [],
      albums: [],
      genres: [],
      playlists: [],
    },
    params: {
      include_genres: false,
      include_playlists: false,
      page: 1,
      page_size: 20,
      sort_by: "created_at",
      sort_direction: "desc" as const,
    },
    pagination: {
      total_count: 0,
      total_pages: 0,
      has_next: false,
      has_prev: false,
      current_page: 1,
    },
    isActive: false,
    loading: false,
    query_time_ms: 0,
  },
  filters: {
    tags: [],
    favoritesOnly: false,
  },
  genres: {
    selectedGenre: null,
    viewMode: "artists",
    currentPage: 1,
    loading: false,
  },
  sort: {
    field: "created_at",
    direction: "desc",
  },
  auth: {
    isAuthenticated: false,
    currentUser: null,
    token: null,
  },
  server: {
    apiClient: apiClient,
    baseUrl: window.location.origin,
    serverId: "default",
  },
  ui: {
    modals: {
      authModal: false,
      playlistModal: false,
      createPlaylistModal: false,
    },
    contextMenu: {
      isOpen: false,
      x: 0,
      y: 0,
      actions: [],
    },
    notifications: [],
  },
};

// create the store
export const [store, setStore] = createStore(initialState);

// store context with both basic and reactive actions
const StoreContext =
  createContext<
    [
      FreqholeStore,
      typeof storeActions,
      ReturnType<typeof createStoreActions>,
      ReturnType<typeof createSearchActions>,
    ]
  >();

export interface StoreProviderProps {
  children: JSX.Element;
}

// provider component
export const StoreProvider: ParentComponent<StoreProviderProps> = (props) => {
  // create reactive actions in provider context (inside reactive boundary)
  const reactiveActionsInstance = createStoreActions(
    store,
    setStore,
    apiClient
  );

  // create search actions instance
  const searchActionsInstance = createSearchActions(store, setStore, apiClient);

  const value = [
    store,
    storeActions,
    reactiveActionsInstance,
    searchActionsInstance,
  ] as [
    typeof store,
    typeof storeActions,
    typeof reactiveActionsInstance,
    typeof searchActionsInstance,
  ];
  return (
    <StoreContext.Provider value={value}>
      {props.children}
    </StoreContext.Provider>
  );
};

// hook to use the store
export const useStore = () => {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error("useStore must be used within a StoreProvider");
  }
  return [context[0], context[1]] as [(typeof context)[0], (typeof context)[1]];
};

// hook to get reactive actions (NEW - replaces module-level reactiveActions)
export const useReactiveActions = () => {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error("useReactiveActions must be used within a StoreProvider");
  }
  return context[2];
};

// hook to get search actions
export const useSearchActions = () => {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error("useSearchActions must be used within a StoreProvider");
  }
  return context[3];
};

// hook specifically for store actions
// @deprecated LEGACY: Use useReactiveActions() hook for reactive patterns
export const useStoreActions = () => {
  const [, actions] = useStore();
  return actions;
};

// convenience hooks for specific store sections
export const useLayout = () => {
  const [store] = useStore();
  return [
    store.layout,
    (updates: Partial<FreqholeStore["layout"]>) => setStore("layout", updates),
  ] as const;
};

export const useNavigation = () => {
  const [store] = useStore();
  return [
    store.navigation,
    (updates: Partial<FreqholeStore["navigation"]>) =>
      setStore("navigation", updates),
  ] as const;
};

export const usePlayer = () => {
  const [store] = useStore();
  return [
    store.player,
    (updates: Partial<FreqholeStore["player"]>) => setStore("player", updates),
  ] as const;
};

export const useQueue = () => {
  const [store] = useStore();
  return [
    store.queue,
    (updates: Partial<FreqholeStore["queue"]>) => setStore("queue", updates),
  ] as const;
};

export const useSearch = () => {
  const [store] = useStore();
  return [
    store.search,
    (updates: Partial<FreqholeStore["search"]>) => setStore("search", updates),
  ] as const;
};

export const useSort = () => {
  const [store] = useStore();
  return [
    store.sort,
    (updates: Partial<FreqholeStore["sort"]>) => setStore("sort", updates),
  ] as const;
};

export const useFilters = () => {
  const [store] = useStore();
  return [
    store.filters,
    (updates: Partial<FreqholeStore["filters"]>) =>
      setStore("filters", updates),
  ] as const;
};

export const useGenres = () => {
  const [store] = useStore();
  return [
    store.genres,
    (updates: Partial<FreqholeStore["genres"]>) => setStore("genres", updates),
  ] as const;
};

export const useAuth = () => {
  const [store] = useStore();
  return [
    store.auth,
    (updates: Partial<FreqholeStore["auth"]>) => setStore("auth", updates),
  ] as const;
};

export const useUI = () => {
  const [store] = useStore();
  return [
    store.ui,
    (updates: Partial<FreqholeStore["ui"]>) => setStore("ui", updates),
  ] as const;
};

// @deprecated LEGACY: Basic store actions without reactive patterns
// Use useReactiveActions() hook for reactive patterns instead
export const storeActions = {
  // layout actions
  toggleQueue: () => setStore("layout", "queueOpen", (prev) => !prev),
  setBreakpoint: (breakpoint: FreqholeStore["layout"]["breakpoint"]) =>
    setStore("layout", "breakpoint", breakpoint),

  // navigation actions
  setCurrentView: (view: FreqholeStore["navigation"]["currentView"]) =>
    setStore("navigation", "currentView", view),
  selectArtist: (artist: any) =>
    setStore("navigation", "selectedArtist", artist),
  selectAlbum: (album: any) => setStore("navigation", "selectedAlbum", album),
  selectPlaylist: (playlist: any) =>
    setStore("navigation", "selectedPlaylist", playlist),
  selectGenre: (genre: string | null) =>
    setStore("navigation", "selectedGenre", genre),

  // player actions
  playSong: (song: any) => {
    setStore("player", {
      currentSong: song,
      isPlaying: true,
    });
  },
  togglePlay: () => setStore("player", "isPlaying", (prev) => !prev),
  setVolume: (volume: number) => setStore("player", "volume", volume),
  setCurrentTime: (time: number) => setStore("player", "currentTime", time),
  setPlayerState: (updates: Partial<FreqholeStore["player"]>) =>
    setStore("player", updates),

  // queue actions
  addToQueue: (song: any) =>
    setStore("queue", "items", (prev) => [...prev, song]),
  removeFromQueue: (index: number) =>
    setStore("queue", "items", (prev) => prev.filter((_, i) => i !== index)),
  clearQueue: () => setStore("queue", "items", []),
  setCurrentIndex: (index: number) => setStore("queue", "currentIndex", index),
  updateQueueItem: (index: number, updatedSong: any) =>
    setStore("queue", "items", index, updatedSong),

  // search actions
  setSearchQuery: (query: string) => {
    setStore("search", "query", query);
    setStore("search", "isActive", query.trim().length > 0);
  },
  setSearchResults: (results: FreqholeStore["search"]["results"]) =>
    setStore("search", "results", results),
  clearSearch: () => {
    setStore("search", {
      query: "",
      isActive: false,
      results: {
        songs: [],
        artists: [],
        albums: [],
        genres: [],
        playlists: [],
      },
      pagination: {
        total_count: 0,
        total_pages: 0,
        has_next: false,
        has_prev: false,
        current_page: 1,
      },
    });
  },

  // search parameter actions for genre/playlist grouping
  setSearchParams: (params: Partial<FreqholeStore["search"]["params"]>) =>
    setStore("search", "params", params),
  enableGenreGrouping: () =>
    setStore("search", "params", "include_genres", true),
  disableGenreGrouping: () =>
    setStore("search", "params", "include_genres", false),
  enablePlaylistGrouping: () =>
    setStore("search", "params", "include_playlists", true),
  disablePlaylistGrouping: () =>
    setStore("search", "params", "include_playlists", false),
  toggleGenreGrouping: () =>
    setStore("search", "params", "include_genres", (prev) => !prev),
  togglePlaylistGrouping: () =>
    setStore("search", "params", "include_playlists", (prev) => !prev),

  // auth actions
  login: (user: any, token: string) => {
    setStore("auth", {
      isAuthenticated: true,
      currentUser: user,
      token: token,
    });
  },
  logout: () => {
    setStore("auth", {
      isAuthenticated: false,
      currentUser: null,
      token: null,
    });
  },

  // @deprecated LEGACY: basic filter actions - use useReactiveActions() instead
  addTagFilter: (tag: string) =>
    setStore("filters", "tags", (prev) =>
      prev.includes(tag) ? prev : [...prev, tag]
    ),
  removeTagFilter: (tag: string) =>
    setStore("filters", "tags", (prev) => prev.filter((t) => t !== tag)),
  clearTagFilters: () => setStore("filters", "tags", []),

  // favorites filter actions
  setFavoritesFilter: (enabled: boolean) =>
    setStore("filters", "favoritesOnly", enabled),
  toggleFavoritesFilter: () =>
    setStore("filters", "favoritesOnly", (prev) => !prev),

  // ui actions
  openModal: (modal: keyof FreqholeStore["ui"]["modals"]) =>
    setStore("ui", "modals", modal, true),
  closeModal: (modal: keyof FreqholeStore["ui"]["modals"]) =>
    setStore("ui", "modals", modal, false),
  showContextMenu: (x: number, y: number, actions: any[]) => {
    setStore("ui", "contextMenu", {
      isOpen: true,
      x,
      y,
      actions,
    });
  },
  hideContextMenu: () => setStore("ui", "contextMenu", "isOpen", false),
  addNotification: (notification: any) =>
    setStore("ui", "notifications", (prev) => [...prev, notification]),
  removeNotification: (id: string) =>
    setStore("ui", "notifications", (prev) => prev.filter((n) => n.id !== id)),
};

// @deprecated LEGACY: Module-level reactiveActions - use useReactiveActions() hook instead
// This caused reactive context issues - keeping for backward compatibility only
export let reactiveActions: ReturnType<typeof createStoreActions>;
