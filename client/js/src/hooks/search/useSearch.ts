import { createSignal, createMemo, createEffect } from "solid-js";
import type { ApiClient } from "../../lib/api-client.js";
import type {
  SearchResult,
  SongsSearchResult,
  MusicSearchOptions,
  SongsSearchOptions,
  SearchDomain,
} from "../../lib/search-types.js";

export interface UseSearchProps {
  apiClient: ApiClient;
  initialQuery?: string;
  initialDomain?: SearchDomain;
  debounceMs?: number;
  autoSearch?: boolean;
  onError?: (error: Error) => void;
}

export interface UseSearchReturn {
  // Query state
  query: () => string;
  setQuery: (query: string) => void;

  // Domain state
  domain: () => SearchDomain;
  setDomain: (domain: SearchDomain) => void;

  // Results state
  results: () => SearchResult | null;
  songsResults: () => SongsSearchResult | null;

  // Loading state
  loading: () => boolean;

  // Error state
  error: () => Error | null;
  clearError: () => void;

  // Search actions
  search: (options?: MusicSearchOptions) => Promise<void>;
  searchSongs: (options?: SongsSearchOptions) => Promise<void>;
  clearResults: () => void;

  // Computed state
  hasResults: () => boolean;
  resultsCount: () => number;
  isEmpty: () => boolean;
  canSearch: () => boolean;
}

/**
 * Debounce utility function
 */
function debounce<T extends (...args: any[]) => void>(
  func: T,
  delay: number
): T {
  let timeoutId: ReturnType<typeof setTimeout>;
  return ((...args: any[]) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  }) as T;
}

/**
 * Main search hook that provides comprehensive search functionality
 * with debounced queries and state management
 */
export function useSearch(props: UseSearchProps): UseSearchReturn {
  // Core state
  const [query, setQuery] = createSignal(props.initialQuery || "");
  const [domain, setDomain] = createSignal<SearchDomain>(
    props.initialDomain || "music"
  );
  const [results, setResults] = createSignal<SearchResult | null>(null);
  const [songsResults, setSongsResults] =
    createSignal<SongsSearchResult | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<Error | null>(null);

  // Computed state
  const hasResults = createMemo(() => {
    const musicResults = results();
    const songResults = songsResults();
    return (
      (musicResults?.results?.length || 0) > 0 ||
      (songResults?.songs?.length || 0) > 0
    );
  });

  const resultsCount = createMemo(() => {
    const musicResults = results();
    const songResults = songsResults();
    return (
      (musicResults?.results?.length || 0) + (songResults?.songs?.length || 0)
    );
  });

  const isEmpty = createMemo(() => {
    const q = query().trim();
    return q.length === 0;
  });

  const canSearch = createMemo(() => {
    const q = query().trim();
    return q.length > 0 && !loading();
  });

  // Clear error when query changes
  createEffect(() => {
    query(); // Track query changes
    if (error()) {
      setError(null);
    }
  });

  // Main search function
  const performSearch = async (options?: MusicSearchOptions) => {
    const q = query().trim();
    if (!q) {
      setResults(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await props.apiClient.searchMusic(q, options);
      setResults(result);
      setSongsResults(null); // Clear songs results when doing general search
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setResults(null);

      if (props.onError) {
        props.onError(error);
      }
    } finally {
      setLoading(false);
    }
  };

  // Songs-specific search function
  const performSongsSearch = async (options?: SongsSearchOptions) => {
    const q = query().trim();
    if (!q) {
      setSongsResults(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await props.apiClient.searchSongs(q, options);
      setSongsResults(result);
      setResults(null); // Clear general results when doing songs search
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setSongsResults(null);

      if (props.onError) {
        props.onError(error);
      }
    } finally {
      setLoading(false);
    }
  };

  // Debounced search functions
  const debouncedSearch = debounce(performSearch, props.debounceMs || 300);

  // Auto-search effect (if enabled)
  createEffect(() => {
    if (props.autoSearch !== false) {
      const q = query().trim();
      if (q.length > 0) {
        debouncedSearch();
      } else {
        setResults(null);
        setSongsResults(null);
      }
    }
  });

  // Clear error function
  const clearError = () => {
    setError(null);
  };

  // Clear results function
  const clearResults = () => {
    setResults(null);
    setSongsResults(null);
  };

  return {
    // State getters
    query,
    setQuery,
    domain,
    setDomain,
    results,
    songsResults,
    loading,
    error,
    clearError,

    // Actions
    search: performSearch,
    searchSongs: performSongsSearch,
    clearResults,

    // Computed state
    hasResults,
    resultsCount,
    isEmpty,
    canSearch,
  };
}

export default useSearch;
