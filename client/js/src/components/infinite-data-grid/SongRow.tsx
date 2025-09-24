import { createMemo, For } from "solid-js";
import type { GridColumn } from "./types";

export interface SongRowProps {
  song: any; // AdminSong type
  index: number;
  columns: GridColumn<any>[];
  variant: "default" | "compact" | "detailed" | "album-header";
  isSelected: boolean;
  isFocused: boolean;
  editingCell?: string;
  onCellEdit?: (field: string, value: any) => void;
  onEditStart?: (field: string) => void;
  onEditCancel?: () => void;
  onClick?: (event: MouseEvent) => void;
  onDoubleClick?: () => void;
  onContextMenu?: (event: MouseEvent) => void;
}

export function SongRow(props: SongRowProps) {
  // variant-specific column filtering
  const visibleColumns = createMemo(() => {
    switch (props.variant) {
      case "compact":
        return props.columns.filter((col) =>
          ["thumbnail", "title", "artist", "duration"].includes(col.key)
        );
      case "detailed":
        return props.columns; // show all columns
      case "album-header":
        return [{ key: "album", title: "album", render: renderAlbumHeader }];
      default:
        return props.columns.filter(
          (col) => !["bpm", "key_signature", "file_format"].includes(col.key)
        );
    }
  });

  // render album header row for grouped display
  const renderAlbumHeader = () => {
    return (
      <div class="flex items-center px-3 py-4 bg-gray-800 bg-opacity-50">
        <div class="w-16 h-16 bg-gray-700 mr-4 flex-shrink-0">
          {props.song.thumbnail_blob_id && (
            <img
              src={`/api/blobs/${props.song.thumbnail_blob_id}`}
              alt="album artwork"
              class="w-full h-full object-cover"
            />
          )}
        </div>
        <div>
          <div class="text-lg font-medium text-white">
            {props.song.album || "unknown album"}
          </div>
          <div class="text-sm text-gray-400">
            {props.song.artist || "unknown artist"}
          </div>
          {props.song.year && (
            <div class="text-xs text-gray-500">{props.song.year}</div>
          )}
        </div>
      </div>
    );
  };

  // render individual cell with edit support
  const renderCell = (column: GridColumn<any>) => {
    const value = (props.song as any)[column.key];
    const isEditing = props.editingCell === column.key;

    if (isEditing && column.editable) {
      return (
        column.renderEditCell?.(
          props.song,
          value,
          (newValue) => props.onCellEdit?.(column.key, newValue),
          () => props.onEditCancel?.()
        ) || (
          <input
            class="bg-black text-white px-2 py-1 text-sm border border-magenta-500"
            value={value || ""}
            onBlur={() => props.onEditCancel?.()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                props.onCellEdit?.(column.key, e.currentTarget.value);
              } else if (e.key === "Escape") {
                props.onEditCancel?.();
              }
            }}
            autofocus
          />
        )
      );
    }

    // use custom renderer if provided
    if (column.render) {
      return column.render(props.song, props.index);
    }

    // default cell content
    return (
      <div
        class={`px-3 py-2 text-sm ${column.editable ? "cursor-pointer" : ""}`}
        onDblClick={() => column.editable && props.onEditStart?.(column.key)}
      >
        {formatCellValue(column.key, value)}
      </div>
    );
  };

  return (
    <div
      class={`absolute inset-x-0 flex items-center transition-colors ${
        props.isSelected
          ? "bg-magenta-500 bg-opacity-30 shadow-[inset_0_0_0_2px_rgb(217,70,239)]"
          : "bg-black bg-opacity-90 hover:bg-opacity-70"
      } ${props.isFocused ? "shadow-[inset_0_0_0_1px_white]" : ""}`}
      style={{
        height: "64px",
        transform: `translateY(${props.index * 64}px)`,
      }}
      onClick={props.onClick}
      onDblClick={props.onDoubleClick}
      onContextMenu={props.onContextMenu}
      tabIndex={0}
    >
      <For each={visibleColumns()}>{(column) => renderCell(column)}</For>
    </div>
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
      return formatDate(value);
    case "file_size":
      return formatFileSize(value);
    case "rating":
      return "★".repeat(value || 0);
    case "is_favorite":
      return value ? "♥" : "";
    case "is_explicit":
      return value ? "E" : "";
    default:
      return value?.toString() || "";
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

function formatFileSize(bytes: number): string {
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
