// MediaBlob-specific types for freqhole demo
// Note: Using WebSocket MediaBlob type from lib/websocket-types.ts for data compatibility

import type { MediaBlob } from "../../lib/websocket-types";
export type { MediaBlob };

export type SortField =
  | "id"
  | "mime"
  | "blob_type"
  | "size"
  | "created_at"
  | "updated_at";
export type SortDirection = "asc" | "desc";

export interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

export interface FilterConfig {
  name: string;
  mime: string;
  blobType: string;
  minSize: number;
  maxSize: number;
  hasParent: string;
  hasLocalPath: string;
}

export type GridViewMode = "compact" | "default" | "detailed";

export interface ColumnVisibility {
  id: boolean;
  thumbnail: boolean;
  name: boolean;
  mime: boolean;
  blob_type: boolean;
  size: boolean;
  parent_blob_id: boolean;
  local_path: boolean;
  created_at: boolean;
  updated_at: boolean;
  actions: boolean;
}

export interface GridState {
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
  viewMode: GridViewMode;
  columnVisibility: ColumnVisibility;
  selectedItems: Set<string>;
}

export interface PopupViewerState {
  show: boolean;
  item: MediaBlob | null;
}

export interface ThumbnailCache {
  [key: string]: string;
}

export interface ActionMenuState {
  [key: string]: boolean;
}

export interface BulkActionMenuState {
  show: boolean;
  x: number;
  y: number;
}

export interface DragSelection {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export interface ResizeHandleProps {
  isDragging: boolean;
  onMouseDown: (e: MouseEvent) => void;
  position: "left" | "right";
  className?: string;
  panelName?: string;
}

export interface PanelProps {
  isOpen: boolean;
  width: number;
  onToggle: () => void;
  isDragging?: boolean;
  onResize?: (e: MouseEvent) => void;
  className?: string;
}
