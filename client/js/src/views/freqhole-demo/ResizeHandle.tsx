import { createSignal } from "solid-js";
import type { ResizeHandleProps } from "./types";

export function ResizeHandle(props: ResizeHandleProps) {
  const [isHovered, setIsHovered] = createSignal(false);

  return (
    <div
      class={`resize-handle resize-handle-${props.position} ${
        props.isDragging ? "dragging" : ""
      } ${props.className || ""}`}
      onMouseDown={props.onMouseDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title="Drag to resize • Drag far to close panel"
      style={`
        position: absolute;
        top: 0;
        ${props.position === "left" ? "left: -4px;" : "right: -4px;"}
        width: 8px;
        height: 100%;
        background: transparent;
        cursor: col-resize;
        z-index: 10;
        transition: all 0.2s ease;
      `}
    >
      <div
        class="resize-handle-indicator"
        style={`
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 2px;
          height: 40px;
          background: ${isHovered() || props.isDragging ? "#ff00ff" : "#4a4a4a"};
          border-radius: 1px;
          transition: all 0.2s ease;
        `}
      />

      {/* Hover hint */}
      <div
        class="resize-handle-hint"
        style={`
          position: absolute;
          top: 50%;
          ${props.position === "left" ? "left: 12px;" : "right: 12px;"}
          transform: translateY(-50%);
          background: rgba(0, 0, 0, 0.9);
          color: #e0e0e0;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 11px;
          white-space: nowrap;
          pointer-events: none;
          opacity: ${isHovered() ? "1" : "0"};
          transition: opacity 0.2s ease;
          z-index: 20;
          border: 1px solid #3a3a3a;
        `}
      >
        Drag to resize • Drag far to close
      </div>

      <style>{`
        .resize-handle:hover,
        .resize-handle.dragging {
          background: rgba(255, 0, 255, 0.15);
        }

        .resize-handle:hover .resize-handle-indicator,
        .resize-handle.dragging .resize-handle-indicator {
          width: 3px !important;
          height: 60px !important;
          box-shadow: 0 0 4px rgba(255, 0, 255, 0.5);
        }
      `}</style>
    </div>
  );
}

export default ResizeHandle;
