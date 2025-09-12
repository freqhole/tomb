import { createSignal, createResource } from "solid-js";
import type { ApiClient } from "../../../lib/api-client";
import type { Album } from "../../../lib/music/schemas";

interface UseAlbumsReturn {
  // Core data
  albums: () => Album[];
  totalCount: () => number;

  // State
  loading: () => boolean;
  error: () => string | null;

  // Actions
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Simple albums data hook - replaces complex useInfiniteScroll pattern
 */
export function useAlbums(apiClient: ApiClient): UseAlbumsReturn {
  const [albums, setAlbums] = createSignal<Album[]>([]);
  const [currentPage, setCurrentPage] = createSignal(1);
  const [totalCount, setTotalCount] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const pageSize = 50;

  // Load albums for a given page
  const loadAlbumsPage = async (page: number, append = false) => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.getAlbums({
        page,
        page_size: pageSize,
      });

      const newAlbums = response.albums;

      if (append) {
        setAlbums((prev) => [...prev, ...newAlbums]);
      } else {
        setAlbums(newAlbums);
      }

      setTotalCount(response.pagination.total);
      setCurrentPage(page);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "failed to load albums";
      setError(errorMessage);
      console.error("error loading albums:", err);
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  createResource(() => loadAlbumsPage(1));

  // Load more albums (next page)
  const loadMore = async () => {
    const nextPage = currentPage() + 1;
    const maxPages = Math.ceil(totalCount() / pageSize);

    if (nextPage <= maxPages && !loading()) {
      await loadAlbumsPage(nextPage, true);
    }
  };

  // Refresh from beginning
  const refresh = async () => {
    await loadAlbumsPage(1);
  };

  return {
    albums,
    totalCount,
    loading,
    error,
    loadMore,
    refresh,
  };
}
