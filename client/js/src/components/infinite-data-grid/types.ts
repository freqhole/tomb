// Generic types for the infinite data grid component

export interface GridColumn<T = any> {
  key: string;
  title: string;
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
  theme?: string | GridTheme;
  virtualizeThreshold?: number;
  onSort?: (field: string, direction: SortDirection) => void;
  onRowClick?: (item: T, index: number, event: MouseEvent) => void;
  onRowDoubleClick?: (item: T, index: number, event: MouseEvent) => void;
  onRowMouseDown?: (item: T, index: number, event: MouseEvent) => void;
  onRowMount?: (item: T) => void;
  onContextMenu?: (item: T, index: number, event: MouseEvent) => void;
  sortField?: string;
  sortDirection?: SortDirection;
  selectedItems?: Set<string>;
  isDragSelecting?: boolean;
  getItemId?: (item: T) => string;
  className?: string;
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
}

const DEFAULT_DARK_THEME: GridTheme = {
  name: "dark",
  colors: {
    background: "#1a1a1a",
    text: "#e0e0e0",
    border: "#3a3a3a",
    header: "#2a2a2a",
    hover: "#2a2a2a",
    selected: "#0070f3",
  },
};

const THEMES: Record<string, GridTheme> = {
  dark: DEFAULT_DARK_THEME,
  light: {
    name: "light",
    colors: {
      background: "#ffffff",
      text: "#333333",
      border: "#e0e0e0",
      header: "#f5f5f5",
      hover: "#f5f5f5",
      selected: "#0070f3",
    },
  },
};

export { THEMES, DEFAULT_DARK_THEME };
