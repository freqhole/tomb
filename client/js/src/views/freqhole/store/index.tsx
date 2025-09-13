import { createStore } from "solid-js/store";
import { createContext, useContext, ParentComponent, JSX } from "solid-js";

// Define the main store interface
export interface FreqholeStore {
  layout: {
    queueOpen: boolean;
    breakpoint: "desktop" | "tablet" | "mobile";
    sidebarCollapsed: boolean;
  };
  navigation: {
    currentView: "songs" | "artists" | "albums" | "playlists";
    selectedArtist: any | null;
    selectedAlbum: any | null;
    selectedPlaylist: any | null;
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
    };
    isActive: boolean;
    loading: boolean;
  };
  filters: {
    tags: string[];
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
}

// Initial state
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
    },
    isActive: false,
    loading: false,
  },
  filters: {
    tags: [],
  },
  auth: {
    isAuthenticated: false,
    currentUser: null,
    token: null,
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

// Create the store
export const [store, setStore] = createStore(initialState);

// Store context
const StoreContext = createContext<[FreqholeStore, typeof setStore]>();

export interface StoreProviderProps {
  children: JSX.Element;
}

// Provider component
export const StoreProvider: ParentComponent<StoreProviderProps> = (props) => {
  const value = [store, setStore] as [typeof store, typeof setStore];
  return (
    <StoreContext.Provider value={value}>
      {props.children}
    </StoreContext.Provider>
  );
};

// Hook to use the store
export const useStore = () => {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error("useStore must be used within a StoreProvider");
  }
  return context;
};

// Convenience hooks for specific store sections
export const useLayout = () => {
  const [store, setStore] = useStore();
  return [
    store.layout,
    (updates: Partial<FreqholeStore["layout"]>) => setStore("layout", updates),
  ] as const;
};

export const useNavigation = () => {
  const [store, setStore] = useStore();
  return [
    store.navigation,
    (updates: Partial<FreqholeStore["navigation"]>) =>
      setStore("navigation", updates),
  ] as const;
};

export const usePlayer = () => {
  const [store, setStore] = useStore();
  return [
    store.player,
    (updates: Partial<FreqholeStore["player"]>) => setStore("player", updates),
  ] as const;
};

export const useQueue = () => {
  const [store, setStore] = useStore();
  return [
    store.queue,
    (updates: Partial<FreqholeStore["queue"]>) => setStore("queue", updates),
  ] as const;
};

export const useSearch = () => {
  const [store, setStore] = useStore();
  return [
    store.search,
    (updates: Partial<FreqholeStore["search"]>) => setStore("search", updates),
  ] as const;
};

export const useFilters = () => {
  const [store, setStore] = useStore();
  return [
    store.filters,
    (updates: Partial<FreqholeStore["filters"]>) =>
      setStore("filters", updates),
  ] as const;
};

export const useAuth = () => {
  const [store, setStore] = useStore();
  return [
    store.auth,
    (updates: Partial<FreqholeStore["auth"]>) => setStore("auth", updates),
  ] as const;
};

export const useUI = () => {
  const [store, setStore] = useStore();
  return [
    store.ui,
    (updates: Partial<FreqholeStore["ui"]>) => setStore("ui", updates),
  ] as const;
};

// Action creators for common operations
export const storeActions = {
  // Layout actions
  toggleQueue: () => setStore("layout", "queueOpen", (prev) => !prev),
  setBreakpoint: (breakpoint: FreqholeStore["layout"]["breakpoint"]) =>
    setStore("layout", "breakpoint", breakpoint),

  // Navigation actions
  setCurrentView: (view: FreqholeStore["navigation"]["currentView"]) =>
    setStore("navigation", "currentView", view),
  selectArtist: (artist: any) =>
    setStore("navigation", "selectedArtist", artist),
  selectAlbum: (album: any) => setStore("navigation", "selectedAlbum", album),
  selectPlaylist: (playlist: any) =>
    setStore("navigation", "selectedPlaylist", playlist),

  // Player actions
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

  // Queue actions
  addToQueue: (song: any) =>
    setStore("queue", "items", (prev) => [...prev, song]),
  removeFromQueue: (index: number) =>
    setStore("queue", "items", (prev) => prev.filter((_, i) => i !== index)),
  clearQueue: () => setStore("queue", "items", []),
  setCurrentIndex: (index: number) => setStore("queue", "currentIndex", index),

  // Search actions
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
      results: { songs: [], artists: [], albums: [] },
    });
  },

  // Auth actions
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

  // Filter actions
  addTagFilter: (tag: string) =>
    setStore("filters", "tags", (prev) =>
      prev.includes(tag) ? prev : [...prev, tag]
    ),
  removeTagFilter: (tag: string) =>
    setStore("filters", "tags", (prev) => prev.filter((t) => t !== tag)),
  clearTagFilters: () => setStore("filters", "tags", []),

  // UI actions
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
