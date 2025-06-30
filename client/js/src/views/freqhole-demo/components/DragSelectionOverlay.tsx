import { Show, createMemo } from "solid-js";
import { useFreqholeSelectionContext } from "../context/FreqholeStateContext";

export function DragSelectionOverlay() {
  const selection = useFreqholeSelectionContext();

  const selectionRectangle = createMemo(() => {
    if (
      !selection.isDragSelecting() ||
      !selection.dragStart() ||
      !selection.dragEnd()
    ) {
      return null;
    }

    const start = selection.dragStart()!;
    const end = selection.dragEnd()!;

    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);

    return { left, top, width, height };
  });

  return (
    <Show when={selection.isDragSelecting() && selectionRectangle()}>
      {(rect) => (
        <>
          {/* Main selection rectangle */}
          <div
            class="drag-selection-overlay"
            style={`
              position: fixed;
              left: ${rect().left}px;
              top: ${rect().top}px;
              width: ${rect().width}px;
              height: ${rect().height}px;
              background: rgba(0, 112, 243, 0.15);
              border: 2px solid #0070f3;
              border-radius: 3px;
              pointer-events: none;
              z-index: 999;
              transition: none;
            `}
          />

          {/* Corner indicators for better visibility */}
          <div
            class="drag-selection-corner drag-selection-corner-tl"
            style={`
              position: fixed;
              left: ${rect().left - 4}px;
              top: ${rect().top - 4}px;
              width: 8px;
              height: 8px;
              background: #0070f3;
              border: 2px solid #ffffff;
              border-radius: 50%;
              pointer-events: none;
              z-index: 1000;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            `}
          />

          <div
            class="drag-selection-corner drag-selection-corner-br"
            style={`
              position: fixed;
              left: ${rect().left + rect().width - 4}px;
              top: ${rect().top + rect().height - 4}px;
              width: 8px;
              height: 8px;
              background: #0070f3;
              border: 2px solid #ffffff;
              border-radius: 50%;
              pointer-events: none;
              z-index: 1000;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            `}
          />

          {/* Selection info tooltip */}
          <Show when={rect().width > 50 && rect().height > 20}>
            <div
              class="drag-selection-tooltip"
              style={`
                position: fixed;
                left: ${rect().left + rect().width / 2 - 40}px;
                top: ${rect().top + rect().height / 2 - 12}px;
                background: rgba(0, 0, 0, 0.8);
                color: #ffffff;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 11px;
                font-weight: 600;
                pointer-events: none;
                z-index: 1001;
                white-space: nowrap;
                backdrop-filter: blur(4px);
              `}
            >
              Selecting...
            </div>
          </Show>
        </>
      )}
    </Show>
  );
}
