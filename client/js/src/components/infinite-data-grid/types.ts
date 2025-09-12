// Generic types for the infinite data grid component
import type { JSX } from "solid-js";

export interface GridColumn<T = any> {
  key: string;
  title: string | JSX.Element;
  width?: number | string; // support both px and %
  minWidth?: number;
  maxWidth?: number;
  sortable?: boolean;
  resizable?: boolean;
  editable?: boolean; // double-click to edit
  render?: (item: T, index: number) => JSX.Element;
  renderHeader?: () => JSX.Element;
  renderEditCell?: (
    item: T,
    value: any,
    onSave: (newValue: any) => void,
    onCancel: () => void
  ) => JSX.Element;
  className?: string;
  headerClassName?: string;
  cellClassName?: string;
}

export type SortDirection = "asc" | "desc";

export interface SortConfig {
  field: string;
  direction: SortDirection;
}

export interface VirtualizationOptions {
  enabled?: boolean;
  threshold?: number;
  bufferSize?: number;
  rowHeight?: number;
  headerHeight?: number;
}

export interface GridLayoutOptions {
  stickyHeader?: boolean;
  showRowNumbers?: boolean;
  showStatusBar?: boolean;
  allowColumnResize?: boolean;
  allowRowSelection?: boolean;
}

export interface InfiniteGridProps<T = any> {
  data: T[];
  columns: GridColumn<T>[];

  // Layout
  className?: string;
  virtualization?: VirtualizationOptions;
  layout?: GridLayoutOptions;

  // Events
  onSort?: (field: string, direction: SortDirection | null) => void;
  onRowClick?: (item: T, index: number, event: MouseEvent) => void;
  onRowDoubleClick?: (item: T, index: number) => void;
  onContextMenu?: (
    item: T,
    index: number,
    event: MouseEvent,
    cellContext?: {
      column: GridColumn<T>;
      value: any;
      canEdit: boolean;
      cellActions?: string[];
    }
  ) => void;
  onSelectionChange?: (
    selectedIds: Set<string>,
    lastSelectedId?: string
  ) => void;
  onLoadMore?: () => void;
  onScrollNearBottom?: () => void;

  // Refs
  scrollElementRef?: (element: HTMLElement | null) => void;

  // State
  sortField?: string;
  sortDirection?: SortDirection | null;
  selectedRowIds?: Set<string>;
  loading?: boolean;
  hasMore?: boolean;
  serverTotal?: number;
  initialScrollTop?: number; // For scroll restoration

  // Song-focused rendering (specific to music domain)
  songRowRenderer?: "default" | "compact" | "detailed" | "album-header";
  enableCellEditing?: boolean;
  onCellEdit?: (item: T, field: string, newValue: any) => Promise<void>;

  // Generic fallback for non-song data
  renderRow?: (
    item: T,
    index: number,
    defaultRender: () => JSX.Element
  ) => JSX.Element;

  // Accessibility
  getRowId?: (item: T) => string;
  getRowLabel?: (item: T) => string;
}

export interface VirtualizedRowProps<T = any> {
  item: T;
  index: number;
  columns: GridColumn<T>[];
  rowHeight: number;
  isSelected: boolean;
  isFocused?: boolean;
  onClick?: (item: T, index: number, event: MouseEvent) => void;
  onDoubleClick?: (item: T, index: number) => void;
  onContextMenu?: (
    item: T,
    index: number,
    event: MouseEvent,
    cellContext?: {
      column: GridColumn<T>;
      value: any;
      canEdit: boolean;
      cellActions?: string[];
    }
  ) => void;
  editingCell?: { rowIndex: number; columnKey: string } | null;
  onCellEdit?: (item: T, field: string, newValue: any) => Promise<void>;
  onEditStart?: (rowIndex: number, columnKey: string) => void;
  onEditCancel?: () => void;
  renderCell?: (item: T, column: GridColumn<T>, value: any) => JSX.Element;
  class?: string;
}

// Enhanced dark theme with tailwind classes
export const DARK_THEME = {
  background: "bg-black",
  text: "text-white",
  textSecondary: "text-gray-400",
  textMuted: "text-gray-600",
  accent: "text-magenta-500",
  accentBg: "bg-magenta-500",
  transparent90: "bg-black bg-opacity-90",
  transparent70: "bg-black bg-opacity-70",
  hover: "hover:bg-black hover:bg-opacity-70",
  selected: "bg-magenta-500 bg-opacity-30",
  selectedBorder: "shadow-[inset_0_0_0_2px_rgb(217,70,239)]",
  focus: "shadow-[inset_0_0_0_1px_white]",
} as const;
