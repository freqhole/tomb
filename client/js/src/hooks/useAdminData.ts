import { createSignal, createMemo } from "solid-js";
import type {
  AdminGridState,
  AdminMusicFilters,
  AdminPagination,
  MusicListResponse,
} from "../lib/admin/admin-api.js";
import { ApiClient } from "../lib/api-client.js";

/**
 * Generic admin data configuration
 */
export interface AdminDataConfig {
  apiEndpoint: string;
  defaultFilters?: Partial<AdminMusicFilters>;
  defaultPagination?: Partial<AdminPagination>;
  defaultSort?: { field: string; direction: "asc" | "desc" };
  responseSchema?: any; // Zod schema for validation
  debounceMs?: number;
}

/**
 * Admin data fetch options
 */
export interface AdminDataFetchOptions {
  filters?: Partial<AdminMusicFilters>;
  pagination?: Partial<AdminPagination>;
  sort?: { field: string; direction: "asc" | "desc" };
  resetPage?: boolean;
}

/**
 * Generic admin data management hook
 *
 * Provides reactive state management for admin grids with:
 * - Data fetching and caching
 * - Filtering and pagination
 * - Sorting
 * - Loading states
 * - Error handling
 */
export function createAdminData<T extends { id: string }>(
  apiClient: ApiClient,
  config: AdminDataConfig
) {
  // Core state
  const [items, setItems] = createSignal<T[]>([]);
  const [allLoadedItems, setAllLoadedItems] = createSignal<T[]>([]); // For infinite scroll
  const [total, setTotal] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Filter state
  const [filters, setFilters] = createSignal<AdminMusicFilters>({
    ...config.defaultFilters,
  });

  // Pagination state
  const [pagination, setPagination] = createSignal<
    AdminPagination & {
      total_pages?: number;
      has_next?: boolean;
      has_prev?: boolean;
    }
  >({
    page: 1,
    page_size: 100,
    ...config.defaultPagination,
  });

  // Sort state
  const [sortField, setSortField] = createSignal<string | null>(
    config.defaultSort?.field || null
  );
  const [sortDirection, setSortDirection] = createSignal<"asc" | "desc" | null>(
    config.defaultSort?.direction || null
  );

  // Computed state
  const gridState = createMemo(
    (): AdminGridState<T> => ({
      items: items(),
      total: total(),
      loading: loading(),
      error: error(),
      selectedIds: new Set(), // This will be managed by selection hook
      filters: filters(),
      pagination: pagination(),
      sortField: sortField(),
      sortDirection: sortDirection(),
    })
  );

  // Debounced fetch trigger
  let fetchTimeout: NodeJS.Timeout | null = null;
  const debouncedFetch = (immediate = false) => {
    if (fetchTimeout) {
      clearTimeout(fetchTimeout);
    }

    const delay = immediate ? 0 : config.debounceMs || 300;

    fetchTimeout = setTimeout(() => {
      fetchData();
    }, delay);
  };

  /**
   * Main data fetching function
   */
  const fetchData = async (options?: AdminDataFetchOptions) => {
    try {
      console.log("useAdminData: starting fetch", {
        endpoint: config.apiEndpoint,
        options,
      });
      console.log("useAdminData: apiClient available:", !!apiClient);
      setLoading(true);
      setError(null);

      // Merge options with current state
      const fetchFilters = { ...filters(), ...options?.filters };
      const fetchPagination = { ...pagination(), ...options?.pagination };
      const fetchSort = options?.sort || {
        field: sortField(),
        direction: sortDirection(),
      };

      // Reset page if filters changed
      if (options?.resetPage) {
        fetchPagination.page = 1;
      }

      // Build query parameters
      const params: Record<string, any> = {
        ...fetchFilters,
        ...fetchPagination,
      };

      // Add sorting if specified
      if (fetchSort.field && fetchSort.direction) {
        params.sort_field = fetchSort.field;
        params.sort_direction = fetchSort.direction;
        console.log("useAdminData: adding sort params", {
          sort_field: fetchSort.field,
          sort_direction: fetchSort.direction,
        });
      }

      // Make API request
      console.log("useAdminData: making api request", {
        endpoint: config.apiEndpoint,
        params,
      });
      console.log(
        "useAdminData: full API URL would be:",
        `${apiClient.getBaseUrl()}${config.apiEndpoint}`
      );
      const response = await apiClient.makeRequest<MusicListResponse>(
        "GET",
        config.apiEndpoint,
        { params }
      );
      console.log("useAdminData: received API response:", response);

      // Validate response if schema provided
      let validatedResponse = response;
      if (config.responseSchema) {
        validatedResponse = config.responseSchema.parse(response);
      }

      // Update state
      const newItems = (validatedResponse.songs as unknown as T[]) || [];
      console.log("useAdminData: updating state with items:", newItems.length);

      if (fetchPagination.page && fetchPagination.page > 1) {
        // For infinite scroll, append new items to existing ones
        setAllLoadedItems((prev) => [...prev, ...newItems]);
        setItems(() => allLoadedItems());
      } else {
        // For first page, replace items
        setAllLoadedItems(newItems);
        setItems(newItems);
      }

      setTotal(validatedResponse.total || 0);

      // Update pagination with response data
      setPagination({
        ...fetchPagination,
        total_pages: validatedResponse.total_pages,
        has_next: validatedResponse.has_next,
        has_prev: validatedResponse.has_prev,
      });

      // Update filters and sort state
      setFilters(fetchFilters);
      if (fetchSort.field) {
        setSortField(fetchSort.field);
        setSortDirection(fetchSort.direction);
      }
    } catch (err) {
      console.error("useAdminData: failed to fetch admin data:", err);
      console.error("useAdminData: error details", {
        endpoint: config.apiEndpoint,
        error: err instanceof Error ? err.message : String(err),
      });
      setError(err instanceof Error ? err.message : "failed to fetch data");
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Update filters and refresh data
   */
  const updateFilters = (
    newFilters: Partial<AdminMusicFilters>,
    immediate = false
  ) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
    // Reset accumulated items when filters change
    setAllLoadedItems([]);
    debouncedFetch(immediate);
  };

  /**
   * Update pagination and refresh data
   */
  const updatePagination = (newPagination: Partial<AdminPagination>) => {
    setPagination((prev) => ({ ...prev, ...newPagination }));
    debouncedFetch(true); // Pagination changes should be immediate
  };

  /**
   * Update sort and refresh data
   */
  const updateSort = (field: string, direction?: "asc" | "desc" | null) => {
    console.log("useAdminData: updateSort called", { field, direction });

    if (direction === null) {
      // Reset to default sort
      console.log("useAdminData: resetting to default sort");
      setSortField(config.defaultSort?.field || null);
      setSortDirection(config.defaultSort?.direction || null);
    } else {
      // Toggle direction if same field
      let newDirection = direction;
      if (!newDirection) {
        if (sortField() === field) {
          newDirection = sortDirection() === "asc" ? "desc" : "asc";
        } else {
          newDirection = "asc";
        }
      }

      setSortField(field);
      setSortDirection(newDirection);
    }

    // Reset to first page when sorting changes
    setAllLoadedItems([]);
    setPagination((prev) => ({ ...prev, page: 1 }));
    debouncedFetch(true); // Sort changes should be immediate
  };

  /**
   * Clear all filters
   */
  const clearFilters = () => {
    setFilters({ ...config.defaultFilters });
    setPagination((prev) => ({ ...prev, page: 1 }));
    // Reset accumulated items when clearing filters
    setAllLoadedItems([]);
    debouncedFetch(true);
  };

  /**
   * Refresh data with current state
   */
  const refresh = () => {
    // Reset accumulated items when refreshing
    setAllLoadedItems([]);
    setPagination((prev) => ({ ...prev, page: 1 }));
    debouncedFetch(true);
  };

  /**
   * Go to specific page
   */
  const goToPage = (page: number) => {
    updatePagination({ page });
  };

  /**
   * Go to next page
   */
  const nextPage = () => {
    const current = pagination();
    if (current.has_next) {
      // For infinite scroll, keep current page state and just fetch next page
      updatePagination({ page: (current.page || 1) + 1 });
    }
  };

  /**
   * Go to previous page
   */
  const prevPage = () => {
    const current = pagination();
    if (current.has_prev && (current.page || 1) > 1) {
      goToPage((current.page || 1) - 1);
    }
  };

  /**
   * Reset to first page
   */
  const resetPage = () => {
    goToPage(1);
  };

  // Note: Auto-fetch removed - AdminView will call fetchData manually to avoid conflicts

  // Cleanup
  onCleanup(() => {
    if (fetchTimeout) {
      clearTimeout(fetchTimeout);
    }
  });

  return {
    // State
    gridState,
    items,
    total,
    loading,
    error,
    filters,
    pagination,
    sortField,
    sortDirection,

    // Actions
    fetchData,
    updateFilters,
    updatePagination,
    updateSort,
    clearFilters,
    refresh,
    goToPage,
    nextPage,
    prevPage,
    resetPage,

    // Utilities
    hasNextPage: createMemo(() => pagination().has_next || false),
    hasPrevPage: createMemo(() => pagination().has_prev || false),
    currentPage: createMemo(() => pagination().page || 1),
    totalPages: createMemo(() => pagination().total_pages || 0),
    pageSize: createMemo(() => pagination().page_size || 100),
  };
}

/**
 * Admin data utility functions
 */
export const adminDataUtils = {
  /**
   * Create default pagination
   */
  createDefaultPagination(): AdminPagination {
    return {
      page: 1,
      page_size: 100,
    };
  },

  /**
   * Create URL search params from filters
   */
  filtersToSearchParams(filters: AdminMusicFilters): URLSearchParams {
    const params = new URLSearchParams();

    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        if (Array.isArray(value)) {
          value.forEach((v) => params.append(key, String(v)));
        } else {
          params.set(key, String(value));
        }
      }
    });

    return params;
  },

  /**
   * Parse filters from URL search params
   */
  searchParamsToFilters(params: URLSearchParams): Partial<AdminMusicFilters> {
    const filters: Partial<AdminMusicFilters> = {};

    // Handle string filters
    const stringFields = [
      "artist",
      "album",
      "genre",
      "title_search",
      "file_format",
    ];
    stringFields.forEach((field) => {
      const value = params.get(field);
      if (value) (filters as any)[field] = value;
    });

    // Handle number filters
    const numberFields = [
      "year",
      "year_min",
      "year_max",
      "rating_min",
      "rating_max",
      "duration_min",
      "duration_max",
    ];
    numberFields.forEach((field) => {
      const value = params.get(field);
      if (value && !isNaN(Number(value))) {
        (filters as any)[field] = Number(value);
      }
    });

    // Handle boolean filters
    const booleanFields = ["favorites", "has_thumbnail"];
    booleanFields.forEach((field) => {
      const value = params.get(field);
      if (value) {
        (filters as any)[field] = value === "true";
      }
    });

    // Handle array filters
    const tags = params.getAll("tags");
    if (tags.length > 0) {
      filters.tags = tags;
    }

    return filters;
  },

  /**
   * Calculate pagination info
   */
  calculatePaginationInfo(current: AdminPagination, total: number) {
    const page = current.page || 1;
    const pageSize = current.page_size || 100;
    const totalPages = Math.ceil(total / pageSize);

    return {
      page,
      pageSize,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
      startItem: (page - 1) * pageSize + 1,
      endItem: Math.min(page * pageSize, total),
    };
  },
};
