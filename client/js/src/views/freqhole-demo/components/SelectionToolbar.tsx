import { Show } from "solid-js";

export interface SelectionToolbarProps {
  selectedCount: number;
  onDownload?: () => void;
  onClear?: () => void;
  onMore?: (event: MouseEvent) => void;
  className?: string;
}

export function SelectionToolbar(props: SelectionToolbarProps) {
  return (
    <Show when={props.selectedCount > 1}>
      <div
        class={`selection-toolbar ${props.className || ""}`}
        style={`
          position: fixed;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          background: #1a1a1a;
          border: 1px solid #3a3a3a;
          border-radius: 8px;
          padding: 12px 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          z-index: 100;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        `}
      >
        <span
          class="selection-count"
          style={`
            color: #ffffff;
            font-weight: 500;
            font-size: 14px;
          `}
        >
          {props.selectedCount} item{props.selectedCount === 1 ? "" : "s"}{" "}
          selected
        </span>

        <Show when={props.onDownload}>
          <button
            class="toolbar-button primary"
            onClick={props.onDownload}
            style={`
              background: #ff00ff;
              color: #000000;
              border: none;
              padding: 6px 12px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              font-weight: 600;
              transition: all 0.2s ease;
              user-select: none;
            `}
          >
            📥 Download
          </button>
        </Show>

        <Show when={props.onMore}>
          <button
            class="toolbar-button secondary"
            onClick={(e) => props.onMore?.(e)}
            style={`
              background: #333333;
              color: #ffffff;
              border: 1px solid #666666;
              padding: 6px 12px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s ease;
              user-select: none;
            `}
          >
            ⋯ More
          </button>
        </Show>

        <Show when={props.onClear}>
          <button
            class="toolbar-button clear"
            onClick={props.onClear}
            title="Clear selection"
            style={`
              background: transparent;
              color: #888888;
              border: 1px solid #555555;
              padding: 6px 8px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 16px;
              line-height: 1;
              transition: all 0.2s ease;
              display: flex;
              align-items: center;
              justify-content: center;
              user-select: none;
            `}
          >
            ×
          </button>
        </Show>

        <style>{`
          .toolbar-button:hover {
            transform: translateY(-1px);
          }

          .toolbar-button.primary:hover {
            background: #ff33ff !important;
            color: #000000 !important;
          }

          .toolbar-button.secondary:hover {
            background: #444444 !important;
            border-color: #777777 !important;
          }

          .toolbar-button.clear:hover {
            background: #333333 !important;
            color: #ffffff !important;
            border-color: #777777 !important;
          }
        `}</style>
      </div>
    </Show>
  );
}

export default SelectionToolbar;
