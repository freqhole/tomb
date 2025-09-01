/* @jsxImportSource solid-js */
import { render } from "solid-js/web";
import {
  createSignal,
  createMemo,
  onMount,
  onCleanup,
  For,
  Show,
} from "solid-js";
import { GenericInfiniteGrid, GridColumn } from "./generic-infinite-grid";
import { useWebSocketFeed } from "../hooks/useWebSocketFeed";
import type { MediaBlob, NotificationChannel } from "../lib/websocket-types";
import { ConnectionStatus } from "../lib/websocket-client";

console.log("🚀 MediaBlob Data Grid script loading");

type SortField = keyof MediaBlob;
type SortDirection = "asc" | "desc" | null;

interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

interface FilterConfig {
  name: string;
  mime: string;
  blobType: string;
  minSize: number;
  maxSize: number;
  hasParent: string; // "all" | "yes" | "no"
  hasLocalPath: string; // "all" | "yes" | "no"
}

type GridViewMode = "default" | "compact" | "detailed";

interface ColumnVisibility {
  thumbnail: boolean;
  id: boolean;
  sha256: boolean;
  name: boolean;
  blob_type: boolean;
  mime: boolean;
  size: boolean;
  parent_blob_id: boolean;
  local_path: boolean;
  created_at: boolean;
  updated_at: boolean;
  actions: boolean;
}

interface GridState {
  sortConfig: SortConfig;
  filterConfig: FilterConfig;
  isFilterPanelOpen: boolean;
  filterPanelWidth: number;
  isBrowsePanelOpen: boolean;
  browsePanelWidth: number;
  wsUrl: string;
  autoConnect: boolean;
  autoRefresh: boolean;
  debug: boolean;
  columnVisibility: ColumnVisibility;
  viewMode: GridViewMode;
  selectedItems: Set<string>;
}

const STORAGE_KEY = "mediablob-grid-state";
const DEFAULT_FILTER_PANEL_WIDTH = 400;

// Load state from localStorage
function loadGridState(): Partial<GridState> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.warn("Failed to load grid state from localStorage:", error);
    return {};
  }
}

// Save state to localStorage
function saveGridState(state: Partial<GridState>) {
  try {
    const stored = loadGridState();
    const newState = { ...stored, ...state };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
  } catch (error) {
    console.warn("Failed to save grid state to localStorage:", error);
  }
}

// Import utilities from lib instead of inline implementation
import {
  getThumbnails,
  hasThumbnails,
  getThumbnailFallbackIcon,
  createDataUrl,
} from "../lib/thumbnail-utils";

// Helper function to get display filename like MediaBlobFeedItem
function getDisplayFilename(item: MediaBlob): string {
  // Check metadata for original filename first
  if (item.metadata && typeof item.metadata === "object") {
    const meta = item.metadata as any;
    if (
      meta.originalName ||
      meta.filename ||
      meta.original_filename ||
      meta.file_name ||
      meta.name
    ) {
      return (
        meta.originalName ||
        meta.filename ||
        meta.original_filename ||
        meta.file_name ||
        meta.name
      );
    }
  }

  // Fallback to existing logic
  return (
    (item as any).filename ||
    item.local_path?.split("/").pop() ||
    `${item.sha256.slice(0, 8)}...${item.sha256.slice(-4)}`
  );
}

// Helper function to get MIME category (e.g., "audio" from "audio/mp3")
function getMimeCategory(mimeType: string): string {
  if (!mimeType) return "unknown";
  return mimeType.split("/")[0];
}

// Helper functions for media type detection
function isVideoType(mimeType: string): boolean {
  return mimeType.startsWith("video/");
}

function isAudioType(mimeType: string): boolean {
  return mimeType.startsWith("audio/");
}

function isTextType(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType.includes("json") ||
    mimeType.includes("xml")
  );
}

function MediaBlobDataGrid() {
  console.log("📦 MediaBlobDataGrid component created");

  // Load initial state from localStorage
  const initialState = loadGridState();

  // State
  const [sortConfig, setSortConfig] = createSignal<SortConfig>(
    initialState.sortConfig || {
      field: "created_at",
      direction: "desc",
    }
  );
  const [filterConfig, setFilterConfig] = createSignal<FilterConfig>(
    initialState.filterConfig || {
      name: "",
      mime: "",
      blobType: "",
      minSize: 0,
      maxSize: 100000000, // 100MB
      hasParent: "all",
      hasLocalPath: "all",
    }
  );
  const [isFilterPanelOpen, setIsFilterPanelOpen] = createSignal(
    initialState.isFilterPanelOpen ?? true
  );
  const [filterPanelWidth, setFilterPanelWidth] = createSignal(
    initialState.filterPanelWidth || DEFAULT_FILTER_PANEL_WIDTH
  );
  const [isBrowsePanelOpen, setIsBrowsePanelOpen] = createSignal(
    initialState.isBrowsePanelOpen ?? true
  );
  const [browsePanelWidth, setBrowsePanelWidth] = createSignal(
    initialState.browsePanelWidth || DEFAULT_FILTER_PANEL_WIDTH
  );
  const [isDragging, setIsDragging] = createSignal(false);
  const [isDraggingBrowse, setIsDraggingBrowse] = createSignal(false);
  const [wsUrl, setWsUrl] = createSignal(
    initialState.wsUrl || "ws://localhost:8080/ws"
  );
  const [autoConnect, setAutoConnect] = createSignal(
    initialState.autoConnect ?? true
  );
  const [autoRefresh, setAutoRefresh] = createSignal(
    initialState.autoRefresh ?? false
  );
  const [debug, setDebug] = createSignal(initialState.debug ?? false);
  const [logs, setLogs] = createSignal<string[]>([]);
  const [viewMode, setViewMode] = createSignal<GridViewMode>(
    initialState.viewMode || "default"
  );
  const [columnVisibility, setColumnVisibility] =
    createSignal<ColumnVisibility>(
      initialState.columnVisibility || {
        thumbnail: true,
        id: false, // Hidden by default
        sha256: false, // Hidden by default
        name: true,
        blob_type: true,
        mime: true,
        size: true,
        parent_blob_id: true,
        local_path: true,
        created_at: true,
        updated_at: true,
        actions: true,
      }
    );
  const [showColumnSettings, setShowColumnSettings] = createSignal(false);
  const [popupViewer, setPopupViewer] = createSignal<{
    item: MediaBlob;
    show: boolean;
  } | null>(null);
  const [showThumbnailPlaceholder, setShowThumbnailPlaceholder] = createSignal<
    Set<string>
  >(new Set());
  const [activeActionMenu, setActiveActionMenu] = createSignal<{
    item: MediaBlob;
    x: number;
    y: number;
  } | null>(null);
  const [selectedItems, setSelectedItems] = createSignal<Set<string>>(
    new Set(
      initialState.selectedItems ? Array.from(initialState.selectedItems) : []
    )
  );
  const [lastSelectedIndex, setLastSelectedIndex] = createSignal<number>(-1);
  const [isDragSelecting, setIsDragSelecting] = createSignal(false);
  const [dragStart, setDragStart] = createSignal<{
    x: number;
    y: number;
    startIndex: number;
  } | null>(null);
  const [dragEnd, setDragEnd] = createSignal<{
    x: number;
    y: number;
    endIndex: number;
  } | null>(null);
  const [clickTimeout, setClickTimeout] = createSignal<number | null>(null);

  // WebSocket feed hook
  const feed = useWebSocketFeed({
    wsUrl: wsUrl(),
    channels: ["MediaBlobs"] as NotificationChannel[],
    debug: debug(),
    autoConnect: autoConnect(),
    autoRefresh: autoRefresh(),
    pageSize: 50,
  });

  const addLog = (message: string) => {
    if (debug()) {
      const timestamp = new Date().toLocaleTimeString();
      setLogs((prev) => [...prev.slice(-19), `[${timestamp}] ${message}`]);
    }
  };

  // Filtered and sorted data
  const filteredData = createMemo(() => {
    const filters = filterConfig();
    return feed.state().items.filter((item) => {
      const filename = getDisplayFilename(item);
      const mimeCategory = getMimeCategory(item.mime || "");

      return (
        filename.toLowerCase().includes(filters.name.toLowerCase()) &&
        (filters.mime === "" || mimeCategory === filters.mime) &&
        (filters.blobType === "" || item.blob_type === filters.blobType) &&
        (item.size || 0) >= filters.minSize &&
        (item.size || 0) <= filters.maxSize &&
        (filters.hasParent === "all" ||
          (filters.hasParent === "yes" && item.parent_blob_id) ||
          (filters.hasParent === "no" && !item.parent_blob_id)) &&
        (filters.hasLocalPath === "all" ||
          (filters.hasLocalPath === "yes" && item.local_path) ||
          (filters.hasLocalPath === "no" && !item.local_path))
      );
    });
  });

  const sortedData = createMemo(() => {
    const config = sortConfig();

    // If no direction (null), return unsorted filtered data
    if (!config.direction) {
      return filteredData();
    }

    const sorted = [...filteredData()];

    return sorted.sort((a, b) => {
      let aVal, bVal;

      // Find the column definition to check for custom getValue function
      const column = allColumns.find((col) => col.key === config.field);

      if (column && column.getValue) {
        // Use custom getValue function if available
        aVal = column.getValue(a);
        bVal = column.getValue(b);
      } else {
        // Use direct property access
        aVal = (a as any)[config.field];
        bVal = (b as any)[config.field];
      }

      let comparison = 0;
      if (aVal < bVal) comparison = -1;
      if (aVal > bVal) comparison = 1;

      return config.direction === "desc" ? -comparison : comparison;
    });
  });

  // Thumbnail helpers using lib utilities
  const getThumbnailUrl = (item: MediaBlob): string | null => {
    const thumbs = getThumbnails(item);
    if (
      thumbs.length > 0 &&
      thumbs[0] &&
      thumbs[0].data &&
      thumbs[0].data.length > 0
    ) {
      const mimeType = thumbs[0].mime || "image/webp";
      return createDataUrl(thumbs[0].data, mimeType);
    }
    return null;
  };

  const handleViewModeChange = (mode: GridViewMode) => {
    setViewMode(mode);
    saveGridState({ viewMode: mode });
    addLog(`View mode changed to: ${mode}`);
  };

  // Calculate row height based on view mode and content
  const getRowHeight = () => {
    switch (viewMode()) {
      case "compact":
        return 35;
      case "detailed":
        return 120;
      default:
        return 50;
    }
  };

  // Helper function to download blob
  const downloadBlob = async (item: MediaBlob) => {
    try {
      const filename = getDisplayFilename(item);
      // Simple download implementation
      const link = document.createElement("a");
      link.href = `/api/blobs/${item.id}`;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      addLog(`📥 Downloaded: ${filename}`);
    } catch (error) {
      console.error("Download failed:", error);
      addLog(`❌ Download failed: ${error}`);
    }
  };

  // Toggle action menu
  const toggleActionMenu = (item: MediaBlob, event: MouseEvent) => {
    console.log("toggleActionMenu called for:", item.id);

    const currentMenu = activeActionMenu();
    if (currentMenu && currentMenu.item.id === item.id) {
      // Close if clicking same item
      setActiveActionMenu(null);
      addLog(`⋯ Action menu closed for: ${getDisplayFilename(item)}`);
    } else {
      // Open menu at button position
      const rect = (event.target as HTMLElement).getBoundingClientRect();
      const menuWidth = 120;
      const menuHeight = 120;

      // Calculate optimal position
      let x = rect.right - menuWidth;
      let y = rect.bottom + 4;

      // Adjust if menu would go off screen
      if (x < 0) {
        x = rect.left;
      }
      if (x + menuWidth > window.innerWidth) {
        x = window.innerWidth - menuWidth - 8;
      }
      if (y + menuHeight > window.innerHeight) {
        y = rect.top - menuHeight - 4;
      }

      setActiveActionMenu({
        item,
        x,
        y,
      });
      console.log("Action menu positioned at:", { x, y, rect });
      addLog(`⋯ Action menu opened for: ${getDisplayFilename(item)}`);
    }
  };

  // Close all action menus
  const closeAllActionMenus = () => {
    setActiveActionMenu(null);
  };

  // Selection handlers
  const handleRowClick = (
    item: MediaBlob,
    index: number,
    event: MouseEvent
  ) => {
    const itemId = item.id;
    const currentSelection = selectedItems();
    const isSelected = currentSelection.has(itemId);

    // Clear any existing click timeout
    const existingTimeout = clickTimeout();
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      setClickTimeout(null);
    }

    // Delay single-click actions to allow for double-click detection
    const timeoutId = window.setTimeout(() => {
      if (event.metaKey || event.ctrlKey) {
        // Toggle selection with Cmd/Ctrl
        setSelectedItems((prev) => {
          const newSet = new Set(prev);
          if (isSelected) {
            newSet.delete(itemId);
          } else {
            newSet.add(itemId);
          }
          saveGridState({ selectedItems: newSet });
          return newSet;
        });
        setLastSelectedIndex(index);
      } else if (event.shiftKey && lastSelectedIndex() >= 0) {
        // Range selection with Shift
        const startIndex = Math.min(lastSelectedIndex(), index);
        const endIndex = Math.max(lastSelectedIndex(), index);
        const rangeItems = sortedData().slice(startIndex, endIndex + 1);

        setSelectedItems((prev) => {
          const newSet = new Set(prev);
          rangeItems.forEach((rangeItem) => newSet.add(rangeItem.id));
          saveGridState({ selectedItems: newSet });
          return newSet;
        });
      } else {
        // Single selection
        const newSelection = new Set([itemId]);
        setSelectedItems(newSelection);
        setLastSelectedIndex(index);
        saveGridState({ selectedItems: newSelection });
      }
      setClickTimeout(null);
    }, 200); // 200ms delay to detect double-click

    setClickTimeout(timeoutId);

    // Prevent default for modifier keys to avoid interfering with double-click
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      event.preventDefault();
    }
  };

  const clearSelection = () => {
    setSelectedItems(new Set<string>());
    setLastSelectedIndex(-1);
    saveGridState({ selectedItems: new Set<string>() });
  };

  const selectAll = () => {
    const allIds = new Set(sortedData().map((item) => item.id));
    setSelectedItems(allIds);
    saveGridState({ selectedItems: allIds });
  };

  // Bulk actions
  const downloadSelectedItems = async () => {
    const selected = Array.from(selectedItems());
    const items = sortedData().filter((item) => selected.includes(item.id));

    for (const item of items) {
      await downloadBlob(item);
    }
    addLog(`📥 Downloaded ${items.length} items`);
  };

  const addToPlaylist = (items: MediaBlob[]) => {
    // Stub for add to playlist
    addLog(`🎵 Added ${items.length} items to playlist (stub)`);
  };

  const deleteItems = (items: MediaBlob[]) => {
    // Stub for delete
    addLog(`🗑️ Deleted ${items.length} items (stub)`);
  };

  // Drag selection handlers
  const handleRowMouseDown = (
    item: MediaBlob,
    index: number,
    event: MouseEvent
  ) => {
    // Only start drag selection if no modifier keys and it's a left click
    // and we're not in the middle of a potential double-click
    if (
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !clickTimeout() // Don't start drag if we have a pending click
    ) {
      const rect = (event.target as HTMLElement).getBoundingClientRect();
      setDragStart({
        x: event.clientX,
        y: event.clientY,
        startIndex: index,
      });
    }
  };

  const handleMouseMove = (event: MouseEvent) => {
    const start = dragStart();
    if (start && !isDragSelecting()) {
      const distance = Math.sqrt(
        Math.pow(event.clientX - start.x, 2) +
          Math.pow(event.clientY - start.y, 2)
      );
      if (distance > 5) {
        setIsDragSelecting(true);
      }
    }

    if (isDragSelecting() && start) {
      // Calculate current row index based on mouse position
      const gridElement = document.querySelector(".grid-viewport");
      if (gridElement) {
        const gridRect = gridElement.getBoundingClientRect();
        const relativeY = event.clientY - gridRect.top + gridElement.scrollTop;
        const currentIndex = Math.floor(relativeY / getRowHeight());
        const clampedIndex = Math.max(
          0,
          Math.min(sortedData().length - 1, currentIndex)
        );

        setDragEnd({
          x: event.clientX,
          y: event.clientY,
          endIndex: clampedIndex,
        });

        // Select range
        const startIdx = Math.min(start.startIndex, clampedIndex);
        const endIdx = Math.max(start.startIndex, clampedIndex);
        const rangeItems = sortedData().slice(startIdx, endIdx + 1);
        const rangeIds = new Set(rangeItems.map((item) => item.id));
        setSelectedItems(rangeIds);
      }
    }
  };

  const handleMouseUp = (event: MouseEvent) => {
    if (isDragSelecting()) {
      const selection = selectedItems();
      saveGridState({ selectedItems: selection });
      addLog(`Selected ${selection.size} items via drag`);
    }
    setIsDragSelecting(false);
    setDragStart(null);
    setDragEnd(null);
  };

  // All column definitions
  const allColumns: GridColumn<MediaBlob>[] = [
    {
      key: "thumbnail",
      title: "Thumbnail",
      width:
        viewMode() === "compact" ? 0 : viewMode() === "detailed" ? 120 : 60,
      sortable: false,
      render: (item, value) => {
        if (viewMode() === "compact") return null;

        const thumbnailUrl = getThumbnailUrl(item);
        const isDetailed = viewMode() === "detailed";
        const size = isDetailed ? "100px" : "40px";

        return (
          <div
            style={`
              width: ${size};
              height: ${size};
              border-radius: 4px;
              overflow: hidden;
              background: #333;
              display: flex;
              align-items: center;
              justify-content: center;
              position: relative;
            `}
          >
            <Show
              when={thumbnailUrl}
              fallback={
                <Show
                  when={showThumbnailPlaceholder().has(item.id)}
                  fallback={
                    <span style="font-size: 16px;">
                      {getThumbnailFallbackIcon(item.mime)}
                    </span>
                  }
                >
                  <div
                    style="
                      width: 12px;
                      height: 12px;
                      border: 2px solid #ff00ff;
                      border-top: 2px solid transparent;
                      border-radius: 50%;
                      animation: spin 1s linear infinite;
                    "
                    title="Generating thumbnail..."
                  />
                </Show>
              }
            >
              <img
                src={thumbnailUrl!}
                alt="Thumbnail"
                style={`
                  width: 100%;
                  height: 100%;
                  object-fit: cover;
                `}
                loading="lazy"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = "none";
                }}
              />
            </Show>

            <Show when={hasThumbnails(item)}>
              <div
                style="
                  position: absolute;
                  bottom: 2px;
                  right: 2px;
                  width: 8px;
                  height: 8px;
                  background: #ff00ff;
                  border-radius: 50%;
                  border: 1px solid #ffffff;
                "
                title="Has thumbnails"
              />
            </Show>
          </div>
        );
      },
    },
    {
      key: "id",
      title: "ID",
      width: 100,
      sortable: true,
      render: (item, value) => (
        <code
          style="font-size: 11px; background: #333; padding: 2px 4px; border-radius: 3px; color: #0ff;"
          title={value}
        >
          {value.slice(0, 8)}...
        </code>
      ),
    },
    {
      key: "sha256",
      title: "SHA256",
      width: 120,
      sortable: true,
      render: (item, value) => (
        <code
          style="font-size: 11px; background: #333; padding: 2px 4px; border-radius: 3px; color: #f90;"
          title={value}
        >
          {value.slice(0, 12)}...
        </code>
      ),
    },
    {
      key: "name",
      title: "Name",
      sortable: true,
      render: (item, value) => (
        <span
          style="font-weight: 500; color: #e0e0e0;"
          title={getDisplayFilename(item)}
        >
          {getDisplayFilename(item)}
        </span>
      ),
      getValue: (item) => getDisplayFilename(item),
    },
    {
      key: "blob_type",
      title: "Type",
      width: 100,
      sortable: true,
      render: (item, value) => (
        <span
          class={`blob-type-badge blob-type-${value}`}
          style={`
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            ${getBlobTypeBadgeStyle(value)}
          `}
        >
          {value}
        </span>
      ),
    },
    {
      key: "mime",
      title: "MIME Type",
      width: 140,
      sortable: true,
      render: (item, value) => (
        <span style="font-family: monospace; font-size: 12px;">
          {value || "unknown"}
        </span>
      ),
    },
    {
      key: "size",
      title: "Size",
      width: 100,
      sortable: true,
      render: (item, value) => (
        <span style="color: #ffffff; font-weight: 600; font-size: 12px;">
          {formatBytes(value || 0)}
        </span>
      ),
    },
    {
      key: "parent_blob_id",
      title: "Parent",
      width: 80,
      sortable: true,
      render: (item, value) =>
        value ? (
          <span
            style="color: #ff00ff; font-size: 11px;"
            title={`Parent: ${value}`}
          >
            ✓
          </span>
        ) : (
          <span style="color: #666;">-</span>
        ),
    },
    {
      key: "local_path",
      title: "Local",
      width: 80,
      sortable: true,
      render: (item, value) =>
        value ? (
          <span style="color: #ff00ff; font-size: 11px;" title={value}>
            📁
          </span>
        ) : (
          <span style="color: #666;">-</span>
        ),
    },
    {
      key: "created_at",
      title: "Created",
      width: 140,
      sortable: true,
      render: (item, value) => (
        <span style="font-size: 12px; color: #888;">
          {new Date(value).toLocaleString()}
        </span>
      ),
    },
    {
      key: "updated_at",
      title: "Updated",
      width: 140,
      sortable: true,
      render: (item, value) => (
        <span style="font-size: 12px; color: #888;">
          {new Date(value).toLocaleString()}
        </span>
      ),
    },
    {
      key: "actions",
      title: "Actions",
      width: 60,
      sortable: false,
      renderHeader: () => (
        <button
          style="
                background: #3a3a3a;
                border: 1px solid #4a4a4a;
                color: #e0e0e0;
                padding: 4px 8px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                width: 100%;
              "
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            toggleFilterPanel();
          }}
          title={`${isFilterPanelOpen() ? "Hide" : "Show"} Controls`}
        >
          {isFilterPanelOpen() ? "→" : "←"}
        </button>
      ),
      render: (item, value) => {
        // Only show action menu button when controls panel is open
        if (!isFilterPanelOpen()) {
          return null;
        }

        return (
          <div style="position: relative;">
            <button
              style="
                background: #3a3a3a;
                border: 1px solid #4a4a4a;
                color: #e0e0e0;
                padding: 4px 8px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
              "
              data-action-button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                console.log("Action menu button clicked for:", item.id);
                addLog(
                  `⋯ Action menu toggled for: ${getDisplayFilename(item)}`
                );
                toggleActionMenu(item, e);
              }}
            >
              ⋯
            </button>
          </div>
        );
      },
    },
  ];

  // Auto-request thumbnails for items that don't have them
  const requestThumbnailIfNeeded = (item: MediaBlob) => {
    const alreadyRequested =
      feed.state().requestedThumbnails.has(item.id) ||
      item.metadata?.thumbnails_requested ||
      showThumbnailPlaceholder().has(item.id);

    if (viewMode() !== "compact" && !hasThumbnails(item) && !alreadyRequested) {
      setShowThumbnailPlaceholder((prev) => new Set([...prev, item.id]));
      if (feed.actions.getThumbnails) {
        feed.actions.getThumbnails(item.id);
        // Hide placeholder after 10 seconds if no thumbnail received
        setTimeout(() => {
          setShowThumbnailPlaceholder((prev) => {
            const newSet = new Set(prev);
            newSet.delete(item.id);
            return newSet;
          });
        }, 10000);
      }
    }
  };

  // Filtered visible columns
  const visibleColumns = createMemo(() => {
    const visibility = columnVisibility();
    const mode = viewMode();

    return allColumns
      .filter((col) => {
        // Hide thumbnail column in compact mode
        if (col.key === "thumbnail" && mode === "compact") {
          return false;
        }

        // Always show actions column
        if (col.key === "actions") {
          return true;
        }

        return visibility[col.key as keyof ColumnVisibility];
      })
      .map((col) => ({
        ...col,
        // Update thumbnail column width based on view mode
        width:
          col.key === "thumbnail"
            ? mode === "detailed"
              ? 100
              : 60
            : col.width,
      }));
  });

  // Event handlers
  const handleSort = (field: string, direction: SortDirection) => {
    const newConfig = { field: field as SortField, direction };
    setSortConfig(newConfig);
    saveGridState({ sortConfig: newConfig });
  };

  const updateFilter = (key: keyof FilterConfig, value: string | number) => {
    setFilterConfig((prev) => {
      const newConfig = { ...prev, [key]: value };
      saveGridState({ filterConfig: newConfig });
      return newConfig;
    });
  };

  const toggleColumnVisibility = (columnKey: keyof ColumnVisibility) => {
    setColumnVisibility((prev) => {
      const newVisibility = { ...prev, [columnKey]: !prev[columnKey] };
      saveGridState({ columnVisibility: newVisibility });
      return newVisibility;
    });
  };

  const handleRowDoubleClick = (item: MediaBlob) => {
    // Clear any pending single-click actions
    const existingTimeout = clickTimeout();
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      setClickTimeout(null);
    }

    setPopupViewer({ item, show: true });
    addLog(`🖱️ Double-clicked: ${getDisplayFilename(item)}`);
  };

  const handleContextMenu = (
    item: MediaBlob,
    index: number,
    event: MouseEvent
  ) => {
    event.preventDefault(); // Prevent browser context menu

    const itemId = item.id;
    const currentSelection = selectedItems();
    const isSelected = currentSelection.has(itemId);

    // If right-clicking on an unselected item, select it first
    if (!isSelected) {
      setSelectedItems(new Set([itemId]));
      setLastSelectedIndex(index);
      saveGridState({ selectedItems: new Set([itemId]) });
    }

    // Calculate menu position
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    const menuWidth = 160;
    const menuHeight = 120;

    let x = event.clientX;
    let y = event.clientY;

    // Adjust position if menu would go off screen
    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 8;
    }
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 8;
    }

    // Show the appropriate menu based on final selection state
    const finalSelection = isSelected ? currentSelection : new Set([itemId]);
    const contextItem =
      finalSelection.size === 1
        ? item
        : Array.from(finalSelection)
            .map((id) => sortedData().find((dataItem) => dataItem.id === id))
            .filter(Boolean)[0] || item;

    setActiveActionMenu({
      item: contextItem,
      x,
      y,
    });

    addLog(
      `🖱️ Right-clicked: ${getDisplayFilename(item)} (${finalSelection.size} selected)`
    );
  };

  const closePopupViewer = () => {
    setPopupViewer(null);
  };

  const toggleFilterPanel = () => {
    setIsFilterPanelOpen((prev) => {
      const newValue = !prev;
      saveGridState({ isFilterPanelOpen: newValue });
      return newValue;
    });
  };

  const toggleBrowsePanel = () => {
    setIsBrowsePanelOpen((prev) => {
      const newValue = !prev;
      saveGridState({ isBrowsePanelOpen: newValue });
      return newValue;
    });
  };

  const updateWsUrl = (url: string) => {
    setWsUrl(url);
    saveGridState({ wsUrl: url });
  };

  const toggleAutoConnect = () => {
    setAutoConnect((prev) => {
      const newValue = !prev;
      saveGridState({ autoConnect: newValue });
      return newValue;
    });
  };

  const toggleAutoRefresh = () => {
    const newValue = !autoRefresh();
    setAutoRefresh(newValue);
    saveGridState({ autoRefresh: newValue });
    feed.actions.toggleAutoRefresh();
    addLog(`Auto-refresh ${newValue ? "enabled" : "disabled"}`);
  };

  const toggleDebug = () => {
    setDebug((prev) => {
      const newValue = !prev;
      saveGridState({ debug: newValue });
      return newValue;
    });
  };

  // Resize handler for the filter panel
  const handlePanelMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    document.body.classList.add("resizing");

    const startX = e.clientX;
    const startWidth = filterPanelWidth();

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startX;
      const newWidth = Math.max(300, Math.min(800, startWidth - deltaX));
      setFilterPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.classList.remove("resizing");
      saveGridState({ filterPanelWidth: filterPanelWidth() });
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  // Resize handler for the browse panel
  const handleBrowsePanelMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    setIsDraggingBrowse(true);
    document.body.classList.add("resizing");

    const startX = e.clientX;
    const startWidth = browsePanelWidth();

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startX;
      const newWidth = Math.max(300, Math.min(800, startWidth + deltaX));
      setBrowsePanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDraggingBrowse(false);
      document.body.classList.remove("resizing");
      saveGridState({ browsePanelWidth: browsePanelWidth() });
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  // Helper functions
  const getBlobTypeBadgeStyle = (type: string) => {
    switch (type) {
      case "original":
        return "background: #ff00ff; color: #000000;";
      case "thumbnail":
        return "background: #666666; color: #ffffff;";
      case "waveform":
        return "background: #444444; color: #ffffff;";
      case "preview":
        return "background: #333333; color: #ffffff;";
      default:
        return "background: #222222; color: #ffffff;";
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const getConnectionStatusStyle = (status: ConnectionStatus) => {
    switch (status) {
      case ConnectionStatus.Connected:
        return "color: #ff00ff; font-weight: 600;";
      case ConnectionStatus.Connecting:
        return "color: #ffffff; font-weight: 600;";
      case ConnectionStatus.Disconnected:
        return "color: #666666; font-weight: 600;";
      default:
        return "color: #888888;";
    }
  };

  // Get unique MIME categories for filter dropdowns
  const mimeCategories = createMemo(() => {
    const unique = [
      ...new Set(
        feed
          .state()
          .items.map((item) => getMimeCategory(item.mime || ""))
          .filter((cat) => cat !== "unknown")
      ),
    ];
    return unique.sort();
  });

  const blobTypes = createMemo(() => {
    const unique = [
      ...new Set(feed.state().items.map((item) => item.blob_type)),
    ];
    return unique.sort();
  });

  onMount(() => {
    addLog("🚀 MediaBlob Grid mounted");

    // Add global click handler to close action menus
    const handleGlobalClick = (e: Event) => {
      const target = e.target as HTMLElement;
      if (
        !target.closest(".action-menu") &&
        !target.closest("[data-action-button]") &&
        !target.closest(".bulk-action-button")
      ) {
        closeAllActionMenus();
      }
    };

    // Add keyboard handlers
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeAllActionMenus();
        setPopupViewer(null);
        clearSelection();
      } else if (e.key === "a" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        selectAll();
      } else if (e.key === "Backspace" || e.key === "Delete") {
        if (selectedItems().size > 0) {
          const items = sortedData().filter((item) =>
            selectedItems().has(item.id)
          );
          deleteItems(items);
        }
      }
    };

    document.addEventListener("click", handleGlobalClick);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    onCleanup(() => {
      document.removeEventListener("click", handleGlobalClick);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    });
  });

  onCleanup(() => {
    addLog("🧹 MediaBlob Grid cleanup");
  });

  return (
    <div class="mediablob-data-grid-container">
      <style>{`
        .mediablob-data-grid-container {
          height: 100vh;
          background: #1a1a1a;
          color: #e0e0e0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          display: flex;
          overflow: hidden;
        }


        .browse-panel {
          background: #2a2a2a;
          border-right: 1px solid #3a3a3a;
          padding: 20px;
          overflow-y: auto;
          transition: margin-left 0.3s ease;
          position: relative;
          flex-shrink: 0;
        }

        .browse-panel.resizing {
          transition: none;
          border-right-color: #ff00ff;
          box-shadow: 2px 0 8px rgba(255, 0, 255, 0.3);
        }

        .browse-panel.collapsed {
          margin-left: -${browsePanelWidth()}px;
        }

        .browse-resize-handle {
          position: absolute;
          top: 0;
          right: -4px;
          width: 8px;
          height: 100%;
          background: transparent;
          cursor: col-resize;
          z-index: 10;
          transition: background-color 0.2s;
          user-select: none;
        }

        .browse-resize-handle:hover,
        .browse-resize-handle.dragging {
          background: #ff00ff;
        }

        .browse-resize-handle::after {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 2px;
          height: 40px;
          background: #4a4a4a;
          border-radius: 1px;
          transition: background-color 0.2s;
        }

        .browse-resize-handle:hover::after,
        .browse-resize-handle.dragging::after {
          background: #ffffff;
        }

        .filter-panel {
          background: #2a2a2a;
          border-left: 1px solid #3a3a3a;
          padding: 20px;
          overflow-y: auto;
          transition: margin-right 0.3s ease;
          position: relative;
          flex-shrink: 0;
        }

        .filter-panel.resizing {
          transition: none;
          border-left-color: #ff00ff;
          box-shadow: -2px 0 8px rgba(255, 0, 255, 0.3);
        }

        .filter-panel.collapsed {
          margin-right: -${filterPanelWidth()}px;
        }

        .filter-resize-handle {
          position: absolute;
          top: 0;
          left: -4px;
          width: 8px;
          height: 100%;
          background: transparent;
          cursor: col-resize;
          z-index: 10;
          transition: background-color 0.2s;
          user-select: none;
        }

        .filter-resize-handle:hover,
        .filter-resize-handle.dragging {
          background: #ff00ff;
        }

        .filter-resize-handle::after {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 2px;
          height: 40px;
          background: #4a4a4a;
          border-radius: 1px;
          transition: background-color 0.2s;
        }

        .filter-resize-handle:hover::after,
        .filter-resize-handle.dragging::after {
          background: #ffffff;
        }

        .panel-toggle-button {
          background: #000000;
          border: 1px solid #ff00ff;
          color: #ffffff;
          padding: 8px 12px;
          cursor: pointer;
          border-radius: 4px;
          font-size: 14px;
        }

        .panel-toggle-button:hover {
          background: rgba(255, 0, 255, 0.2);
        }

        .panel-close-button {
          background: #333333;
          border: 1px solid #666666;
          color: #ffffff;
          padding: 6px 10px;
          cursor: pointer;
          border-radius: 4px;
          font-size: 12px;
          margin-bottom: 15px;
        }

        .panel-close-button:hover {
          background: rgba(255, 0, 255, 0.2);
        }

        .filter-section {
          margin-bottom: 20px;
        }

        .filter-section h3 {
          margin: 0 0 10px 0;
          font-size: 14px;
          font-weight: 600;
          color: #b0b0b0;
        }

        .filter-input {
          width: 100%;
          padding: 8px;
          background: #1a1a1a;
          border: 1px solid #3a3a3a;
          border-radius: 4px;
          color: #e0e0e0;
          font-size: 14px;
        }

        .filter-input:focus {
          outline: none;
          border-color: #0070f3;
        }

        .filter-select {
          width: 100%;
          padding: 8px;
          background: #1a1a1a;
          border: 1px solid #3a3a3a;
          border-radius: 4px;
          color: #e0e0e0;
          font-size: 14px;
        }

        .filter-range {
          display: flex;
          gap: 10px;
          align-items: center;
        }

        .filter-range input {
          flex: 1;
        }

        .main-content {
          flex: 1;
          position: relative;
        }

        .ws-button {
          background: #ff00ff;
          border: 1px solid #ff00ff;
          color: #000000;
          padding: 6px 12px;
          border-radius: 4px;
          font-size: 12px;
          cursor: pointer;
          transition: background-color 0.2s;
          margin-right: 8px;
        }

        .ws-button:hover {
          background: rgba(255, 0, 255, 0.8);
        }

        .ws-button.danger {
          background: #666666;
          border-color: #666666;
        }

        .ws-button.danger:hover {
          background: #555555;
        }

        .ws-button:disabled {
          background: #444444;
          border-color: #444444;
          color: #888888;
          cursor: not-allowed;
        }

        .toggle-button {
          background: #333333;
          border: 1px solid #666666;
          color: white;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 11px;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .toggle-button.active {
          background: #ff00ff;
          border-color: #ff00ff;
          color: #000000;
        }

        .reset-button {
          background: #666666;
          border: 1px solid #666666;
          color: white;
          padding: 6px 12px;
          border-radius: 4px;
          font-size: 12px;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .reset-button:hover {
          background: #555555;
        }

        .filter-panel.collapsed .filter-resize-handle,
        .browse-panel.collapsed .browse-resize-handle {
          display: none;
        }

        body.resizing {
          cursor: col-resize !important;
          user-select: none !important;
        }

        .main-content.resizing,
        .main-content.resizing-browse {
          pointer-events: none;
        }

        .debug-logs {
          font-size: 11px;
          font-family: monospace;
          background: #1a1a1a;
          border: 1px solid #3a3a3a;
          border-radius: 4px;
          padding: 8px;
          max-height: 120px;
          overflow-y: auto;
          color: #888;
        }

        .view-mode-selector {
          display: flex;
          gap: 4px;
          margin-bottom: 12px;
        }

        .view-mode-button {
          flex: 1;
          padding: 6px 8px;
          background: #3a3a3a;
          border: 1px solid #4a4a4a;
          color: #e0e0e0;
          border-radius: 4px;
          cursor: pointer;
          font-size: 11px;
          text-align: center;
          transition: all 0.2s;
        }

        .view-mode-button.active {
          background: #ff00ff;
          border-color: #ff00ff;
          color: #000000;
        }

        .view-mode-button:hover:not(.active) {
          background: rgba(255, 0, 255, 0.1);
        }

        .inline-media {
          max-height: 100px;
          border-radius: 4px;
          object-fit: cover;
          margin-top: 8px;
        }

        .detailed-row-content {
          display: flex;
          flex-direction: column;
          gap: 8px;
          width: 100%;
        }

        .detailed-row-top {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .detailed-row-bottom {
          display: flex;
          gap: 8px;
          align-items: center;
          font-size: 12px;
          color: #888;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .column-settings {
          background: #1a1a1a;
          border: 1px solid #3a3a3a;
          border-radius: 4px;
          padding: 12px;
          margin-top: 8px;
        }

        .column-settings.collapsed {
          display: none;
        }

        .column-toggle {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;
          font-size: 12px;
        }

        .column-toggle input {
          margin-right: 8px;
        }

        .popup-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.8);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          backdrop-filter: blur(4px);
        }

        .popup-content {
          background: #2a2a2a;
          border-radius: 8px;
          padding: 20px;
          max-width: 90vw;
          max-height: 90vh;
          overflow: auto;
          position: relative;
          border: 1px solid #3a3a3a;
        }

        .popup-close {
          position: absolute;
          top: 12px;
          right: 12px;
          background: #ef4444;
          border: none;
          color: white;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          font-weight: bold;
        }

        .popup-close:hover {
          background: #dc2626;
        }

        .popup-image {
          max-width: 80vw;
          max-height: 70vh;
          object-fit: contain;
          border-radius: 4px;
        }

        .popup-video {
          max-width: 80vw;
          max-height: 70vh;
          border-radius: 4px;
        }

        .popup-meta {
          margin-top: 16px;
          padding-top: 16px;
          border-top: 1px solid #3a3a3a;
          font-size: 14px;
          color: #b0b0b0;
        }

        .popup-meta-row {
          display: flex;
          justify-content: space-between;
          margin-bottom: 8px;
        }

        .popup-meta-label {
          font-weight: 600;
          color: #e0e0e0;
        }

        .action-menu {
          position: fixed !important;
          background: #1a1a1a !important;
          border: 1px solid #ff00ff !important;
          border-radius: 4px !important;
          padding: 4px 0 !important;
          min-width: 120px !important;
          z-index: 999999 !important;
          box-shadow: 0 4px 12px rgba(255, 0, 255, 0.3) !important;
          max-height: 200px !important;
          overflow-y: auto !important;
          visibility: visible !important;
          opacity: 1 !important;
          pointer-events: auto !important;
          display: block !important;
          transform: translateZ(0) !important;
        }

        .action-menu-item {
          width: 100%;
          padding: 8px 12px;
          background: none;
          border: none;
          color: #ffffff;
          text-align: left;
          cursor: pointer;
          font-size: 12px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .action-menu-item:hover {
          background: rgba(255, 0, 255, 0.2);
        }



        .bulk-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: #ff00ff;
          color: #000000;
          border-radius: 4px;
          font-size: 12px;
          box-shadow: 0 2px 8px rgba(255, 0, 255, 0.3);
          animation: slideInFromLeft 0.3s ease-out;
        }

        @keyframes slideInFromLeft {
          from {
            opacity: 0;
            transform: translateX(-20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        .bulk-action-button {
          background: #000000;
          border: 1px solid #ff00ff;
          color: #ffffff;
          padding: 4px 8px;
          border-radius: 3px;
          cursor: pointer;
          font-size: 11px;
        }

        .bulk-action-button:hover {
          background: rgba(255, 0, 255, 0.2);
        }

        .drag-selecting {
          user-select: none;
          cursor: crosshair;
        }

        .drag-selection-box {
          position: fixed;
          border: 2px dashed #ff00ff;
          background: rgba(255, 0, 255, 0.1);
          pointer-events: none;
          z-index: 999;
        }

        .grid-row {
          cursor: pointer;
        }

        .grid-row:hover {
          cursor: pointer;
        }

        .toolbar-container {
          position: absolute;
          bottom: 20px;
          left: 20px;
          z-index: 10;
          display: flex;
          flex-direction: column;
          gap: 12px;
          align-items: flex-start;
        }

        .controls-row {
          display: flex;
          align-items: center;
          gap: 12px;
        }
      `}</style>

      {/* Browse Panel - Left Side */}
      {/* <div
        class={`browse-panel ${!isBrowsePanelOpen() ? "collapsed" : ""} ${
          isDraggingBrowse() ? "resizing" : ""
        }`}
        style={`width: ${browsePanelWidth()}px;`}
      >
        <Show when={isBrowsePanelOpen()}>
          <button class="panel-close-button" onClick={toggleBrowsePanel}>
            ← Hide Browse
          </button>
        </Show>

        <div
          class={`browse-resize-handle ${isDraggingBrowse() ? "dragging" : ""}`}
          onMouseDown={handleBrowsePanelMouseDown}
          title="Drag to resize panel"
        />
      </div> */}

      <div class="toolbar-container">
        <div class="controls-row">
          {/* <Show when={!isBrowsePanelOpen()}>
            <button class="panel-toggle-button" onClick={toggleBrowsePanel}>
              Show Browse →
            </button>
          </Show> */}

          {/* Controls toggle moved to Actions column */}

          <Show when={selectedItems().size > 1}>
            <div class="bulk-actions">
              <span>
                {selectedItems().size} item
                {selectedItems().size === 1 ? "" : "s"} selected
              </span>
              <button
                class="bulk-action-button"
                onClick={downloadSelectedItems}
              >
                📥 Download
              </button>
              <div style="position: relative;">
                <button
                  class="bulk-action-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    console.log("Bulk action More button clicked");

                    const rect = (
                      e.target as HTMLElement
                    ).getBoundingClientRect();
                    const selectedItemsArray = sortedData().filter((item) =>
                      selectedItems().has(item.id)
                    );

                    console.log(
                      "Selected items for bulk action:",
                      selectedItemsArray.length
                    );

                    if (selectedItemsArray.length > 0) {
                      // Calculate menu dimensions and positioning
                      const menuWidth = 160;
                      const menuHeight = 120;

                      let x = rect.left;
                      let y = rect.top - menuHeight - 8;

                      // Adjust position if menu would go off screen
                      if (x + menuWidth > window.innerWidth) {
                        x = rect.right - menuWidth;
                      }
                      if (y < 0) {
                        y = rect.bottom + 4;
                      }

                      setActiveActionMenu({
                        item: selectedItemsArray[0], // Use first item as context
                        x,
                        y,
                      });

                      addLog(
                        `⋯ Bulk action menu opened for ${selectedItemsArray.length} items`
                      );
                    } else {
                      console.log("No selected items for bulk action");
                    }
                  }}
                >
                  ⋯ More
                </button>
              </div>
              <button
                class="bulk-action-button"
                onClick={clearSelection}
                style="background: #666666; border-color: #666666;"
              >
                ✕
              </button>
            </div>
          </Show>
        </div>
      </div>

      <div
        class={`main-content ${isDragging() ? "resizing" : ""} ${isDraggingBrowse() ? "resizing-browse" : ""}`}
      >
        <GenericInfiniteGrid
          data={sortedData()}
          columns={visibleColumns()}
          onSort={handleSort}
          sortField={sortConfig().field}
          sortDirection={sortConfig().direction}
          rowHeight={getRowHeight()}
          headerHeight={60}
          theme="dark"
          onRowDoubleClick={handleRowDoubleClick}
          onRowMount={(item) => requestThumbnailIfNeeded(item)}
          onRowClick={(item, index, event) =>
            handleRowClick(item, index, event)
          }
          onRowMouseDown={(item, index, event) =>
            handleRowMouseDown(item, index, event)
          }
          onContextMenu={(item, index, event) =>
            handleContextMenu(item, index, event)
          }
          selectedItems={selectedItems()}
          isDragSelecting={isDragSelecting()}
          onScrollNearBottom={() => {
            if (feed.state().hasMore && !feed.state().isLoadingMore) {
              feed.actions.loadMore();
            }
          }}
        />
      </div>

      {/* Filter Panel - Right Side */}
      <div
        class={`filter-panel ${!isFilterPanelOpen() ? "collapsed" : ""} ${
          isDragging() ? "resizing" : ""
        }`}
        style={`width: ${filterPanelWidth()}px;`}
      >
        {/*<Show when={isFilterPanelOpen()}>
          <button class="panel-close-button" onClick={toggleFilterPanel}>
            Hide Controls →
          </button>
        </Show>*/}
        <div class="filter-section">
          <h3>🔍 Name Search</h3>
          <input
            class="filter-input"
            type="text"
            placeholder="Search by filename..."
            value={filterConfig().name}
            onInput={(e) => updateFilter("name", e.currentTarget.value)}
          />
        </div>

        <div class="filter-section">
          <h3>📄 Content Type</h3>
          <select
            class="filter-select"
            value={filterConfig().mime}
            onChange={(e) => updateFilter("mime", e.currentTarget.value)}
          >
            <option value="">All Types</option>
            <For each={mimeCategories()}>
              {(category) => <option value={category}>{category}</option>}
            </For>
          </select>
        </div>

        <div class="filter-section">
          <h3>🏷️ Blob Type</h3>
          <select
            class="filter-select"
            value={filterConfig().blobType}
            onChange={(e) => updateFilter("blobType", e.currentTarget.value)}
          >
            <option value="">All Types</option>
            <For each={blobTypes()}>
              {(type) => <option value={type}>{type}</option>}
            </For>
          </select>
        </div>

        <div class="filter-section">
          <h3>📏 Size Range (bytes)</h3>
          <div class="filter-range">
            <input
              class="filter-input"
              type="number"
              placeholder="Min"
              value={filterConfig().minSize}
              onInput={(e) =>
                updateFilter("minSize", parseInt(e.currentTarget.value) || 0)
              }
            />
            <span>-</span>
            <input
              class="filter-input"
              type="number"
              placeholder="Max"
              value={filterConfig().maxSize}
              onInput={(e) =>
                updateFilter(
                  "maxSize",
                  parseInt(e.currentTarget.value) || 100000000
                )
              }
            />
          </div>
        </div>

        <div class="filter-section">
          <h3>🔗 Has Parent</h3>
          <select
            class="filter-select"
            value={filterConfig().hasParent}
            onChange={(e) => updateFilter("hasParent", e.currentTarget.value)}
          >
            <option value="all">All</option>
            <option value="yes">Has Parent</option>
            <option value="no">No Parent</option>
          </select>
        </div>

        <div class="filter-section">
          <h3>📁 Has Local Path</h3>
          <select
            class="filter-select"
            value={filterConfig().hasLocalPath}
            onChange={(e) =>
              updateFilter("hasLocalPath", e.currentTarget.value)
            }
          >
            <option value="all">All</option>
            <option value="yes">Has Local Path</option>
            <option value="no">No Local Path</option>
          </select>
        </div>

        <div class="filter-section">
          <h3>🎨 View Mode</h3>
          <div class="view-mode-selector">
            <button
              class={`view-mode-button ${viewMode() === "compact" ? "active" : ""}`}
              onClick={() => handleViewModeChange("compact")}
            >
              Compact
            </button>
            <button
              class={`view-mode-button ${viewMode() === "default" ? "active" : ""}`}
              onClick={() => handleViewModeChange("default")}
            >
              Default
            </button>
            <button
              class={`view-mode-button ${viewMode() === "detailed" ? "active" : ""}`}
              onClick={() => handleViewModeChange("detailed")}
            >
              Detailed
            </button>
          </div>
        </div>

        <div class="filter-section">
          <h3>👁️ Column Visibility</h3>
          <button
            class={`toggle-button ${showColumnSettings() ? "active" : ""}`}
            onClick={() => setShowColumnSettings(!showColumnSettings())}
            style="margin-bottom: 8px; width: 100%;"
          >
            {showColumnSettings() ? "Hide" : "Show"} Column Settings
          </button>
          <div
            class={`column-settings ${!showColumnSettings() ? "collapsed" : ""}`}
          >
            <For each={allColumns}>
              {(column) => (
                <div class="column-toggle">
                  <label style="display: flex; align-items: center; cursor: pointer;">
                    <input
                      type="checkbox"
                      checked={
                        columnVisibility()[column.key as keyof ColumnVisibility]
                      }
                      onChange={() =>
                        toggleColumnVisibility(
                          column.key as keyof ColumnVisibility
                        )
                      }
                    />
                    <span>{column.title}</span>
                  </label>
                </div>
              )}
            </For>
          </div>
        </div>

        <div class="filter-section">
          <h3>📊 Data Info</h3>
          <p style="font-size: 12px; color: #888; margin: 0 0 10px 0;">
            Total: {feed.state().items.length} blobs
            <br />
            Filtered: {filteredData().length} results
            <br />
            Sort: {sortConfig().field} ({sortConfig().direction})
            <br />
            Last updated:{" "}
            {feed.state().lastUpdated?.toLocaleTimeString() || "Never"}
          </p>
          <div style="margin-bottom: 8px;">
            Debug:
            <button
              class={`toggle-button ${debug() ? "active" : ""}`}
              onClick={toggleDebug}
              style="margin-left: 8px;"
            >
              {debug() ? "ON" : "OFF"}
            </button>
          </div>
          <button
            class="reset-button"
            onClick={() => {
              if (
                confirm(
                  "Reset all filters, sort settings, and panel width? This will reload the page."
                )
              ) {
                localStorage.removeItem(STORAGE_KEY);
                window.location.reload();
              }
            }}
            title="Reset all filters and settings"
          >
            Reset All
          </button>
        </div>

        <div class="filter-section">
          <h3>🔌 WebSocket Connection</h3>
          <input
            class="filter-input"
            type="text"
            placeholder="WebSocket URL"
            value={wsUrl()}
            onInput={(e) => updateWsUrl(e.currentTarget.value)}
            style="margin-bottom: 8px;"
          />
          <div style="margin-bottom: 8px;">
            Status:{" "}
            <span
              style={getConnectionStatusStyle(feed.state().connectionStatus)}
            >
              {feed.state().connectionStatus}
            </span>
          </div>
          <div style="margin-bottom: 8px;">
            <button
              class="ws-button"
              onClick={() => {
                feed.actions.connect();
                addLog("🔌 Connect clicked");
              }}
              disabled={
                feed.state().connectionStatus === ConnectionStatus.Connected
              }
            >
              Connect
            </button>
            <button
              class="ws-button danger"
              onClick={() => {
                feed.actions.disconnect();
                addLog("🔌 Disconnect clicked");
              }}
              disabled={
                feed.state().connectionStatus === ConnectionStatus.Disconnected
              }
            >
              Disconnect
            </button>
          </div>
          <div style="display: flex; gap: 8px; align-items: center; font-size: 12px;">
            Auto-connect:
            <button
              class={`toggle-button ${autoConnect() ? "active" : ""}`}
              onClick={toggleAutoConnect}
            >
              {autoConnect() ? "ON" : "OFF"}
            </button>
          </div>
        </div>

        <div class="filter-section">
          <h3>🔄 Auto-refresh</h3>
          <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
            <button
              class={`toggle-button ${autoRefresh() ? "active" : ""}`}
              onClick={toggleAutoRefresh}
            >
              {autoRefresh() ? "ON" : "OFF"}
            </button>
            <button
              class="ws-button"
              onClick={() => {
                feed.actions.refresh();
                addLog("🔄 Manual refresh");
              }}
            >
              Refresh
            </button>
          </div>
          <Show when={feed.state().hasPendingUpdates && !autoRefresh()}>
            <div style="margin-bottom: 8px;">
              <button
                class="ws-button"
                onClick={() => {
                  feed.actions.applyPendingUpdates();
                  addLog("📥 Applied pending updates");
                }}
                style="background: #f59e0b; border-color: #f59e0b;"
              >
                Apply {feed.state().pendingUpdates.length} Updates
              </button>
            </div>
          </Show>
        </div>

        <Show when={debug() && logs().length > 0}>
          <div class="filter-section">
            <h3>🐛 Debug Logs</h3>
            <div class="debug-logs">
              <For each={logs()}>{(log) => <div>{log}</div>}</For>
            </div>
          </div>
        </Show>

        <div
          class={`filter-resize-handle ${isDragging() ? "dragging" : ""}`}
          onMouseDown={handlePanelMouseDown}
          title="Drag to resize panel"
        />
      </div>

      {/* Popup Viewer */}
      <Show when={popupViewer()?.show}>
        <div
          class="popup-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              closePopupViewer();
            }
          }}
        >
          <div class="popup-content">
            <button class="popup-close" onClick={closePopupViewer}>
              ×
            </button>

            <Show when={popupViewer()?.item}>
              {(item) => {
                const mimeType = item().mime || "";
                const isImage = mimeType.startsWith("image/");
                const isVideo = mimeType.startsWith("video/");
                const isAudio = mimeType.startsWith("audio/");

                return (
                  <div>
                    <h3 style="margin: 0 0 16px 0; color: #e0e0e0;">
                      {getDisplayFilename(item())}
                    </h3>

                    <Show when={isImage}>
                      <img
                        class="popup-image"
                        src={`/api/blobs/${item().id}`}
                        alt={getDisplayFilename(item())}
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = "none";
                          const fallback = document.createElement("div");
                          fallback.innerHTML = `
                            <div style="padding: 40px; text-align: center; color: #ef4444;">
                              <div style="font-size: 3rem; margin-bottom: 1rem;">❌</div>
                              <div>Failed to load image</div>
                            </div>
                          `;
                          target.parentNode?.appendChild(fallback);
                        }}
                      />
                    </Show>

                    <Show when={isVideo}>
                      <video class="popup-video" controls preload="metadata">
                        <source
                          src={`/api/blobs/${item().id}`}
                          type={mimeType}
                        />
                        Your browser does not support video playback.
                      </video>
                    </Show>

                    <Show when={isAudio}>
                      <audio
                        controls
                        style="width: 100%; margin: 20px 0;"
                        preload="metadata"
                      >
                        <source
                          src={`/api/blobs/${item().id}`}
                          type={mimeType}
                        />
                        Your browser does not support audio playback.
                      </audio>
                    </Show>

                    <Show when={!isImage && !isVideo && !isAudio}>
                      <div style="padding: 40px; text-align: center; color: #b0b0b0;">
                        <div style="font-size: 3rem; margin-bottom: 1rem;">
                          📎
                        </div>
                        <div>File preview not available</div>
                        <div style="margin-top: 16px;">
                          <a
                            href={`/api/blobs/${item().id}`}
                            target="_blank"
                            style="padding: 8px 16px; background: #ff00ff; color: #000000; text-decoration: none; border-radius: 4px;"
                          >
                            Download File
                          </a>
                        </div>
                      </div>
                    </Show>

                    <div class="popup-meta">
                      <div class="popup-meta-row">
                        <span class="popup-meta-label">ID:</span>
                        <span>{item().id}</span>
                      </div>
                      <div class="popup-meta-row">
                        <span class="popup-meta-label">SHA256:</span>
                        <span style="font-family: monospace; font-size: 12px;">
                          {item().sha256}
                        </span>
                      </div>
                      <div class="popup-meta-row">
                        <span class="popup-meta-label">Type:</span>
                        <span>{item().blob_type}</span>
                      </div>
                      <div class="popup-meta-row">
                        <span class="popup-meta-label">MIME:</span>
                        <span>{mimeType || "unknown"}</span>
                      </div>
                      <div class="popup-meta-row">
                        <span class="popup-meta-label">Size:</span>
                        <span>{formatBytes(item().size || 0)}</span>
                      </div>
                      <div class="popup-meta-row">
                        <span class="popup-meta-label">Created:</span>
                        <span>
                          {new Date(item().created_at).toLocaleString()}
                        </span>
                      </div>
                      <Show when={item().parent_blob_id}>
                        <div class="popup-meta-row">
                          <span class="popup-meta-label">Parent:</span>
                          <span style="font-family: monospace; font-size: 12px;">
                            {item().parent_blob_id}
                          </span>
                        </div>
                      </Show>
                      <Show when={item().local_path}>
                        <div class="popup-meta-row">
                          <span class="popup-meta-label">Local Path:</span>
                          <span style="font-family: monospace; font-size: 12px;">
                            {item().local_path}
                          </span>
                        </div>
                      </Show>
                    </div>
                  </div>
                );
              }}
            </Show>
          </div>
        </div>
      </Show>

      {/* Action Menu */}
      <Show when={activeActionMenu()}>
        {(menu) => {
          const isMultiSelect = selectedItems().size > 1;
          const selectedItemsArray = isMultiSelect
            ? sortedData().filter((item) => selectedItems().has(item.id))
            : [menu().item];

          console.log("ACTION MENU RENDERING:", {
            isVisible: true,
            position: { x: menu().x, y: menu().y },
            isMultiSelect,
            selectedCount: selectedItems().size,
            windowDimensions: {
              width: window.innerWidth,
              height: window.innerHeight,
            },
          });

          return (
            <div
              class="action-menu"
              style={`left: ${menu().x}px; top: ${menu().y}px;`}
            >
              <Show when={!isMultiSelect}>
                <button
                  class="action-menu-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setPopupViewer({ item: menu().item, show: true });
                    closeAllActionMenus();
                    addLog(
                      `👁️ Preview opened for: ${getDisplayFilename(menu().item)}`
                    );
                  }}
                >
                  <span>👁️</span>
                  <span>Preview</span>
                </button>
              </Show>

              <Show when={isMultiSelect}>
                <div style="padding: 8px 12px; font-size: 11px; color: #888; border-bottom: 1px solid #444;">
                  {selectedItemsArray.length} items selected
                </div>
              </Show>

              <button
                class="action-menu-item"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (isMultiSelect) {
                    downloadSelectedItems();
                  } else {
                    downloadBlob(menu().item);
                  }
                  closeAllActionMenus();
                }}
              >
                <span>📥</span>
                <span>
                  Download{" "}
                  {isMultiSelect ? `(${selectedItemsArray.length})` : ""}
                </span>
              </button>

              <button
                class="action-menu-item"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  addToPlaylist(selectedItemsArray);
                  closeAllActionMenus();
                }}
              >
                <span>🎵</span>
                <span>
                  Add to Playlist{" "}
                  {isMultiSelect ? `(${selectedItemsArray.length})` : ""}
                </span>
              </button>

              <button
                class="action-menu-item"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  deleteItems(selectedItemsArray);
                  closeAllActionMenus();
                }}
                style="color: #ef4444;"
              >
                <span>🗑️</span>
                <span>
                  Delete {isMultiSelect ? `(${selectedItemsArray.length})` : ""}
                </span>
              </button>
            </div>
          );
        }}
      </Show>

      {/* Drag Selection Box */}
      <Show when={isDragSelecting() && dragStart() && dragEnd()}>
        <div
          class="drag-selection-box"
          style={(() => {
            const start = dragStart()!;
            const end = dragEnd()!;
            const left = Math.min(start.x, end.x);
            const top = Math.min(start.y, end.y);
            const width = Math.abs(end.x - start.x);
            const height = Math.abs(end.y - start.y);
            return `left: ${left}px; top: ${top}px; width: ${width}px; height: ${height}px;`;
          })()}
        />
      </Show>
    </div>
  );
}

// Custom element wrapper
class InfiniteDataGridElement extends HTMLElement {
  private dispose?: () => void;

  connectedCallback() {
    console.log("🔌 InfiniteDataGridElement connected");
    try {
      this.dispose = render(() => <MediaBlobDataGrid />, this);
      console.log("✅ MediaBlob Data Grid render successful");
    } catch (error) {
      console.error("❌ MediaBlob Data Grid render failed:", error);
    }
  }

  disconnectedCallback() {
    console.log("🔌 InfiniteDataGridElement disconnected");
    if (this.dispose) {
      this.dispose();
    }
  }
}

console.log("📝 About to register infinite-data-grid custom element");

try {
  customElements.define("infinite-data-grid", InfiniteDataGridElement);
  console.log("✅ MediaBlob Data Grid custom element registered successfully");
} catch (error) {
  console.error(
    "❌ Failed to register infinite-data-grid custom element:",
    error
  );
}

export { MediaBlobDataGrid, InfiniteDataGridElement };
