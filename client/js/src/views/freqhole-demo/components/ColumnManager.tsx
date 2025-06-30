
import { For, Show } from "solid-js";
import type { ColumnVisibility } from "../types";

export interface ColumnManagerProps {
  columnVisibility: ColumnVisibility;
  onColumnToggle: (column: keyof ColumnVisibility) => void;
  onResetToDefaults?: () => void;
  className?: string;
  // Responsive columns info
  responsiveColumnVisibility?: ColumnVisibility;
  hiddenColumns?: string[];
  breakpointInfo?: { name: string; size: string };
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
        {(column) => {
          const columnKey = column.key as keyof ColumnVisibility;
          const isEnabled = props.columnVisibility[columnKey];
          const isResponsiveHidden = props.hiddenColumns?.includes(column.key);
          const isActuallyVisible =
            props.responsiveColumnVisibility?.[columnKey] ?? isEnabled;

          return (
            <div style="margin-bottom: 16px; min-width: 0;">
              <label style="display: flex; align-items: center; cursor: pointer; position: relative;">
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={() => props.onColumnToggle(columnKey)}
                  style="margin-right: 8px; accent-color: #ff00ff;"
                />
                <span
                  style={`
                    font-size: 14px;
                    color: ${isActuallyVisible ? "#e0e0e0" : "#888"};
                    ${!isActuallyVisible && isEnabled ? "text-decoration: line-through;" : ""}
                  `}
                >
                  {column.title}
                </span>
                {isResponsiveHidden && (
                  <span
                    style="
                      margin-left: 8px;
                      background: #ff9900;
                      color: #000;
                      font-size: 9px;
                      font-weight: bold;
                      padding: 2px 4px;
                      border-radius: 3px;
                      line-height: 1;
                    "
                    title={`Hidden on mobile screens (${props.breakpointInfo?.name || "narrow"})`}
                  >
                    📱
                  </span>
                )}
              </label>
            </div>
          );
        }}
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
