import { createSignal, createResource } from "solid-js";
import type { ApiClient } from "../../../lib/api-client";
import type { ArtistSummary } from "../../../lib/music/schemas";

interface UseArtistsReturn {
  // Core data
  artists: () => ArtistSummary[];
  totalCount: () => number;

  // State
  loading: () => boolean;
  error: () => string | null;

  // Actions
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Simple artists data hook - replaces complex useInfiniteScroll pattern
 */
export function useArtists(apiClient: ApiClient): UseArtistsReturn {
  const [artists, setArtists] = createSignal<ArtistSummary[]>([]);
  const [currentPage, setCurrentPage] = createSignal(1);
  const [totalCount, setTotalCount] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const pageSize = 50;

  // Load artists for a given page
  const loadArtistsPage = async (page: number, append = false) => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.getArtists({
        page,
        page_size: pageSize,
      });

      const newArtists = response.artists;

      if (append) {
        setArtists((prev) => [...prev, ...newArtists]);
      } else {
        setArtists(newArtists);
      }

      setTotalCount(response.pagination.total);
      setCurrentPage(page);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "failed to load artists";
      setError(errorMessage);
      console.error("error loading artists:", err);
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  createResource(() => loadArtistsPage(1));

  // Load more artists (next page)
  const loadMore = async () => {
    if (loading()) return;

    const nextPage = currentPage() + 1;
    await loadArtistsPage(nextPage, true);
  };

  // Refresh from beginning
  const refresh = async () => {
    await loadArtistsPage(1);
  };

  return {
    artists,
    totalCount,
    loading,
    error,
    loadMore,
    refresh,
  };
}
