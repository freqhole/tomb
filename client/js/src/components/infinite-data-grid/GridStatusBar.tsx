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
  return (
    <div class={`${GRID_STYLES.statusBar} ${props.class || ""}`}>
      <div class="flex items-center space-x-4">
        <span class={GRID_STYLES.statusText}>
          {props.visibleItems > 0
            ? `showing 1-${props.visibleItems} of ${props.totalItems} songs`
            : "loading..."}
        </span>

        <Show when={props.selectedCount > 0}>
          <span class={GRID_STYLES.statusHighlight}>
            {props.selectedCount} selected
          </span>
        </Show>
      </div>

      <div class="flex items-center space-x-2">
        <Show when={props.loading}>
          <div class="flex items-center space-x-2">
            <div class={GRID_STYLES.loadingSpinner}></div>
            <span class={GRID_STYLES.loadingText}>loading more...</span>
          </div>
        </Show>

        <Show when={!props.loading && props.hasMore}>
          <span class={GRID_STYLES.statusMuted}>scroll for more</span>
        </Show>

        <Show when={!props.loading && !props.hasMore}>
          <span class={GRID_STYLES.statusMuted}>end of list</span>
        </Show>
      </div>
    </div>
  );
}
