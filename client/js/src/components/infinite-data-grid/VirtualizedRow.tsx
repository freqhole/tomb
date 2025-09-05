import { createSignal, For, JSX } from "solid-js";
import type { GridColumn } from "./types";
import { getCellClasses } from "./styles/grid-styles";

export interface VirtualizedRowProps<T> {
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

export function VirtualizedRow<T>(props: VirtualizedRowProps<T>) {
  // handle context menu with cell context
  const handleContextMenu = (event: MouseEvent, column?: GridColumn<T>) => {
    if (!props.onContextMenu) return;

    let cellContext;
    if (column) {
      const value = (props.item as any)[column.key];
      cellContext = {
        column,
        value,
        canEdit: column.editable || false,
        cellActions: getCellActions(column.key, value),
      };
    }

    props.onContextMenu(props.item, props.index, event, cellContext);
  };

  // get cell-specific actions based on column type
  const getCellActions = (columnKey: string, value: any): string[] => {
    const actions: string[] = [];

    switch (columnKey) {
      case "thumbnail":
        actions.push("view artwork", "upload artwork");
        break;
      case "title":
        actions.push("edit title", "search lyrics");
        break;
      case "artist":
        actions.push("edit artist", "view artist page");
        break;
      case "rating":
        actions.push("rate 1", "rate 2", "rate 3", "rate 4", "rate 5");
        break;
      case "is_favorite":
        actions.push(value ? "remove favorite" : "add favorite");
        break;
      default:
        if (columnKey.endsWith("_at") || columnKey.includes("date")) {
          actions.push("copy timestamp");
        }
        if (typeof value === "number") {
          actions.push("copy value");
        }
        if (typeof value === "string" && value.length > 0) {
          actions.push("copy text");
        }
        break;
    }

    return actions;
  };

  // render individual cell with edit support
  const renderCell = (column: GridColumn<T>) => {
    const value = (props.item as any)[column.key];
    const isEditing =
      props.editingCell?.rowIndex === props.index &&
      props.editingCell?.columnKey === column.key;

    if (isEditing && column.editable) {
      return (
        <EditableCell
          value={value}
          onSave={(newValue) =>
            props.onCellEdit?.(props.item, column.key, newValue)
          }
          onCancel={props.onEditCancel}
          column={column}
        />
      );
    }

    // use custom cell renderer if provided
    if (props.renderCell) {
      return props.renderCell(props.item, column, value);
    }

    // use column's custom renderer
    if (column.render) {
      return column.render(props.item, props.index);
    }

    // default text rendering with cell-specific context menu
    return (
      <div
        class={getCellClasses(column)}
        onContextMenu={(e) => handleContextMenu(e, column)}
        onDblClick={() => {
          if (column.editable) {
            props.onEditStart?.(props.index, column.key);
          }
        }}
        onClick={(e) => e.stopPropagation()} // prevent row click when clicking cell
      >
        {formatCellValue(column.key, value)}
      </div>
    );
  };

  return (
    <div
      class={props.class || ""}
      style={{
        height: `${props.rowHeight}px`,
        transform: `translateY(${props.index * props.rowHeight}px)`,
      }}
      onClick={(e) => props.onClick?.(props.item, props.index, e)}
      onDblClick={() => props.onDoubleClick?.(props.item, props.index)}
      onContextMenu={(e) => handleContextMenu(e)}
      tabIndex={0}
      role="row"
      aria-selected={props.isSelected}
      aria-rowindex={props.index + 1}
    >
      <For each={props.columns}>
        {(column) => (
          <div
            class="flex-shrink-0"
            style={{
              width:
                typeof column.width === "number"
                  ? `${column.width}px`
                  : column.width || "auto",
              "min-width": column.minWidth ? `${column.minWidth}px` : undefined,
              "max-width": column.maxWidth ? `${column.maxWidth}px` : undefined,
            }}
            role="gridcell"
          >
            {renderCell(column)}
          </div>
        )}
      </For>
    </div>
  );
}

// Editable cell component for inline editing
interface EditableCellProps {
  value: any;
  onSave: (newValue: any) => void;
  onCancel?: () => void;
  column: GridColumn<any>;
}

function EditableCell(props: EditableCellProps) {
  const [localValue, setLocalValue] = createSignal(
    props.value?.toString() || ""
  );

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      props.onSave(localValue());
    } else if (e.key === "Escape") {
      e.preventDefault();
      props.onCancel?.();
    }
  };

  const handleBlur = () => {
    props.onCancel?.();
  };

  // use custom edit renderer if provided
  if (props.column.renderEditCell) {
    return props.column.renderEditCell(
      props.value,
      props.value,
      props.onSave,
      props.onCancel || (() => {})
    );
  }

  // default input for text editing
  return (
    <input
      class="bg-black text-white px-2 py-1 text-sm border border-magenta-500 outline-none w-full"
      value={localValue()}
      onInput={(e) => setLocalValue(e.currentTarget.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      autofocus
    />
  );
}

// utility for formatting cell values
function formatCellValue(key: string, value: any): string {
  if (value == null) return "";

  switch (key) {
    case "duration_seconds":
      return formatDuration(value);
    case "created_at":
    case "updated_at":
    case "modified_at":
      return formatDate(value);
    case "file_size":
    case "size":
      return formatFileSize(value);
    case "rating":
      return "★".repeat(Math.max(0, Math.min(5, value || 0)));
    case "is_favorite":
      return value ? "♥" : "";
    case "is_explicit":
      return value ? "E" : "";
    default:
      return value.toString();
  }
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return "0:00";

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDate(dateString: string): string {
  if (!dateString) return "";

  try {
    const date = new Date(dateString);
    return date.toLocaleDateString();
  } catch {
    return dateString;
  }
}

function formatFileSize(bytes: number | string): string {
  if (typeof bytes === "string") return bytes;
  if (!bytes || bytes < 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}
