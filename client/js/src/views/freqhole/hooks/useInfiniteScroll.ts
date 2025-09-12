/* @jsxImportSource solid-js */
import { createSignal, createEffect, onCleanup } from "solid-js";

export interface PaginationMetadata {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

export interface InfiniteScrollOptions {
  /**
   * Distance from bottom of container (in pixels) to trigger loading
   * @default 200
   */
  threshold?: number;

  /**
   * Container element to watch for scroll events
   * If not provided, will use window
   */
  container?: HTMLElement | null;

  /**
   * Enable/disable infinite scroll
   * @default true
   */
  enabled?: boolean | (() => boolean);
}

export interface InfiniteScrollState<T> {
  items: () => T[];
  loading: () => boolean;
  error: () => string | null;
  hasMore: () => boolean;
  pagination: () => PaginationMetadata | null;
}

export interface InfiniteScrollActions {
  loadMore: () => Promise<void>;
  reset: () => void;
  clearError: () => void;
  setItems: (items: any[]) => void;
}

export interface UseInfiniteScrollResult<T> {
  state: InfiniteScrollState<T>;
  actions: InfiniteScrollActions;
  containerRef: (el: HTMLElement) => void;
}

/**
 * Hook for implementing infinite scroll with automatic loading
 *
 * @param fetchFn Function to fetch data, receives page number and returns {items, pagination}
 * @param options Configuration options for infinite scroll behavior
 */
export function useInfiniteScroll<T>(
  fetchFn: (
    page: number
  ) => Promise<{ items: T[]; pagination: PaginationMetadata }>,
  options: InfiniteScrollOptions = {}
): UseInfiniteScrollResult<T> {
  const { threshold = 200, container = null, enabled = true } = options;

  // Helper to check if enabled
  const isEnabled = () => {
    return typeof enabled === "function" ? enabled() : enabled;
  };

  // State signals
  const [items, setItems] = createSignal<T[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [pagination, setPagination] = createSignal<PaginationMetadata | null>(
    null
  );
  const [containerElement, setContainerElement] =
    createSignal<HTMLElement | null>(container);

  // Derived state
  const hasMore = () => {
    const pag = pagination();
    const result = pag ? pag.has_next : true; // Allow initial load when no pagination yet
    // hasMore check - removed verbose logging
    return result;
  };

  // Immediate scroll handler with passive listening
  let checkInProgress = false;

  const handleScroll = () => {
    if (checkInProgress || !isEnabled() || loading() || !hasMore()) {
      return;
    }

    checkInProgress = true;

    const element = containerElement() || window;
    let scrollHeight: number;
    let scrollTop: number;
    let clientHeight: number;

    if (element === window) {
      scrollHeight = document.documentElement.scrollHeight;
      scrollTop = window.scrollY;
      clientHeight = window.innerHeight;
    } else {
      const el = element as HTMLElement;
      scrollHeight = el.scrollHeight;
      scrollTop = el.scrollTop;
      clientHeight = el.clientHeight;
    }

    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);

    if (distanceFromBottom <= threshold) {
      loadMore();
    }

    checkInProgress = false;
  };

  // Load more data
  const loadMore = async () => {
    const currentPagination = pagination();

    if (loading() || (!hasMore() && pagination())) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const nextPage = currentPagination ? currentPagination.page + 1 : 1;
      const result = await fetchFn(nextPage);

      setItems((prev) => [...prev, ...result.items]);
      setPagination(result.pagination);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to load more data";
      setError(errorMessage);
      console.error("infinite scroll error:", err);
    } finally {
      setLoading(false);
    }
  };

  // Reset to initial state
  const reset = () => {
    setItems([]);
    setPagination(null);
    setError(null);
    setLoading(false);
  };

  // Clear error
  const clearError = () => {
    setError(null);
  };

  // Set items directly (for initial load)
  const setItemsDirectly = (newItems: T[]) => {
    setItems(newItems);
  };

  // Container ref callback
  const containerRef = (el: HTMLElement) => {
    setContainerElement(el);
  };

  // Set up scroll event listeners
  createEffect(() => {
    if (!isEnabled()) return;

    const element = containerElement() || window;

    element.addEventListener("scroll", handleScroll, { passive: true });

    onCleanup(() => {
      element.removeEventListener("scroll", handleScroll);
    });
  });

  // Auto-load first page if no items
  createEffect(() => {
    const enabled = isEnabled();
    const itemsLength = items().length;
    const isLoading = loading();
    const paginationData = pagination();

    if (enabled && itemsLength === 0 && !isLoading && !paginationData) {
      loadMore();
    }
  });

  return {
    state: {
      items,
      loading,
      error,
      hasMore,
      pagination,
    },
    actions: {
      loadMore,
      reset,
      clearError,
      setItems: setItemsDirectly,
    },
    containerRef,
  };
}

/**
 * Utility function to create a fetch function for specific API endpoints
 */
export function createApiFetcher<T>(
  apiMethod: (options: {
    page: number;
    page_size?: number;
  }) => Promise<{ items: T[]; pagination: PaginationMetadata }>,
  pageSize: number = 50
) {
  return async (page: number) => {
    return await apiMethod({ page, page_size: pageSize });
  };
}

/**
 * Transform old API responses to new paginated format
 */
export function transformLegacyResponse<T>(
  items: T[],
  page: number = 1,
  pageSize: number = 50
): { items: T[]; pagination: PaginationMetadata } {
  const total = items.length;
  const totalPages = Math.ceil(total / pageSize);

  return {
    items,
    pagination: {
      total,
      page,
      page_size: pageSize,
      total_pages: totalPages,
      has_next: page < totalPages,
      has_prev: page > 1,
    },
  };
}
