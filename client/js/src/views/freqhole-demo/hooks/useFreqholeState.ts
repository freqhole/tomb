import { createSignal } from "solid-js";
import type {
  MediaBlob,
  FilterConfig,
  SortConfig,
  SortField,
  GridViewMode,
  ColumnVisibility,
  GridState,
} from "../types";
import { getDisplayFilename } from "../../../lib/media-utils";

const STORAGE_KEY = "freqhole-demo-state";
const DEFAULT_PANEL_WIDTH = 300;

// Load state from localStorage
function loadState(): Partial<GridState> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

// Save state to localStorage
function saveState(updates: Partial<GridState>) {
  try {
    const current = loadState();
    const updated = { ...current, ...updates };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage errors
  }
}

export interface FreqholeStateHook {
  // Filter state
  filterConfig: () => FilterConfig;
  setFilterConfig: (config: FilterConfig) => void;
  updateFilter: (key: keyof FilterConfig, value: any) => void;

  // Sort state
  sortConfig: () => SortConfig;
  setSortConfig: (config: SortConfig) => void;
  handleSort: (field: string, direction: "asc" | "desc") => void;

  // View state
  viewMode: () => GridViewMode;
  setViewMode: (mode: GridViewMode) => void;
  columnVisibility: () => ColumnVisibility;
  setColumnVisibility: (visibility: ColumnVisibility) => void;
  toggleColumn: (column: keyof ColumnVisibility) => void;

  // Panel state
  isFilterPanelOpen: () => boolean;
  setIsFilterPanelOpen: (open: boolean) => void;
  toggleFilterPanel: () => void;
  filterPanelWidth: () => number;
  setFilterPanelWidth: (width: number) => void;

  isBrowsePanelOpen: () => boolean;
  setIsBrowsePanelOpen: (open: boolean) => void;
  toggleBrowsePanel: () => void;
  browsePanelWidth: () => number;
  setBrowsePanelWidth: (width: number) => void;

  // WebSocket state
  wsUrl: () => string;
  setWsUrl: (url: string) => void;
  autoConnect: () => boolean;
  setAutoConnect: (connect: boolean) => void;
  autoRefresh: () => boolean;
  setAutoRefresh: (refresh: boolean) => void;
  debug: () => boolean;
  setDebug: (debug: boolean) => void;

  // Mock WebSocket state (for now)
  connectionStatus: () => string;
  setConnectionStatus: (status: string) => void;
  hasPendingUpdates: () => boolean;
  setHasPendingUpdates: (pending: boolean) => void;
  lastUpdated: () => Date | null;
  setLastUpdated: (date: Date | null) => void;

  // Data processing
  filteredData: (items: MediaBlob[]) => MediaBlob[];
  sortedData: (items: MediaBlob[]) => MediaBlob[];
}

export function useFreqholeState(): FreqholeStateHook {
  const initialState = loadState();

  // Filter state
  const [filterConfig, setFilterConfig] = createSignal<FilterConfig>({
    name: "",
    mime: "",
    blobType: "",
    minSize: 0,
    maxSize: 100000000,
    hasParent: "all",
    hasLocalPath: "all",
    ...(initialState.filterConfig || {}),
  });

  // Sort state
  const [sortConfig, setSortConfig] = createSignal<SortConfig>({
    field: "created_at",
    direction: "desc",
    ...(initialState.sortConfig || {}),
  });

  // View state
  const [viewMode, setViewMode] = createSignal<GridViewMode>(
    (initialState.viewMode as GridViewMode) || "default"
  );

  const [columnVisibility, setColumnVisibility] =
    createSignal<ColumnVisibility>({
      id: false,
      thumbnail: true,
      name: true,
      mime: true,
      blob_type: true,
      size: true,
      parent_id: false,
      local_path: false,
      created_at: true,
      updated_at: false,
      actions: true,
      ...(initialState.columnVisibility || {}),
    });

  // Panel state
  const [isFilterPanelOpen, setIsFilterPanelOpen] = createSignal(
    initialState.isFilterPanelOpen ?? true
  );
  const [filterPanelWidth, setFilterPanelWidth] = createSignal(
    initialState.filterPanelWidth || DEFAULT_PANEL_WIDTH
  );

  const [isBrowsePanelOpen, setIsBrowsePanelOpen] = createSignal(
    initialState.isBrowsePanelOpen ?? true
  );
  const [browsePanelWidth, setBrowsePanelWidth] = createSignal(
    initialState.browsePanelWidth || DEFAULT_PANEL_WIDTH
  );

  // WebSocket state
  const [wsUrl, setWsUrl] = createSignal(
    initialState.wsUrl || "ws://localhost:8080/ws"
  );
  const [autoConnect, setAutoConnect] = createSignal(
    initialState.autoConnect ?? true
  );
  const [autoRefresh, setAutoRefresh] = createSignal(
    initialState.autoRefresh ?? true
  );
  const [debug, setDebug] = createSignal(initialState.debug ?? false);

  // Mock WebSocket state
  const [connectionStatus, setConnectionStatus] = createSignal("Disconnected");
  const [hasPendingUpdates, setHasPendingUpdates] = createSignal(false);
  const [lastUpdated, setLastUpdated] = createSignal<Date | null>(null);

  // Helper functions
  const updateFilter = (key: keyof FilterConfig, value: any) => {
    setFilterConfig((prev) => {
      const updated = { ...prev, [key]: value };
      saveState({ filterConfig: updated });
      return updated;
    });
  };

  const handleSort = (field: string, direction: "asc" | "desc") => {
    const newConfig = { field: field as SortField, direction };
    setSortConfig(newConfig);
    saveState({ sortConfig: newConfig });
  };

  const toggleColumn = (column: keyof ColumnVisibility) => {
    setColumnVisibility((prev) => {
      const updated = { ...prev, [column]: !prev[column] };
      saveState({ columnVisibility: updated });
      return updated;
    });
  };

  const toggleFilterPanel = () => {
    setIsFilterPanelOpen((prev) => {
      const newValue = !prev;
      saveState({ isFilterPanelOpen: newValue });
      return newValue;
    });
  };

  const toggleBrowsePanel = () => {
    setIsBrowsePanelOpen((prev) => {
      const newValue = !prev;
      saveState({ isBrowsePanelOpen: newValue });
      return newValue;
    });
  };

  // Data processing
  const filteredData = (items: MediaBlob[]): MediaBlob[] => {
    const config = filterConfig();
    return items.filter((item) => {
      // Name filter
      if (
        config.name &&
        !getDisplayFilename(item)
          .toLowerCase()
          .includes(config.name.toLowerCase())
      ) {
        return false;
      }

      // MIME filter
      if (config.mime && getMimeCategory(item.mime || "") !== config.mime) {
        return false;
      }

      // Blob type filter
      if (config.blobType && item.blob_type !== config.blobType) {
        return false;
      }

      // Size filter
      const size = item.size || 0;
      if (size < config.minSize || size > config.maxSize) {
        return false;
      }

      // Parent filter
      if (config.hasParent !== "all") {
        const hasParent = !!item.parent_id;
        if (
          (config.hasParent === "yes" && !hasParent) ||
          (config.hasParent === "no" && hasParent)
        ) {
          return false;
        }
      }

      // Local path filter
      if (config.hasLocalPath !== "all") {
        const hasLocalPath = !!item.local_path;
        if (
          (config.hasLocalPath === "yes" && !hasLocalPath) ||
          (config.hasLocalPath === "no" && hasLocalPath)
        ) {
          return false;
        }
      }

      return true;
    });
  };

  const sortedData = (items: MediaBlob[]): MediaBlob[] => {
    const config = sortConfig();
    const filtered = filteredData(items);

    if (!config.direction) {
      return filtered;
    }

    const sorted = [...filtered];
    return sorted.sort((a, b) => {
      const aValue = a[config.field] || "";
      const bValue = b[config.field] || "";

      let comparison = 0;
      if (typeof aValue === "string" && typeof bValue === "string") {
        comparison = aValue.localeCompare(bValue);
      } else if (typeof aValue === "number" && typeof bValue === "number") {
        comparison = aValue - bValue;
      } else {
        comparison = String(aValue).localeCompare(String(bValue));
      }

      return config.direction === "desc" ? -comparison : comparison;
    });
  };

  return {
    // Filter state
    filterConfig,
    setFilterConfig: (config) => {
      setFilterConfig(config);
      saveState({ filterConfig: config });
    },
    updateFilter,

    // Sort state
    sortConfig,
    setSortConfig: (config) => {
      setSortConfig(config);
      saveState({ sortConfig: config });
    },
    handleSort,

    // View state
    viewMode,
    setViewMode: (mode) => {
      setViewMode(mode);
      saveState({ viewMode: mode });
    },
    columnVisibility,
    setColumnVisibility: (visibility) => {
      setColumnVisibility(visibility);
      saveState({ columnVisibility: visibility });
    },
    toggleColumn,

    // Panel state
    isFilterPanelOpen,
    setIsFilterPanelOpen: (open) => {
      setIsFilterPanelOpen(open);
      saveState({ isFilterPanelOpen: open });
    },
    toggleFilterPanel,
    filterPanelWidth,
    setFilterPanelWidth: (width) => {
      setFilterPanelWidth(width);
      saveState({ filterPanelWidth: width });
    },

    isBrowsePanelOpen,
    setIsBrowsePanelOpen: (open) => {
      setIsBrowsePanelOpen(open);
      saveState({ isBrowsePanelOpen: open });
    },
    toggleBrowsePanel,
    browsePanelWidth,
    setBrowsePanelWidth: (width) => {
      setBrowsePanelWidth(width);
      saveState({ browsePanelWidth: width });
    },

    // WebSocket state
    wsUrl,
    setWsUrl,
    autoConnect,
    setAutoConnect,
    autoRefresh,
    setAutoRefresh,
    debug,
    setDebug,

    // Mock WebSocket state
    connectionStatus,
    setConnectionStatus,
    hasPendingUpdates,
    setHasPendingUpdates,
    lastUpdated,
    setLastUpdated,

    // Data processing
    filteredData,
    sortedData,
  };
}

// Helper functions (these have been moved to lib/media-utils.ts)

function getMimeCategory(mimeType: string): string {
  if (!mimeType) return "unknown";
  return mimeType.split("/")[0] || "unknown";
}
