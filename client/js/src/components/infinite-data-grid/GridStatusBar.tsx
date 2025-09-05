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
  // calculate display values with proper edge case handling
  const hasItems = props.totalItems > 0;
  const isLoading = props.loading && props.totalItems === 0;

  // for visible range display
  const startRow = hasItems ? (props.startRow ?? 1) : 0;
  const endRow = hasItems ? (props.endRow ?? props.totalItems) : 0;

  return (
    <div class={`${GRID_STYLES.statusBar} ${props.class || ""}`}>
      <div class="flex items-center space-x-4">
        <span class={GRID_STYLES.statusText}>
          {isLoading
            ? "loading..."
            : hasItems
              ? `showing ${startRow}-${endRow} of ${props.totalItems} songs`
              : "no songs found"}
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
