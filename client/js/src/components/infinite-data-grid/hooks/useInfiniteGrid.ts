import { createSignal, createMemo } from "solid-js";
import type { SortConfig, SortDirection } from "../types";
import { getDisplayFilename } from "../../../lib/media-utils";

// Enhanced sorting utilities
const compareValues = (a: any, b: any, field: string): number => {
  // Handle null/undefined values
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  const aValue = a[field];
  const bValue = b[field];

  if (aValue == null && bValue == null) return 0;
  if (aValue == null) return 1;
  if (bValue == null) return -1;

  // Special handling for dynamic name field
  if (field === "name") {
    const aName = getDisplayFilename(a as any);
    const bName = getDisplayFilename(b as any);
    return aName.localeCompare(bName, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }

  // Date comparison
  if (
    field.includes("_at") ||
    field.includes("date") ||
    field.includes("time")
  ) {
    const aDate = new Date(aValue);
    const bDate = new Date(bValue);
    if (!isNaN(aDate.getTime()) && !isNaN(bDate.getTime())) {
      return aDate.getTime() - bDate.getTime();
    }
  }

  // Numeric comparison
  const aNum = Number(aValue);
  const bNum = Number(bValue);
  if (
    !isNaN(aNum) &&
    !isNaN(bNum) &&
    typeof aValue === "number" &&
    typeof bValue === "number"
  ) {
    return aNum - bNum;
  }

  // Size comparison (handles byte strings like "1.2 MB")
  if (
    field === "size" &&
    typeof aValue === "string" &&
    typeof bValue === "string"
  ) {
    const aSizeBytes = parseSizeString(aValue);
    const bSizeBytes = parseSizeString(bValue);
    if (aSizeBytes !== null && bSizeBytes !== null) {
      return aSizeBytes - bSizeBytes;
    }
  }

  // String comparison (case-insensitive)
  const aStr = String(aValue).toLowerCase();
  const bStr = String(bValue).toLowerCase();

  // Natural sort for strings with numbers (e.g., "file1.jpg" vs "file10.jpg")
  if (field === "name" || field.includes("filename")) {
    return aStr.localeCompare(bStr, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }

  return aStr.localeCompare(bStr);
};

const parseSizeString = (sizeStr: string): number | null => {
  const match = sizeStr.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)?$/i);
  if (!match || !match[1]) return null;

  const value = parseFloat(match[1]);
  const unit = (match[2] || "B").toUpperCase();

  const multipliers: { [key: string]: number } = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
  };

  return value * (multipliers[unit] || 1);
};

export function useInfiniteGrid<T = any>(props: {
  data: T[];
  getItemId?: (item: T) => string;
  initialSort?: { field: string; direction: SortDirection };
  defaultSort?: { field: string; direction: SortDirection };
}) {
  // State
  const defaultSortConfig = props.defaultSort || {
    field: "created_at",
    direction: "desc",
  };
  const [sortConfig, setSortConfig] = createSignal<SortConfig>(
    props.initialSort || defaultSortConfig
  );
  const [selectedItems, setSelectedItems] = createSignal<Set<string>>(
    new Set()
  );
  const [isDragSelecting, setIsDragSelecting] = createSignal(false);
  const [isSorting, setIsSorting] = createSignal(false);

  // Default ID getter
  const getItemId = props.getItemId || ((item: any) => item.id || String(item));

  // Computed values
  const sortedData = createMemo(() => {
    const config = sortConfig();
    const data = [...props.data];

    // Show sorting indicator for large datasets
    if (data.length > 1000) {
      setIsSorting(true);
      // Use setTimeout to allow UI to update before heavy computation
      setTimeout(() => setIsSorting(false), 100);
    }

    return data.sort((a, b) => {
      const comparison = compareValues(a, b, config.field);
      return config.direction === "desc" ? comparison * -1 : comparison;
    });
  });

  // Actions
  const handleSort = (field: string) => {
    const current = sortConfig();

    if (current.field === field) {
      // Determine what the "first" direction should be for this field
      const firstDirection =
        field.includes("_at") ||
        field.includes("date") ||
        field.includes("time")
          ? "desc"
          : "asc";
      const secondDirection = firstDirection === "desc" ? "asc" : "desc";

      // Triple-click cycling: first -> second -> default
      if (current.direction === firstDirection) {
        setSortConfig({ field, direction: secondDirection });
      } else if (current.direction === secondDirection) {
        // Reset to default sort (third click)
        setSortConfig(defaultSortConfig);
      } else {
        // Shouldn't happen, but handle gracefully
        setSortConfig({ field, direction: firstDirection });
      }
    } else {
      // New field: start with appropriate direction
      const newDirection =
        field.includes("_at") ||
        field.includes("date") ||
        field.includes("time")
          ? "desc"
          : "asc";
      setSortConfig({ field, direction: newDirection });
    }
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
    isSorting,

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
