import { For, Show } from "solid-js";
import type { GridColumn, SortDirection } from "./types";
import { GRID_STYLES, getHeaderClasses } from "./styles/grid-styles";

export interface GridHeaderProps<T = any> {
  columns: GridColumn<T>[];
  sortField?: string;
  sortDirection?: SortDirection | null;
  onSort?: (field: string) => void;
  selectedCount?: number;
  totalCount?: number;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  class?: string;
}

export function GridHeader<T>(props: GridHeaderProps<T>) {
  const getSortIndicator = (column: GridColumn<T>) => {
    if (!column.sortable || props.sortField !== column.key) {
      return null;
    }

    const direction = props.sortDirection;
    if (direction === "asc") {
      return "↑";
    } else if (direction === "desc") {
      return "↓";
    }
    return null;
  };

  const handleSort = (column: GridColumn<T>) => {
    if (column.sortable && props.onSort) {
      props.onSort(column.key);
    }
  };

  const handleSelectAll = () => {
    if (props.selectedCount === props.totalCount) {
      props.onClearSelection?.();
    } else {
      props.onSelectAll?.();
    }
  };

  const isAllSelected = () => {
    return (
      (props.selectedCount || 0) === (props.totalCount || 0) &&
      (props.totalCount || 0) > 0
    );
  };

  const isSomeSelected = () => {
    return (
      (props.selectedCount || 0) > 0 &&
      (props.selectedCount || 0) < (props.totalCount || 0)
    );
  };

  return (
    <div class={`${GRID_STYLES.headerRow} ${props.class || ""}`} role="row">
      <Show when={props.onSelectAll}>
        <div class="flex-shrink-0 px-3 py-3 flex items-center justify-center">
          <input
            type="checkbox"
            class={GRID_STYLES.checkbox}
            checked={isAllSelected()}
            ref={(el) => {
              if (el) el.indeterminate = isSomeSelected();
            }}
            onChange={handleSelectAll}
            aria-label={
              isAllSelected() ? "deselect all rows" : "select all rows"
            }
          />
        </div>
      </Show>

      <For each={props.columns}>
        {(column) => (
          <div
            class={`${getHeaderClasses(column)} flex-shrink-0`}
            style={{
              width:
                typeof column.width === "number"
                  ? `${column.width}px`
                  : column.width || "auto",
              "min-width": column.minWidth ? `${column.minWidth}px` : undefined,
              "max-width": column.maxWidth ? `${column.maxWidth}px` : undefined,
            }}
            onClick={() => handleSort(column)}
            role="columnheader"
            aria-sort={
              props.sortField === column.key
                ? props.sortDirection === "asc"
                  ? "ascending"
                  : props.sortDirection === "desc"
                    ? "descending"
                    : "none"
                : "none"
            }
            tabIndex={column.sortable ? 0 : -1}
            onKeyDown={(e) => {
              if (column.sortable && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                handleSort(column);
              }
            }}
          >
            <div class="flex items-center justify-between">
              <span class="truncate">
                {column.renderHeader ? column.renderHeader() : column.title}
              </span>
              <Show when={column.sortable && getSortIndicator(column)}>
                <span class={`${GRID_STYLES.sortIndicator} ml-1 flex-shrink-0`}>
                  {getSortIndicator(column)}
                </span>
              </Show>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
