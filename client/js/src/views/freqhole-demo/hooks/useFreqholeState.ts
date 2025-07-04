import { createSignal } from "solid-js";
import type {
  FilterConfig,
  SortConfig,
  SortField,
  GridViewMode,
  ColumnVisibility,
  GridState,
} from "../types";
import type { MediaBlob } from "../../../lib/websocket-types";

export interface FreqholeStateProps {
  wsUrl: string;
  autoConnect: boolean;
}

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

  isSettingsPanelOpen: () => boolean;
  setIsSettingsPanelOpen: (open: boolean) => void;
  toggleSettingsPanel: () => void;
  settingsPanelWidth: () => number;
  setSettingsPanelWidth: (width: number) => void;

  // WebSocket state
  wsUrl: () => string;
  setWsUrl: (url: string) => void;
  autoConnect: () => boolean;
  setAutoConnect: (connect: boolean) => void;
  autoRefresh: () => boolean;
  setAutoRefresh: (refresh: boolean) => void;
  debug: () => boolean;
  setDebug: (debug: boolean) => void;

  // UI interaction state
  popupPreview: () => { item: MediaBlob; isOpen: boolean } | null;
  setPopupPreview: (
    preview: { item: MediaBlob; isOpen: boolean } | null
  ) => void;

  actionMenu: () => {
    item: MediaBlob;
    isOpen: boolean;
    position: { x: number; y: number };
  } | null;
  setActionMenu: (
    menu: {
      item: MediaBlob;
      isOpen: boolean;
      position: { x: number; y: number };
    } | null
  ) => void;

  bulkActionMenu: () => {
    isOpen: boolean;
    position: { x: number; y: number };
  } | null;
  setBulkActionMenu: (
    menu: { isOpen: boolean; position: { x: number; y: number } } | null
  ) => void;

  confirmDialog: () => {
    isOpen: boolean;
    title: string;
    message: string;
    items?: MediaBlob[];
    onConfirm: () => void;
  } | null;
  setConfirmDialog: (
    dialog: {
      isOpen: boolean;
      title: string;
      message: string;
      items?: MediaBlob[];
      onConfirm: () => void;
    } | null
  ) => void;

  headerActionMenu: () => {
    isOpen: boolean;
    position: { x: number; y: number };
  } | null;
  setHeaderActionMenu: (
    menu: { isOpen: boolean; position: { x: number; y: number } } | null
  ) => void;

  // Logs
  logs: () => string[];
  setLogs: (logs: string[]) => void;

  // Mock WebSocket state (for now)
  connectionStatus: () => string;
  setConnectionStatus: (status: string) => void;
  hasPendingUpdates: () => boolean;
  setHasPendingUpdates: (pending: boolean) => void;
  lastUpdated: () => Date | null;
  setLastUpdated: (date: Date | null) => void;

  // Utility functions
  loadState: () => Partial<GridState>;
  saveState: (updates: Partial<GridState>) => void;
}

export function useFreqholeState(props: FreqholeStateProps): FreqholeStateHook {
  const initialState = loadState();

  // Filter state
  const [filterConfig, setFilterConfig] = createSignal<FilterConfig>({
    name: "",
    mime: "",
    blobType: "",
    minSize: 0,
    maxSize: 0,
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
      parent_blob_id: false,
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

  const [isSettingsPanelOpen, setIsSettingsPanelOpen] = createSignal(
    initialState.isSettingsPanelOpen ?? false
  );
  const [settingsPanelWidth, setSettingsPanelWidth] = createSignal(
    initialState.settingsPanelWidth || DEFAULT_PANEL_WIDTH
  );

  // WebSocket state
  const [wsUrl, setWsUrl] = createSignal(initialState.wsUrl || props.wsUrl);
  const [autoConnect, setAutoConnect] = createSignal(
    initialState.autoConnect ?? props.autoConnect
  );
  const [autoRefresh, setAutoRefresh] = createSignal(
    initialState.autoRefresh ?? true
  );
  const [debug, setDebug] = createSignal(initialState.debug ?? false);

  // UI interaction state
  const [popupPreview, setPopupPreview] = createSignal<{
    item: MediaBlob;
    isOpen: boolean;
  } | null>(null);

  const [actionMenu, setActionMenu] = createSignal<{
    item: MediaBlob;
    isOpen: boolean;
    position: { x: number; y: number };
  } | null>(null);

  const [bulkActionMenu, setBulkActionMenu] = createSignal<{
    isOpen: boolean;
    position: { x: number; y: number };
  } | null>(null);

  const [confirmDialog, setConfirmDialog] = createSignal<{
    isOpen: boolean;
    title: string;
    message: string;
    items?: MediaBlob[];
    onConfirm: () => void;
  } | null>(null);

  const [headerActionMenu, setHeaderActionMenu] = createSignal<{
    isOpen: boolean;
    position: { x: number; y: number };
  } | null>(null);

  // Logs
  const [logs, setLogs] = createSignal<string[]>([]);

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

  const toggleSettingsPanel = () => {
    setIsSettingsPanelOpen((prev) => {
      const newValue = !prev;
      saveState({ isSettingsPanelOpen: newValue });
      return newValue;
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

    isSettingsPanelOpen,
    setIsSettingsPanelOpen: (open) => {
      setIsSettingsPanelOpen(open);
      saveState({ isSettingsPanelOpen: open });
    },
    toggleSettingsPanel,
    settingsPanelWidth,
    setSettingsPanelWidth: (width) => {
      setSettingsPanelWidth(width);
      saveState({ settingsPanelWidth: width });
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

    // UI interaction state
    popupPreview,
    setPopupPreview,
    actionMenu,
    setActionMenu,
    bulkActionMenu,
    setBulkActionMenu,
    confirmDialog,
    setConfirmDialog,
    headerActionMenu,
    setHeaderActionMenu,

    // Logs
    logs,
    setLogs,

    // Mock WebSocket state
    connectionStatus,
    setConnectionStatus,
    hasPendingUpdates,
    setHasPendingUpdates,
    lastUpdated,
    setLastUpdated,

    // Utility functions
    loadState,
    saveState,
  };
}
