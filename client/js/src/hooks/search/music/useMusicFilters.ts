import { createSignal, onMount } from "solid-js";
import type { ApiClient } from "../../../lib/api-client.js";
import {
  createMusicFilterClient,
  type AllFiltersResponse,
  type FilterOption,
  type DefaultFilterOptions,
  transformToDefaultFormat,
  MusicFilterApiError,
} from "../../../lib/search/music/index.js";

export interface UseMusicFiltersProps {
  /** API client for fetching filter data */
  apiClient: ApiClient;
  /** Whether to auto-fetch filters on mount */
  autoFetch?: boolean;
  /** Minimum count threshold for filter options */
  minCount?: number;
  /** Maximum number of filter options to fetch */
  limit?: number;
  /** Error callback */
  onError?: (error: Error) => void;
}

export interface UseMusicFiltersReturn {
  /** Filter options with counts */
  filterOptions: () => DefaultFilterOptions;
  /** Raw filter response data */
  filterData: () => AllFiltersResponse | null;
  /** Loading state */
  loading: () => boolean;
  /** Error state */
  error: () => Error | null;
  /** Refresh filter data */
  refreshFilters: () => Promise<void>;
  /** Clear error */
  clearError: () => void;
  /** Get filter option by value */
  getFilterOption: (
    filterType: keyof DefaultFilterOptions,
    value: string
  ) => FilterOption | undefined;
  /** Check if filters are available */
  hasFilters: () => boolean;
}

/**
 * Hook for managing music filter options with dynamic data from API
 *
 * This hook provides filter options for search components, fetching real
 * metadata from the server including counts and popular items.
 */
export function useMusicFilters(
  props: UseMusicFiltersProps
): UseMusicFiltersReturn {
  // Core state
  const [filterData, setFilterData] = createSignal<AllFiltersResponse | null>(
    null
  );
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<Error | null>(null);

  // Create filter client
  const filterClient = createMusicFilterClient(props.apiClient);

  // Computed filter options in component-compatible format
  const filterOptions = () => {
    const data = filterData();
    if (!data) {
      // Return fallback default options
      return {
        genres: [
          { value: "rock", label: "Rock" },
          { value: "pop", label: "Pop" },
          { value: "jazz", label: "Jazz" },
          { value: "classical", label: "Classical" },
          { value: "electronic", label: "Electronic" },
        ],
        artists: [{ value: "", label: "All Artists" }],
        types: [
          { value: "song", label: "Song" },
          { value: "album", label: "Album" },
          { value: "artist", label: "Artist" },
        ],
      };
    }

    return transformToDefaultFormat(data);
  };

  // Fetch filter data
  const refreshFilters = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await filterClient.getAllFilters({
        limit: props.limit || 50,
        min_count: props.minCount || 1,
      });

      setFilterData(response);
    } catch (err) {
      const error =
        err instanceof MusicFilterApiError
          ? err
          : new Error(`Failed to fetch filters: ${err}`);

      setError(error);

      if (props.onError) {
        props.onError(error);
      }
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch on mount if enabled
  onMount(() => {
    if (props.autoFetch !== false) {
      refreshFilters();
    }
  });

  // Clear error function
  const clearError = () => {
    setError(null);
  };

  // Get specific filter option
  const getFilterOption = (
    filterType: keyof DefaultFilterOptions,
    value: string
  ): FilterOption | undefined => {
    const data = filterData();
    if (!data) return undefined;

    const options = data[filterType as keyof AllFiltersResponse];
    if (Array.isArray(options)) {
      return options.find((option) => option.value === value);
    }

    return undefined;
  };

  // Check if filters are available
  const hasFilters = () => {
    const data = filterData();
    return (
      data !== null &&
      (data.genres.length > 0 ||
        data.artists.length > 0 ||
        data.years.length > 0)
    );
  };

  return {
    filterOptions,
    filterData,
    loading,
    error,
    refreshFilters,
    clearError,
    getFilterOption,
    hasFilters,
  };
}

export default useMusicFilters;
