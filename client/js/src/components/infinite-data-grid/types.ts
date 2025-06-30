// Generic types for the infinite data grid component
import type { JSX } from "solid-js";

export interface GridColumn<T = any> {
  key: string;
  title: string | JSX.Element;
  width?: number;
  sortable?: boolean;
  render?: (item: T, index: number) => any;
  className?: string;
}

export type SortDirection = "asc" | "desc";

export interface SortConfig {
  field: string;
  direction: SortDirection;
}

export interface GridTheme {
  name: string;
  colors: {
    background: string;
    text: string;
    border: string;
    header: string;
    hover: string;
    selected: string;
  };
}

export interface GridState {
  sortConfig: SortConfig;
  selectedItems: Set<string>;
  isDragSelecting: boolean;
}

export interface GridProps<T = any> {
  data: T[];
  columns: GridColumn<T>[];
  rowHeight?: number;
  headerHeight?: number;
  virtualizeThreshold?: number;
  onSort?: (field: string, direction: SortDirection) => void;
  onRowClick?: (item: T, index: number, event: MouseEvent) => void;
  onRowDoubleClick?: (item: T, index: number, event: MouseEvent) => void;
  onRowMouseDown?: (item: T, index: number, event: MouseEvent) => void;
  onRowMount?: (item: T) => void;
  onContextMenu?: (item: T, index: number, event: MouseEvent) => void;
  onDragSelection?: (selectedIds: Set<string>) => void;
  sortField?: string;
  sortDirection?: SortDirection;
  defaultSort?: { field: string; direction: SortDirection };
  selectedItems?: Set<string>;
  isDragSelecting?: boolean;
  getItemId?: (item: T) => string;
  className?: string;
  showPaginationStatus?: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  focusedIndex?: number;
  showFocusIndicator?: boolean;
}

export interface VirtualizedRowProps<T = any> {
  item: T;
  index: number;
  style: string;
  columns: GridColumn<T>[];
  isSelected: boolean;
  onRowClick?: (item: T, index: number, event: MouseEvent) => void;
  onRowDoubleClick?: (item: T, index: number, event: MouseEvent) => void;
  onRowMouseDown?: (item: T, index: number, event: MouseEvent) => void;
  onRowMount?: (item: T) => void;
  onContextMenu?: (item: T, index: number, event: MouseEvent) => void;
  rowHeight: number;
  focusedIndex?: number;
  showFocusIndicator?: boolean;
}

const DARK_THEME: GridTheme = {
  name: "dark",
  colors: {
    background: "#000000",
    text: "#ffffff",
    border: "#3a3a3a",
    header: "#1a1a1a",
    hover: "#2a2a2a",
    selected: "#ff00ff",
  },
};

export { DARK_THEME };
