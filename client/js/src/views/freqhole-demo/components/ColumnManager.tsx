/* @jsxImportSource solid-js */
import { For, Show } from "solid-js";
import type { ColumnVisibility } from "../types";

export interface ColumnManagerProps {
  columnVisibility: ColumnVisibility;
  onColumnToggle: (column: keyof ColumnVisibility) => void;
  onResetToDefaults?: () => void;
  className?: string;
}

const COLUMNS = [
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

export function ColumnManager(props: ColumnManagerProps) {
  return (
    <div class={`column-manager ${props.className || ""}`}>
      <For each={COLUMNS}>
        {(column) => (
          <div style="margin-bottom: 16px; min-width: 0;">
            <label style="display: flex; align-items: center; cursor: pointer;">
              <input
                type="checkbox"
                checked={
                  props.columnVisibility[column.key as keyof ColumnVisibility]
                }
                onChange={() =>
                  props.onColumnToggle(column.key as keyof ColumnVisibility)
                }
                style="margin-right: 8px; accent-color: #ff00ff;"
              />
              <span style="font-size: 14px; color: #e0e0e0;">
                {column.title}
              </span>
            </label>
          </div>
        )}
      </For>

      <Show when={props.onResetToDefaults}>
        <button
          onClick={props.onResetToDefaults}
          style={`
            margin-top: 8px;
            padding: 8px 12px;
            background: #333;
            border: 1px solid #555;
            color: #fff;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            width: 100%;
          `}
        >
          Reset to Defaults
        </button>
      </Show>
    </div>
  );
}

export default ColumnManager;
