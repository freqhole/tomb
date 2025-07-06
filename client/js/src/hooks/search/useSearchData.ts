import { createMemo } from "solid-js";
import type { SearchStateHook } from "./useSearchState.js";
import type {
  SearchResult,
  SongsSearchResult,
  SearchResultItem,
  SongSearchResult,
} from "../../lib/search/types.js";
import type { MediaBlob } from "../../lib/websocket-types.js";

// Union type for all search result items
type SearchItem = SearchResultItem | SongSearchResult;

export interface UseSearchDataProps {
  searchResults: () => SearchResult | null;
  songsResults: () => SongsSearchResult | null;
  searchState: SearchStateHook;
  integrationMode?: "standalone" | "freqhole-integrated";
  webSocketItems?: () => MediaBlob[];
}

export interface SearchDataReturn {
  // Processed search results
  processedResults: () => SearchItem[];

  // Integrated results (when in freqhole mode)
  integratedResults: () => (SearchItem | MediaBlob)[];

  // Statistics
  searchStats: () => {
    totalResults: number;
    totalPages: number;
    currentPage: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
    resultsPerPage: number;
  };

  // Grouping and organization
  groupedResults: () => {
    byArtist: Record<string, SearchItem[]>;
    byAlbum: Record<string, SearchItem[]>;
    byGenre: Record<string, SearchItem[]>;
    byYear: Record<number, SearchItem[]>;
  };

  // Filtering helpers
  filteredResults: () => SearchItem[];

  // Sorting helpers
  sortedResults: () => SearchItem[];

  // Integration helpers
  mergedWithWebSocket: () => (SearchItem | MediaBlob)[];

  // Utility functions
  isEmpty: () => boolean;
  hasResults: () => boolean;
  getResultById: (id: string) => SearchItem | undefined;
  getResultsByType: (type: string) => SearchItem[];
}

/**
 * Search data processing hook that follows the useFreqholeData pattern
 *
 * This hook processes search results with filtering, sorting, and integration
 * capabilities similar to how useFreqholeData processes WebSocket feed data.
 */
export function useSearchData(props: UseSearchDataProps): SearchDataReturn {
  // Get all search results in a unified format
  const allResults = createMemo(() => {
    const searchResults = props.searchResults();
    const songsResults = props.songsResults();

    const items: SearchItem[] = [];

    if (searchResults?.results) {
      items.push(...searchResults.results);
    }

    if (songsResults?.songs) {
      items.push(...songsResults.songs);
    }

    return items;
  });

  // Apply filters from search state
  const filteredResults = createMemo(() => {
    const results = allResults();
    const filters = props.searchState.filters();

    return results.filter((item) => {
      // Helper to check if item is a song result (has music fields)
      const isSong = "artist" in item;

      // Artist filter - only apply to song results
      if (filters.artist && isSong && item.artist) {
        const artistMatch = item.artist
          .toLowerCase()
          .includes(filters.artist.toLowerCase());
        if (!artistMatch) return false;
      }

      // Album filter - only apply to song results
      if (filters.album && isSong && item.album) {
        const albumMatch = item.album
          .toLowerCase()
          .includes(filters.album.toLowerCase());
        if (!albumMatch) return false;
      }

      // Genre filter - only apply to song results
      if (filters.genre && isSong && item.genre) {
        const genreMatch = item.genre
          .toLowerCase()
          .includes(filters.genre.toLowerCase());
        if (!genreMatch) return false;
      }

      // Year filter - only apply to song results
      if (filters.year && isSong && item.year) {
        if (item.year !== filters.year) return false;
      }

      // Rating filters - only apply to song results
      if (filters.rating_min && isSong && item.rating) {
        if (item.rating < filters.rating_min) return false;
      }

      if (filters.rating_max && isSong && item.rating) {
        if (item.rating > filters.rating_max) return false;
      }

      // Favorites filter - only apply to song results
      if (filters.favorites_only && isSong && !item.is_favorite) {
        return false;
      }

      return true;
    });
  });

  // Apply sorting from search state
  const sortedResults = createMemo(() => {
    const results = filteredResults();
    const sortBy = props.searchState.sortBy();
    const sortDirection = props.searchState.sortDirection();

    const sorted = [...results].sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortBy) {
        case "title":
          aValue = a.title?.toLowerCase() || "";
          bValue = b.title?.toLowerCase() || "";
          break;
        case "artist":
          aValue = ("artist" in a ? a.artist?.toLowerCase() : "") || "";
          bValue = ("artist" in b ? b.artist?.toLowerCase() : "") || "";
          break;
        case "album":
          aValue = ("album" in a ? a.album?.toLowerCase() : "") || "";
          bValue = ("album" in b ? b.album?.toLowerCase() : "") || "";
          break;
        case "created_at":
          aValue = a.created_at ? new Date(a.created_at).getTime() : 0;
          bValue = b.created_at ? new Date(b.created_at).getTime() : 0;
          break;
        case "rating":
          aValue = ("rating" in a ? a.rating : 0) || 0;
          bValue = ("rating" in b ? b.rating : 0) || 0;
          break;
        case "relevance":
        default:
          // For relevance, maintain original order (already sorted by relevance from API)
          return 0;
      }

      if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
      if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return sorted;
  });

  // Final processed results
  const processedResults = createMemo(() => {
    return sortedResults();
  });

  // Group results by various criteria
  const groupedResults = createMemo(() => {
    const results = processedResults();

    const byArtist: Record<string, SearchItem[]> = {};
    const byAlbum: Record<string, SearchItem[]> = {};
    const byGenre: Record<string, SearchItem[]> = {};
    const byYear: Record<number, SearchItem[]> = {};

    results.forEach((item) => {
      const isSong = "artist" in item;

      // Group by artist - only for song results
      if (isSong && item.artist) {
        if (!byArtist[item.artist]) byArtist[item.artist] = [];
        byArtist[item.artist]!.push(item);
      }

      // Group by album - only for song results
      if (isSong && item.album) {
        if (!byAlbum[item.album]) byAlbum[item.album] = [];
        byAlbum[item.album]!.push(item);
      }

      // Group by genre - only for song results
      if (isSong && item.genre) {
        if (!byGenre[item.genre]) byGenre[item.genre] = [];
        byGenre[item.genre]!.push(item);
      }

      // Group by year - only for song results
      if (isSong && item.year) {
        if (!byYear[item.year]) byYear[item.year] = [];
        byYear[item.year]!.push(item);
      }
    });

    return { byArtist, byAlbum, byGenre, byYear };
  });

  // Calculate statistics
  const searchStats = createMemo(() => {
    const searchResults = props.searchResults();
    const songsResults = props.songsResults();
    const currentPage = props.searchState.currentPage();
    const pageSize = props.searchState.pageSize();

    // Get total from the most recent search result
    const totalResults =
      searchResults?.total_count || songsResults?.total_count || 0;
    const totalPages = Math.ceil(totalResults / pageSize);

    return {
      totalResults,
      totalPages,
      currentPage,
      hasNextPage: currentPage < totalPages,
      hasPrevPage: currentPage > 1,
      resultsPerPage: pageSize,
    };
  });

  // Integrate with WebSocket feed (for freqhole mode)
  const integratedResults = createMemo(() => {
    if (
      props.integrationMode !== "freqhole-integrated" ||
      !props.webSocketItems
    ) {
      return processedResults();
    }

    const searchResults = processedResults();
    const wsItems = props.webSocketItems();

    // Merge search results with WebSocket items
    // Remove duplicates based on ID if they exist in both
    const searchIds = new Set(searchResults.map((item) => item.id));
    const uniqueWsItems = wsItems.filter((item) => !searchIds.has(item.id));

    return [...searchResults, ...uniqueWsItems];
  });

  // Merge with WebSocket data
  const mergedWithWebSocket = createMemo(() => {
    return integratedResults();
  });

  // Utility functions
  const isEmpty = createMemo(() => {
    return processedResults().length === 0;
  });

  const hasResults = createMemo(() => {
    return processedResults().length > 0;
  });

  const getResultById = (id: string): SearchItem | undefined => {
    return processedResults().find((item) => item.id === id);
  };

  const getResultsByType = (type: string): SearchItem[] => {
    return processedResults().filter((item) =>
      "result_type" in item ? item.result_type === type : false
    );
  };

  return {
    // Processed results
    processedResults,

    // Integrated results
    integratedResults,

    // Statistics
    searchStats,

    // Grouping
    groupedResults,

    // Filtering and sorting
    filteredResults,
    sortedResults,

    // Integration
    mergedWithWebSocket,

    // Utilities
    isEmpty,
    hasResults,
    getResultById,
    getResultsByType,
  };
}

export default useSearchData;
