import { createSignal } from "solid-js";

export type SortDirection = "asc" | "desc" | null;

export interface SortConfig {
  field: string | null;
  direction: SortDirection;
}

export interface SortingHook {
  sortConfig: () => SortConfig;
  setSorting: (field: string, direction: SortDirection) => void;
  toggleSort: (field: string) => void;
  clearSort: () => void;
  getSortParams: () => { sort_by?: string; sort_direction?: string };
}

const DEFAULT_SORT_FIELD = "created_at";
const DEFAULT_SORT_DIRECTION = "desc";

/**
 * Hook for managing sorting state in freqhole view
 * Provides three-state sorting: asc -> desc -> null (reset to default)
 */
export function useSorting(
  defaultField: string = DEFAULT_SORT_FIELD,
  defaultDirection: SortDirection = DEFAULT_SORT_DIRECTION
): SortingHook {
  const [sortConfig, setSortConfig] = createSignal<SortConfig>({
    field: defaultField,
    direction: defaultDirection,
  });

  const setSorting = (field: string, direction: SortDirection) => {
    setSortConfig({
      field: direction === null ? defaultField : field,
      direction: direction === null ? defaultDirection : direction,
    });
  };

  const toggleSort = (field: string) => {
    const current = sortConfig();

    if (current.field !== field) {
      // Clicking a new field - start with ascending
      setSorting(field, "asc");
    } else {
      // Clicking the same field - cycle through states
      switch (current.direction) {
        case "asc":
          setSorting(field, "desc");
          break;
        case "desc":
          setSorting(defaultField, defaultDirection); // Reset to default
          break;
        default:
          setSorting(field, "asc");
          break;
      }
    }
  };

  const clearSort = () => {
    setSorting(defaultField, defaultDirection);
  };

  const getSortParams = () => {
    const config = sortConfig();
    if (!config.field || !config.direction) {
      return {};
    }

    return {
      sort_by: config.field,
      sort_direction: config.direction,
    };
  };

  return {
    sortConfig,
    setSorting,
    toggleSort,
    clearSort,
    getSortParams,
  };
}

/**
 * Helper function to get sort indicator for UI display
 */
export function getSortIndicator(
  field: string,
  sortConfig: SortConfig
): "asc" | "desc" | null {
  if (sortConfig.field === field) {
    return sortConfig.direction;
  }
  return null;
}

/**
 * Supported sort fields for songs
 */
export const SUPPORTED_SORT_FIELDS = [
  "title",
  "artist",
  "album",
  "year",
  "rating",
  "duration_seconds",
  "created_at",
] as const;

export type SupportedSortField = (typeof SUPPORTED_SORT_FIELDS)[number];
