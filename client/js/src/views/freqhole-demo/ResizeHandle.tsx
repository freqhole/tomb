import type { ResizeHandleProps } from "./types";

export function ResizeHandle(props: ResizeHandleProps) {
  return (
    <div
      class={`resize-handle resize-handle-${props.position} ${
        props.isDragging ? "dragging" : ""
      } ${props.className || ""}`}
      onMouseDown={props.onMouseDown}
      title="Drag to resize panel"
      style={`
        position: absolute;
        top: 0;
        ${props.position === "left" ? "left: -4px;" : "right: -4px;"}
        width: 8px;
        height: 100%;
        background: transparent;
        cursor: col-resize;
        z-index: 10;
        transition: background-color 0.2s ease;
      `}
    >
      <div
        class="resize-handle-indicator"
        style={`
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 2px;
          height: 40px;
          background: #4a4a4a;
          border-radius: 1px;
          transition: background-color 0.2s ease;
        `}
      />

      <style>{`
        .resize-handle:hover,
        .resize-handle.dragging {
          background: #ff00ff;
        }

        .resize-handle:hover .resize-handle-indicator,
        .resize-handle.dragging .resize-handle-indicator {
          background: #ffffff;
        }
      `}</style>
    </div>
  );
}

export default ResizeHandle;
