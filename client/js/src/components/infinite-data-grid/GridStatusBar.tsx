import { Show } from "solid-js";
import { GRID_STYLES } from "./styles/grid-styles";

export interface GridStatusBarProps {
  totalItems: number;
  visibleItems: number;
  selectedCount: number;
  loading?: boolean;
  hasMore?: boolean;
  class?: string;
  startRow?: number;
  endRow?: number;
}

export function GridStatusBar(props: GridStatusBarProps) {
  // Debug logging
  console.log("GridStatusBar props:", {
    totalItems: props.totalItems,
    visibleItems: props.visibleItems,
    startRow: props.startRow,
    endRow: props.endRow,
    selectedCount: props.selectedCount,
  });

  // Use visibleItems as the count when no explicit range is provided
  const startRow = props.visibleItems > 0 ? (props.startRow ?? 1) : 0;
  const endRow = props.endRow ?? props.visibleItems;

  console.log("GridStatusBar calculated:", { startRow, endRow });

  return (
    <div class={`${GRID_STYLES.statusBar} ${props.class || ""}`}>
      <div class="flex items-center space-x-4">
        <span class={GRID_STYLES.statusText}>
          {props.visibleItems > 0
            ? `showing ${startRow}-${endRow} of ${props.totalItems} songs`
            : "loading..."}
        </span>

        <Show when={props.selectedCount > 0}>
          <span class={GRID_STYLES.statusHighlight}>
            {props.selectedCount} selected
          </span>
        </Show>
      </div>

      <Show when={props.loading}>
        <div class="flex items-center space-x-2">
          <div class={GRID_STYLES.loadingSpinner}></div>
          <span class={GRID_STYLES.loadingText}>loading...</span>
        </div>
      </Show>
    </div>
  );
}
