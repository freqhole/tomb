import { createMemo } from "solid-js";
import type { GridColumn } from "../../../components/infinite-data-grid/types";
import type { MediaBlob } from "../../../lib/websocket-types";
import type { ColumnVisibility } from "../types";
import { Thumbnail } from "../components/Thumbnail";
import { getDisplayFilename } from "../../../lib/media-utils";
import { formatBytes } from "../../../lib/format-utils";

export const COLUMNS = [
  { key: "id", title: "ID" },
  { key: "thumbnail", title: "📷 Thumbnail" },
  { key: "name", title: "📄 Name" },
  { key: "mime", title: "🎭 MIME Type" },
  { key: "blob_type", title: "🏷️ Type" },
  { key: "size", title: "📏 Size" },
  { key: "parent_blob_id", title: "🌳 Parent" },
  { key: "local_path", title: "📁 Path" },
  { key: "created_at", title: "📅 Created" },
  { key: "updated_at", title: "🔄 Updated" },
  { key: "actions", title: "⚙️ Actions" },
];

export interface UseGridColumnsProps {
  columnVisibility: () => ColumnVisibility;
  responsiveColumnVisibility: () => ColumnVisibility;
  apiBaseUrl: string;
  requestThumbnails: (itemId: string) => void;
  requestedThumbnails: () => Set<string>;
  onActionMenuClick: (item: MediaBlob, event: MouseEvent) => void;
  onHeaderActionMenu: (event: MouseEvent) => void;
  headerActionMenuOpen: boolean;
  viewMode: () => string;
  hiddenColumnsCount: number;
}

export function useGridColumns(props: UseGridColumnsProps) {
  const visibleColumns = createMemo((): GridColumn<MediaBlob>[] => {
    const vis = props.responsiveColumnVisibility();
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
            onRequestThumbnails={props.requestThumbnails}
            requestedThumbnails={props.requestedThumbnails()}
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
        title: (
          <button
            onClick={props.onHeaderActionMenu}
            title="Controls"
            style={`
              background: ${props.headerActionMenuOpen ? "#ff00ff" : "#333"};
              border: 1px solid ${props.headerActionMenuOpen ? "#ff00ff" : "#555"};
              color: ${props.headerActionMenuOpen ? "#000" : "#fff"};
              padding: 4px 8px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.15s ease;
              position: relative;
            `}
          >
            ⋯
            {props.hiddenColumnsCount > 0 && (
              <span
                style="
                  position: absolute;
                  top: -2px;
                  right: -2px;
                  background: #ff9900;
                  color: #000;
                  font-size: 8px;
                  font-weight: bold;
                  padding: 1px 3px;
                  border-radius: 50%;
                  line-height: 1;
                  min-width: 12px;
                  text-align: center;
                "
                title={`${props.hiddenColumnsCount} columns hidden on mobile screens`}
              >
                {props.hiddenColumnsCount}
              </span>
            )}
          </button>
        ),
        sortable: false,
        width: 100,
        className: "sticky-actions-column",
        render: (item) => (
          <button
            style={`
              background: #3a3a3a;
              border: 1px solid #4a4a4a;
              color: #e0e0e0;
              padding: ${props.viewMode() === "compact" ? "2px 6px" : "4px 8px"};
              border-radius: 4px;
              cursor: pointer;
              font-size: ${props.viewMode() === "compact" ? "10px" : "12px"};
              transition: all 0.2s;
            `}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.background = "#4a4a4a";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.background = "#3a3a3a";
            }}
            onClick={(e) => props.onActionMenuClick(item as MediaBlob, e)}
          >
            ⋯
          </button>
        ),
      });
    }

    return columns;
  });

  return {
    visibleColumns,
  };
}

export default useGridColumns;
