import { createMemo, createEffect } from "solid-js";
import { InfiniteGrid } from "../../../components/infinite-data-grid";
import type { GridColumn } from "../../../components/infinite-data-grid/types";
import type { MediaBlob } from "../../../lib/websocket-types";
import { useFreqholeAppContext } from "../context/FreqholeStateContext";
import { useWebSocketFeed } from "../../../hooks/useWebSocketFeed";
import { useFreqholeData } from "../hooks/useFreqholeData";
import { useViewModes } from "../hooks/useViewModes";
import { useResponsiveColumns } from "../hooks/useResponsiveColumns";

import { Thumbnail } from "./Thumbnail";
import { getDisplayFilename } from "../../../lib/media-utils";
import { formatBytes } from "../../../lib/format-utils";
import { formatDateWithTooltip } from "../../../lib/date-utils";
import type { NotificationChannel } from "../../../lib/websocket-types";
import { createSignal } from "solid-js";

interface FreqholeDataGridProps {
  apiBaseUrl: string;
}

export function FreqholeDataGrid(props: FreqholeDataGridProps) {
  const { state, selection, addLog } = useFreqholeAppContext();

  // Set up all the hooks that the grid needs
  const initialState = state.loadState();
  const viewModes = useViewModes((initialState.viewMode as any) || "default");

  const responsiveColumns = useResponsiveColumns({
    baseColumnVisibility: () => state.columnVisibility(),
  });

  const feed = useWebSocketFeed({
    wsUrl: state.wsUrl(),
    channels: ["MediaBlobs"] as NotificationChannel[],
    debug: state.debug(),
    autoConnect: state.autoConnect(),
    autoRefresh: state.autoRefresh() ?? true,
    pageSize: 50,
  });

  const data = useFreqholeData({
    items: () => feed.state().items,
    filterConfig: state.filterConfig,
    sortConfig: state.sortConfig,
  });

  // Cancel drag selection when any modal/overlay opens
  createEffect(() => {
    const popup = state.popupPreview();
    const actionMenu = state.actionMenu();
    const bulkActionMenu = state.bulkActionMenu();
    const headerActionMenu = state.headerActionMenu();
    const confirmDialog = state.confirmDialog();

    // Check if any modal/overlay is open
    const hasModalOpen =
      popup?.isOpen ||
      actionMenu?.isOpen ||
      bulkActionMenu?.isOpen ||
      headerActionMenu?.isOpen ||
      confirmDialog?.isOpen;

    if (
      hasModalOpen &&
      (selection.isDragSelecting() || selection.dragStart())
    ) {
      // Cancel drag selection when any modal opens
      selection.setIsDragSelecting(false);
      selection.setDragStart(null);
      selection.setDragEnd(null);
      addLog("🚫 Cancelled drag selection due to modal/overlay");
    }
  });

  // TODO: Implement keyboard navigation functionality
  // const _keyboardNav = useKeyboardNavigation({
  //   onPreview: (item) => state.setPopupPreview({ item, isOpen: true }),
  //   onToggleSelection: (item) => selection.toggleSelection(item.id),
  //   onSelectAll: (items) => selection.selectAll(items),
  //   onClearSelection: () => selection.clearSelection(),
  //   onEscape: () => {
  //     if (state.popupPreview()?.isOpen) {
  //       state.setPopupPreview(null);
  //     } else if (state.actionMenu()?.isOpen) {
  //       state.setActionMenu(null);
  //     } else {
  //       selection.clearSelection();
  //     }
  //   },
  // });
  //   onDelete: (items) => {
  //     state.setConfirmDialog({
  //       isOpen: true,
  //       title: "Delete Files",
  //       message: `Delete ${items.length} selected file${items.length !== 1 ? "s" : ""}?`,
  //       items: items,
  //       onConfirm: () => {
  //         addLog(`🗑️ Deleted ${items.length} items via keyboard`);
  //         selection.clearSelection();
  //         state.setConfirmDialog(null);
  //       },
  //     });
  //   },
  //   isTextInputFocused: () => {
  //     const target = document.activeElement as HTMLElement;
  //     return (
  //       target &&
  //       (target.tagName === "INPUT" ||
  //         target.tagName === "TEXTAREA" ||
  //         target.isContentEditable ||
  //         target.getAttribute("contenteditable") === "true")
  //     );
  //   },
  //   getSelectedItems: () => selection.selectedItems(),
  //   getAllItems: () => data.sortedData(),
  //   onLog: addLog,
  // });

  // Track thumbnail requests to avoid duplicates
  const [thumbnailRequests, setThumbnailRequests] = createSignal<Set<string>>(
    new Set()
  );

  // Helper function to request thumbnails
  const requestThumbnails = (itemId: string) => {
    if (!thumbnailRequests().has(itemId)) {
      setThumbnailRequests((prev) => new Set([...prev, itemId]));
      feed.actions.getThumbnails(itemId);
      addLog(`🖼️ Requesting thumbnails for ${itemId.slice(0, 8)}`);
    }
  };

  // Event handlers for the grid
  const handleRowClick = (
    item: MediaBlob,
    index: number,
    event: MouseEvent
  ) => {
    if (event.shiftKey && selection.lastSelectedIndex() >= 0) {
      event.preventDefault();
      selection.selectRange(
        selection.lastSelectedIndex(),
        index,
        data.sortedData()
      );
    } else {
      selection.handleRowClick(item, index, event);
    }
  };

  const handleRowDoubleClick = (item: MediaBlob) => {
    state.setPopupPreview({ item, isOpen: true });
    addLog(`🖼️ Opened preview for: ${getDisplayFilename(item)}`);
  };

  const handleRowContextMenu = (
    item: MediaBlob,
    _index: number,
    event: MouseEvent
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const position = {
      x: event.clientX,
      y: event.clientY,
    };

    const selectedCount = selection.selectedItems().size;

    if (selectedCount > 1) {
      state.setBulkActionMenu({
        isOpen: true,
        position,
      });
      addLog(`🖱️ Bulk context menu opened for ${selectedCount} items`);
    } else {
      state.setActionMenu({
        item,
        isOpen: true,
        position,
      });
      addLog(`🖱️ Context menu opened for: ${getDisplayFilename(item)}`);
    }
  };

  const handleSort = (field: string, direction: "asc" | "desc" | null) => {
    if (direction) {
      state.handleSort(field, direction);
    }
  };

  // Define columns for the grid
  const visibleColumns = createMemo((): GridColumn<MediaBlob>[] => {
    const vis = responsiveColumns.responsiveColumnVisibility();
    const columns: GridColumn<MediaBlob>[] = [];

    // Thumbnail column (first)
    if (vis.thumbnail) {
      columns.push({
        key: "thumbnail",
        title: "",
        width: 60,
        render: (item) => (
          <Thumbnail
            item={item}
            size={40}
            apiBaseUrl={props.apiBaseUrl}
            onRequestThumbnails={requestThumbnails}
            requestedThumbnails={thumbnailRequests()}
            showIndicators={true}
          />
        ),
      });
    }

    // Name column (second) - flexible width to fill remaining space
    if (vis.name) {
      columns.push({
        key: "name",
        title: "Name",
        // No width specified = flex: 1 (expands to fill remaining space)
        sortable: true,
        render: (item) => (
          <span style="font-weight: 500;" title={getDisplayFilename(item)}>
            {getDisplayFilename(item)}
          </span>
        ),
      });
    }

    // Type column (third)
    if (vis.blob_type) {
      columns.push({
        key: "blob_type",
        title: "Type",
        width: 100,
        sortable: true,
      });
    }

    // MIME Type column (fourth)
    if (vis.mime) {
      columns.push({
        key: "mime",
        title: "MIME Type",
        width: 150,
        sortable: true,
        render: (item) => <span>{item.mime || "unknown"}</span>,
      });
    }

    // ID column (hidden by default, but available)
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

    if (vis.size) {
      columns.push({
        key: "size",
        title: "Size",
        width: 100,
        sortable: true,
        render: (item) => <span>{formatBytes(item.size || 0)}</span>,
      });
    }

    if (vis.parent_blob_id) {
      columns.push({
        key: "parent_blob_id",
        title: "Parent",
        width: 120,
        render: (item) => <span>{item.parent_blob_id ? "Yes" : "No"}</span>,
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
        render: (item) => {
          const dateFormat = formatDateWithTooltip(item.created_at);
          return <span title={dateFormat.full}>{dateFormat.relative}</span>;
        },
      });
    }

    if (vis.updated_at) {
      columns.push({
        key: "updated_at",
        title: "Updated",
        width: 140,
        sortable: true,
        render: (item) => {
          if (!item.updated_at) {
            return <span>—</span>;
          }
          const dateFormat = formatDateWithTooltip(item.updated_at);
          return <span title={dateFormat.full}>{dateFormat.relative}</span>;
        },
      });
    }

    // Actions column (last) - always visible when enabled
    if (vis.actions) {
      columns.push({
        key: "actions",
        title: (
          <button
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              state.setHeaderActionMenu({
                isOpen: !state.headerActionMenu()?.isOpen,
                position: {
                  x: rect.left + rect.width / 2,
                  y: rect.bottom + 5,
                },
              });
            }}
            title="Controls"
            style={`
              background: ${state.headerActionMenu()?.isOpen ? "#ff00ff" : "#333"};
              border: 1px solid ${state.headerActionMenu()?.isOpen ? "#ff00ff" : "#555"};
              color: ${state.headerActionMenu()?.isOpen ? "#000" : "#fff"};
              padding: 4px 8px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.15s ease;
              position: relative;
            `}
          >
            ⋯
          </button>
        ),
        width: 60,
        render: (item) => (
          <button
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();

              const currentMenu = state.actionMenu();
              if (currentMenu && currentMenu.item.id === item.id) {
                state.setActionMenu(null);
                addLog(`⋯ Action menu closed for: ${getDisplayFilename(item)}`);
              } else {
                const rect = (e.target as HTMLElement).getBoundingClientRect();
                const position = {
                  x: rect.right - 120,
                  y: rect.bottom + 4,
                };

                state.setActionMenu({
                  item,
                  isOpen: true,
                  position,
                });
                addLog(`⋯ Action menu opened for: ${getDisplayFilename(item)}`);
              }
            }}
            style={`
              background: transparent;
              border: 1px solid #666;
              color: #888;
              padding: 4px 8px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `}
            title="More actions"
          >
            ⋯
          </button>
        ),
      });
    }

    return columns;
  });

  return (
    <InfiniteGrid
      data={data.sortedData() as any}
      columns={visibleColumns()}
      onSort={handleSort}
      sortField={state.sortConfig().field}
      sortDirection={state.sortConfig().direction as "asc" | "desc"}
      virtualization={{
        enabled: true,
        rowHeight: viewModes.getRowHeight(),
        headerHeight: 60,
      }}
      getRowId={(item: any) => item.id}
      selectedRowIds={selection.selectedItems()}
      onRowClick={handleRowClick}
      onRowDoubleClick={handleRowDoubleClick}
      onContextMenu={(item, index, event) =>
        handleRowContextMenu(item as MediaBlob, index, event)
      }
      onSelectionChange={(selectedIds: Set<string>) => {
        selection.setSelectedItems(selectedIds);
        addLog(`📦 Selected ${selectedIds.size} items via drag`);
      }}
      onLoadMore={() => feed.actions.loadMore()}
      hasMore={feed.state().hasMore}
      loading={feed.state().isLoadingMore}
    />
  );
}

export default FreqholeDataGrid;
