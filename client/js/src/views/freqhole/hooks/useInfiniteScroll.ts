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

  /**
   * Debounce scroll events (in milliseconds)
   * @default 100
   */
  debounceMs?: number;
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
  const {
    threshold = 200,
    container = null,
    enabled = true,
    debounceMs = 100,
  } = options;

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

  // Debounced scroll handler
  let scrollTimeout: number | null = null;

  const handleScroll = () => {
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
    }

    scrollTimeout = setTimeout(() => {
      if (!isEnabled() || loading() || !hasMore()) {
        return;
      }

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
    }, debounceMs) as unknown as number;
  };

  // Load more data
  const loadMore = async () => {
    const currentPagination = pagination();
    // loadMore called - removed verbose logging

    if (loading() || (!hasMore() && pagination())) {
      // loadMore early exit - already loading or no more data
      return;
    }

    try {
      // loadMore starting fetch
      setLoading(true);
      setError(null);

      const nextPage = currentPagination ? currentPagination.page + 1 : 1;
      // loadMore fetching page: ${nextPage}

      const result = await fetchFn(nextPage);
      // loadMore fetch result received

      // Append new items to existing items
      setItems((prev) => [...prev, ...result.items]);
      setPagination(result.pagination);

      console.log(
        `📜 Infinite scroll: Loaded page ${nextPage}, ${result.items.length} new items, ${items().length} total`
      );
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to load more data";
      setError(errorMessage);
      console.error("📜 Infinite scroll error:", err);
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
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }
    });
  });

  // Auto-load first page if no items
  createEffect(() => {
    const enabled = isEnabled();
    const itemsLength = items().length;
    const isLoading = loading();
    const paginationData = pagination();

    console.log(
      `📜 Infinite scroll auto-load check [${Math.random().toString(36).substr(2, 4)}]:`,
      {
        enabled,
        itemsLength,
        isLoading,
        hasPagination: !!paginationData,
        shouldLoad:
          enabled && itemsLength === 0 && !isLoading && !paginationData,
        hookId: `${enabled ? "ACTIVE" : "INACTIVE"}-hook`,
      }
    );

    if (enabled && itemsLength === 0 && !isLoading && !paginationData) {
      console.log(
        `📜 Auto-loading first page... [${Math.random().toString(36).substr(2, 4)}]`
      );
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
