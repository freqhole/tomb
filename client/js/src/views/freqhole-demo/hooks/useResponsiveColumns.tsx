/* @jsxImportSource solid-js */
import { createSignal, onMount, onCleanup } from "solid-js";
import type { ColumnVisibility } from "../types";

export interface ResponsiveColumnConfig {
  /** Minimum screen width to show this column */
  minWidth: number;
  /** Priority (lower = hidden first on narrow screens) */
  priority: number;
}

export interface UseResponsiveColumnsOptions {
  /** Base column visibility from user settings (reactive signal) */
  baseColumnVisibility: () => ColumnVisibility;
  /** Optional custom breakpoints for columns */
  columnConfig?: Partial<
    Record<keyof ColumnVisibility, ResponsiveColumnConfig>
  >;
}

// Default responsive column configuration
const DEFAULT_COLUMN_CONFIG: Record<
  keyof ColumnVisibility,
  ResponsiveColumnConfig
> = {
  // Core columns (always visible)
  thumbnail: { minWidth: 0, priority: 100 },
  name: { minWidth: 0, priority: 99 },
  actions: { minWidth: 0, priority: 98 },

  // Important columns (hidden only on mobile)
  size: { minWidth: 480, priority: 80 },
  mime: { minWidth: 420, priority: 70 },
  created_at: { minWidth: 360, priority: 60 },

  // Less important columns (hidden on small mobile)
  blob_type: { minWidth: 320, priority: 50 },
  updated_at: { minWidth: 280, priority: 40 },
  local_path: { minWidth: 240, priority: 30 },
  parent_blob_id: { minWidth: 200, priority: 20 },

  // Advanced columns (hidden only on very small screens)
  id: { minWidth: 160, priority: 10 },
};

export function useResponsiveColumns(options: UseResponsiveColumnsOptions) {
  const [screenWidth, setScreenWidth] = createSignal(window.innerWidth);

  // Merge user config with defaults
  const columnConfig = () => ({
    ...DEFAULT_COLUMN_CONFIG,
    ...options.columnConfig,
  });

  // Responsive column visibility based on screen width and user preferences
  const responsiveColumnVisibility = () => {
    const base = options.baseColumnVisibility();
    const config = columnConfig();
    const width = screenWidth();

    const responsive: ColumnVisibility = { ...base };

    // Apply responsive rules
    Object.entries(config).forEach(([key, rules]) => {
      const columnKey = key as keyof ColumnVisibility;

      // Only hide if user has it enabled AND screen is too narrow
      if (base[columnKey] && width < rules.minWidth) {
        responsive[columnKey] = false;
      }
    });

    return responsive;
  };

  // Get column priorities for sorting
  const getColumnPriority = (column: keyof ColumnVisibility): number => {
    return columnConfig()[column]?.priority || 0;
  };

  // Get columns that would be hidden at current screen width
  const getHiddenColumns = () => {
    const base = options.baseColumnVisibility();
    const config = columnConfig();
    const width = screenWidth();

    return Object.entries(config)
      .filter(([key, rules]) => {
        const columnKey = key as keyof ColumnVisibility;
        return base[columnKey] && width < rules.minWidth;
      })
      .map(([key]) => key as keyof ColumnVisibility)
      .sort((a, b) => getColumnPriority(a) - getColumnPriority(b));
  };

  // Get the minimum width needed to show all user-enabled columns
  const getMinimumWidthForAllColumns = () => {
    const base = options.baseColumnVisibility();
    const config = columnConfig();

    return Math.max(
      ...Object.entries(base)
        .filter(([, enabled]) => enabled)
        .map(([key]) => config[key as keyof ColumnVisibility]?.minWidth || 0)
    );
  };

  // Get responsive breakpoint info
  const getBreakpointInfo = () => {
    const width = screenWidth();

    if (width < 400) return { name: "small mobile", size: "xs" };
    if (width < 768) return { name: "mobile", size: "sm" };
    if (width < 1024) return { name: "tablet", size: "md" };
    if (width < 1400) return { name: "desktop", size: "lg" };
    return { name: "wide desktop", size: "xl" };
  };

  // Update screen width on resize
  const updateScreenWidth = () => {
    setScreenWidth(window.innerWidth);
  };

  // Set up resize listener
  onMount(() => {
    window.addEventListener("resize", updateScreenWidth);
  });

  onCleanup(() => {
    window.removeEventListener("resize", updateScreenWidth);
  });

  return {
    /** Current screen width in pixels */
    screenWidth,

    /** Column visibility adjusted for screen width */
    responsiveColumnVisibility,

    /** Get priority of a column (higher = more important) */
    getColumnPriority,

    /** Get list of columns hidden due to screen width */
    getHiddenColumns,

    /** Get minimum width needed to show all enabled columns */
    getMinimumWidthForAllColumns,

    /** Get current breakpoint info */
    getBreakpointInfo,

    /** Update screen width manually (for testing) */
    setScreenWidth,
  };
}

export default useResponsiveColumns;
