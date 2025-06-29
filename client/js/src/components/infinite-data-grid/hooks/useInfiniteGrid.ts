import { createSignal, createMemo } from "solid-js";
import type { SortConfig, SortDirection } from "../types";

export function useInfiniteGrid<T = any>(props: {
  data: T[];
  getItemId?: (item: T) => string;
  initialSort?: { field: string; direction: SortDirection };
}) {
  // State
  const [sortConfig, setSortConfig] = createSignal<SortConfig>(
    props.initialSort || { field: "id", direction: "asc" }
  );
  const [selectedItems, setSelectedItems] = createSignal<Set<string>>(
    new Set()
  );
  const [isDragSelecting, setIsDragSelecting] = createSignal(false);

  // Default ID getter
  const getItemId = props.getItemId || ((item: any) => item.id || String(item));

  // Computed values
  const sortedData = createMemo(() => {
    const config = sortConfig();
    const data = [...props.data];

    return data.sort((a, b) => {
      const aValue = (a as any)[config.field];
      const bValue = (b as any)[config.field];

      let comparison = 0;

      if (aValue < bValue) {
        comparison = -1;
      } else if (aValue > bValue) {
        comparison = 1;
      }

      return config.direction === "desc" ? comparison * -1 : comparison;
    });
  });

  // Actions
  const handleSort = (field: string) => {
    const current = sortConfig();
    const newDirection: SortDirection =
      current.field === field && current.direction === "asc" ? "desc" : "asc";

    setSortConfig({ field, direction: newDirection });
  };

  const toggleSelection = (itemId: string) => {
    const current = new Set(selectedItems());
    if (current.has(itemId)) {
      current.delete(itemId);
    } else {
      current.add(itemId);
    }
    setSelectedItems(current);
  };

  const clearSelection = () => {
    setSelectedItems(new Set<string>());
  };

  const selectAll = () => {
    const allIds = new Set(props.data.map(getItemId));
    setSelectedItems(allIds);
  };

  const isSelected = (itemId: string) => {
    return selectedItems().has(itemId);
  };

  const selectRange = (startIndex: number, endIndex: number) => {
    const current = new Set(selectedItems());
    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);

    for (let i = start; i <= end; i++) {
      if (i < props.data.length && props.data[i] != null) {
        const itemId = getItemId(props.data[i]!);
        current.add(itemId);
      }
    }

    setSelectedItems(current);
  };

  return {
    // State
    sortConfig,
    selectedItems,
    isDragSelecting,

    // Computed
    sortedData,

    // Actions
    handleSort,
    toggleSelection,
    clearSelection,
    selectAll,
    isSelected,
    selectRange,
    setIsDragSelecting,

    // Utils
    getItemId,
  };
}
