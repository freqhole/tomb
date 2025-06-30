import { createSignal, createMemo, onMount } from "solid-js";
import type {
  MediaBlob,
  FilterConfig,
  GridViewMode,
  ColumnVisibility,
  GridState,
  SortField,
} from "./types";
import { BrowsePanel } from "./BrowsePanel";
import { FilterPanel } from "./FilterPanel";
import { EdgeToggleButton } from "./EdgeToggleButton";
import { InfiniteDataGrid } from "../../components/infinite-data-grid";
import type { GridColumn } from "../../components/infinite-data-grid/types";

export interface FreqholeDemoProps {
  wsUrl: string;
  apiBaseUrl: string;
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

export function FreqholeDemo(props: FreqholeDemoProps) {
  const initialState = loadState();

  // State
  const [items, setItems] = createSignal<MediaBlob[]>([]);
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

  const [sortConfig, setSortConfig] = createSignal({
    field: "created_at",
    direction: "desc",
    ...(initialState.sortConfig || {}),
  });

  const [viewMode, setViewMode] = createSignal<GridViewMode>(
    (initialState.viewMode as GridViewMode) || "default"
  );

  const [columnVisibility, setColumnVisibility] =
    createSignal<ColumnVisibility>({
      id: true,
      thumbnail: true,
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

  const [wsUrl, setWsUrl] = createSignal(props.wsUrl);
  const [autoConnect, setAutoConnect] = createSignal(props.autoConnect);
  const [autoRefresh, setAutoRefresh] = createSignal(true);
  const [debug, setDebug] = createSignal(false);
  const [logs, setLogs] = createSignal<string[]>([]);

  // Mock WebSocket state
  const [connectionStatus, setConnectionStatus] = createSignal("Disconnected");
  const [hasPendingUpdates, setHasPendingUpdates] = createSignal(false);
  const [lastUpdated, setLastUpdated] = createSignal<Date | null>(null);

  // Computed values
  const filteredData = createMemo(() => {
    const config = filterConfig();
    return items().filter((item) => {
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
      if (config.mime && !item.mime?.startsWith(config.mime)) {
        return false;
      }

      // Blob type filter
      if (config.blobType && item.blob_type !== config.blobType) {
        return false;
      }

      // Size filter
      if (item.size < config.minSize || item.size > config.maxSize) {
        return false;
      }

      // Has parent filter
      if (config.hasParent !== "all") {
        const hasParent = !!item.parent_id;
        if (config.hasParent === "yes" && !hasParent) return false;
        if (config.hasParent === "no" && hasParent) return false;
      }

      // Has local path filter
      if (config.hasLocalPath !== "all") {
        const hasLocalPath = !!item.local_path;
        if (config.hasLocalPath === "yes" && !hasLocalPath) return false;
        if (config.hasLocalPath === "no" && hasLocalPath) return false;
      }

      return true;
    });
  });

  const sortedData = createMemo(() => {
    const config = sortConfig();
    const data = [...filteredData()];

    return data.sort((a, b) => {
      const aValue = (a as any)[config.field];
      const bValue = (b as any)[config.field];

      let comparison = 0;
      if (aValue < bValue) comparison = -1;
      else if (aValue > bValue) comparison = 1;

      return config.direction === "desc" ? comparison * -1 : comparison;
    });
  });

  const visibleColumns = createMemo((): GridColumn<MediaBlob>[] => {
    const vis = columnVisibility();
    const columns: GridColumn<MediaBlob>[] = [];

    if (vis.id) {
      columns.push({
        key: "id",
        title: "ID",
        width: 200,
        sortable: true,
        render: (item) => (
          <span style="font-family: monospace; font-size: 12px;">
            {item.id}
          </span>
        ),
      });
    }

    if (vis.thumbnail) {
      columns.push({
        key: "thumbnail",
        title: "📷",
        width: 60,
        render: (item) => (
          <div
            style={`
              width: 40px;
              height: 40px;
              border-radius: 4px;
              overflow: hidden;
              background: #333;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 12px;
            `}
          >
            {item.mime?.startsWith("image/")
              ? "🖼️"
              : item.mime?.startsWith("video/")
                ? "🎥"
                : item.mime?.startsWith("audio/")
                  ? "🎵"
                  : "📄"}
          </div>
        ),
      });
    }

    if (vis.mime) {
      columns.push({
        key: "mime",
        title: "MIME Type",
        width: 150,
        sortable: true,
        render: (item) => <span>{item.mime || "unknown"}</span>,
      });
    }

    if (vis.blob_type) {
      columns.push({
        key: "blob_type",
        title: "Type",
        width: 100,
        sortable: true,
      });
    }

    if (vis.size) {
      columns.push({
        key: "size",
        title: "Size",
        width: 100,
        sortable: true,
        render: (item) => <span>{formatFileSize(item.size)}</span>,
      });
    }

    if (vis.parent_id) {
      columns.push({
        key: "parent_id",
        title: "Parent",
        width: 120,
        render: (item) => <span>{item.parent_id ? "Yes" : "No"}</span>,
      });
    }

    if (vis.local_path) {
      columns.push({
        key: "local_path",
        title: "Local Path",
        width: 200,
        render: (item) => <span>{item.local_path || "None"}</span>,
      });
    }

    if (vis.created_at) {
      columns.push({
        key: "created_at",
        title: "Created",
        width: 140,
        sortable: true,
        render: (item) => (
          <span>{new Date(item.created_at).toLocaleString()}</span>
        ),
      });
    }

    if (vis.updated_at) {
      columns.push({
        key: "updated_at",
        title: "Updated",
        width: 140,
        sortable: true,
        render: (item) => (
          <span>{new Date(item.updated_at).toLocaleString()}</span>
        ),
      });
    }

    if (vis.actions) {
      columns.push({
        key: "actions",
        title: "Actions",
        width: 100,
        render: (item) => (
          <button
            style={`
              background: #0070f3;
              border: none;
              color: white;
              padding: 4px 8px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
            `}
            onClick={() =>
              window.open(`${props.apiBaseUrl}/api/blobs/${item.id}`, "_blank")
            }
          >
            View
          </button>
        ),
      });
    }

    return columns;
  });

  const mimeCategories = createMemo(() => {
    const unique = [
      ...new Set(
        items()
          .map((item) => item.mime?.split("/")[0])
          .filter(Boolean)
      ),
    ] as string[];
    return unique.sort();
  });

  const blobTypes = createMemo(() => {
    const unique = [...new Set(items().map((item) => item.blob_type))];
    return unique.sort();
  });

  // Actions
  const updateFilter = (key: keyof FilterConfig, value: any) => {
    setFilterConfig((prev) => ({ ...prev, [key]: value }));
    saveState({ filterConfig: { ...filterConfig(), [key]: value } });
  };

  const handleSort = (field: string, direction: "asc" | "desc") => {
    setSortConfig({ field, direction });
    saveState({ sortConfig: { field: field as SortField, direction } });
  };

  const handleViewModeChange = (mode: GridViewMode) => {
    setViewMode(mode);
    saveState({ viewMode: mode });
  };

  const toggleColumnVisibility = (column: keyof ColumnVisibility) => {
    setColumnVisibility((prev) => {
      const updated = { ...prev, [column]: !prev[column] };
      saveState({ columnVisibility: updated });
      return updated;
    });
  };

  const toggleBrowsePanel = () => {
    setIsBrowsePanelOpen((prev) => {
      const newValue = !prev;
      saveState({ isBrowsePanelOpen: newValue });
      return newValue;
    });
  };

  const toggleFilterPanel = () => {
    setIsFilterPanelOpen((prev) => {
      const newValue = !prev;
      saveState({ isFilterPanelOpen: newValue });
      return newValue;
    });
  };

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [`${timestamp}: ${message}`, ...prev.slice(0, 49)]);
  };

  // Mock data loading
  onMount(async () => {
    addLog("🚀 FreqholeDemo mounted");

    try {
      const response = await fetch(`${props.apiBaseUrl}/api/blobs`);
      if (response.ok) {
        const data = await response.json();
        setItems(data);
        setLastUpdated(new Date());
        addLog(`📦 Loaded ${data.length} media blobs`);
      } else {
        // Fallback to mock data
        addLog("⚠️ Using mock data (server not available)");
        setItems(generateMockData());
        setLastUpdated(new Date());
      }
    } catch (error) {
      addLog("⚠️ Using mock data (server error)");
      setItems(generateMockData());
      setLastUpdated(new Date());
    }

    if (props.autoConnect) {
      setConnectionStatus("Connected");
      addLog("🔌 Auto-connected to WebSocket");
    }
  });

  return (
    <div
      style={`
        height: 100vh;
        background: #000000;
        color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        display: flex;
        overflow: hidden;
      `}
    >
      {/* Browse Panel */}
      <BrowsePanel
        isOpen={isBrowsePanelOpen()}
        filterConfig={filterConfig()}
        onTogglePanel={toggleBrowsePanel}
        onFilterChange={updateFilter}
        onWidthChange={(width) => {
          setBrowsePanelWidth(width);
          saveState({ browsePanelWidth: width });
        }}
        initialWidth={browsePanelWidth()}
      />

      {/* Main Content */}
      <div style="flex: 1; position: relative; overflow: hidden; min-width: 0;">
        <InfiniteDataGrid
          data={sortedData()}
          columns={visibleColumns()}
          onSort={handleSort}
          sortField={sortConfig().field}
          sortDirection={sortConfig().direction as "asc" | "desc"}
          rowHeight={
            viewMode() === "compact" ? 40 : viewMode() === "detailed" ? 80 : 60
          }
          headerHeight={60}
          getItemId={(item) => item.id}
        />
      </div>

      {/* Edge Toggle Buttons */}
      <EdgeToggleButton
        isVisible={!isBrowsePanelOpen()}
        position="left"
        panelName="Browse"
        onClick={toggleBrowsePanel}
      />

      <EdgeToggleButton
        isVisible={!isFilterPanelOpen()}
        position="right"
        panelName="Controls"
        onClick={toggleFilterPanel}
      />

      {/* Filter Panel */}
      <FilterPanel
        isOpen={isFilterPanelOpen()}
        filterConfig={filterConfig()}
        viewMode={viewMode()}
        columnVisibility={columnVisibility()}
        wsUrl={wsUrl()}
        autoConnect={autoConnect()}
        autoRefresh={autoRefresh()}
        debug={debug()}
        connectionStatus={connectionStatus()}
        hasPendingUpdates={hasPendingUpdates()}
        pendingUpdatesCount={0}
        filteredCount={filteredData().length}
        totalCount={items().length}
        sortConfig={sortConfig()}
        lastUpdated={lastUpdated()}
        mimeCategories={mimeCategories()}
        blobTypes={blobTypes()}
        logs={logs()}
        onTogglePanel={toggleFilterPanel}
        onFilterChange={updateFilter}
        onViewModeChange={handleViewModeChange}
        onColumnToggle={toggleColumnVisibility}
        onWsUrlChange={setWsUrl}
        onConnect={() => {
          setConnectionStatus("Connected");
          addLog("🔌 Connected to WebSocket");
        }}
        onDisconnect={() => {
          setConnectionStatus("Disconnected");
          addLog("🔌 Disconnected from WebSocket");
        }}
        onRefresh={async () => {
          addLog("🔄 Refreshing data...");
          try {
            const response = await fetch(`${props.apiBaseUrl}/api/blobs`);
            if (response.ok) {
              const data = await response.json();
              setItems(data);
              setLastUpdated(new Date());
              addLog(`📦 Refreshed ${data.length} media blobs`);
            }
          } catch (error) {
            addLog("❌ Refresh failed");
          }
        }}
        onApplyPendingUpdates={() => {
          setHasPendingUpdates(false);
          addLog("📥 Applied pending updates");
        }}
        onToggleAutoConnect={() => {
          setAutoConnect((prev) => !prev);
          addLog(`🔧 Auto-connect: ${!autoConnect() ? "ON" : "OFF"}`);
        }}
        onToggleAutoRefresh={() => {
          setAutoRefresh((prev) => !prev);
          addLog(`🔧 Auto-refresh: ${!autoRefresh() ? "ON" : "OFF"}`);
        }}
        onToggleDebug={() => {
          setDebug((prev) => !prev);
          addLog(`🐛 Debug: ${!debug() ? "ON" : "OFF"}`);
        }}
        onReset={() => {
          if (
            confirm(
              "Reset all filters, sort settings, and panel width? This will reload the page."
            )
          ) {
            localStorage.removeItem(STORAGE_KEY);
            window.location.reload();
          }
        }}
        onWidthChange={(width) => {
          setFilterPanelWidth(width);
          saveState({ filterPanelWidth: width });
        }}
        initialWidth={filterPanelWidth()}
      />

      <style>{`
        body.resizing {
          cursor: col-resize;
          user-select: none;
        }
      `}</style>
    </div>
  );
}

// Helper functions
function getDisplayFilename(item: MediaBlob): string {
  if (item.local_path) {
    const parts = item.local_path.split(/[/\\]/);
    return parts[parts.length - 1] || item.id;
  }
  return item.id;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function generateMockData(): MediaBlob[] {
  const mimeTypes = [
    "image/jpeg",
    "image/png",
    "video/mp4",
    "audio/mp3",
    "text/plain",
    "application/pdf",
  ];
  const blobTypes = ["upload", "thumbnail", "processed", "backup"];

  return Array.from({ length: 1000 }, (_, i) => ({
    id: `blob-${i + 1}`,
    mime: mimeTypes[Math.floor(Math.random() * mimeTypes.length)],
    blob_type: blobTypes[Math.floor(Math.random() * blobTypes.length)],
    size: Math.floor(Math.random() * 10000000),
    parent_id:
      Math.random() > 0.7
        ? `blob-${Math.floor(Math.random() * i) + 1}`
        : undefined,
    local_path: Math.random() > 0.5 ? `/path/to/file-${i + 1}.ext` : undefined,
    created_at: new Date(
      Date.now() - Math.random() * 86400000 * 30
    ).toISOString(),
    updated_at: new Date(
      Date.now() - Math.random() * 86400000 * 7
    ).toISOString(),
  })) as MediaBlob[];
}

export default FreqholeDemo;
