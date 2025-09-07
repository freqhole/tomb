import { createSignal, createMemo, onMount } from "solid-js";
import type { ApiClient } from "../../../lib/api-client.js";
import type { Song } from "../../../lib/music/schemas/song.js";
import { useStandardDelayedLoading } from "../../../hooks/useDelayedLoading.js";

export interface FreqholeSearchFilters {
  artist?: string;
  album?: string;
  genre?: string;
  year_min?: number;
  year_max?: number;
  rating_min?: number;
  rating_max?: number;
  is_favorite?: boolean;
  has_thumbnail?: boolean;
  file_formats?: string[];
  [key: string]: any;
}

export interface FreqholeSearchState {
  query: string;
  filters: FreqholeSearchFilters;
  searchField: string | null;
  activeTab: "all" | "songs" | "artists" | "albums" | "playlists";
}

export interface FreqholeSearchReturn {
  // Core state
  searchQuery: () => string;
  setSearchQuery: (query: string, executeSearch?: boolean) => void;
  filters: () => FreqholeSearchFilters;
  updateFilters: (updates: Partial<FreqholeSearchFilters>) => void;
  clearFilters: () => void;
  searchField: () => string | null;
  setSearchField: (field: string) => void;
  activeTab: () => "all" | "songs" | "artists" | "albums" | "playlists";
  setActiveTab: (
    tab: "all" | "songs" | "artists" | "albums" | "playlists"
  ) => void;

  // Results - simplified to work with current API
  songs: () => Song[];
  artists: () => Array<{ name: string; song_count: number; avgRank: number }>;
  albums: () => Array<{
    album: string;
    artist: string;
    track_count: number;
    year?: number;
    avgRank: number;
  }>;
  // playlists: () => Array<{
  //   id: string;
  //   title: string;
  //   song_count: number;
  //   description?: string;
  // }>; // Commented out until server API supports it

  // Loading and error states
  loading: () => boolean;
  error: () => string | null;
  searching: () => boolean;

  // Suggestions
  suggestions: () => Array<{
    text: string;
    category: string;
    highlight?: string;
  }>;
  onSuggestionSelect: (suggestion: string) => void;

  // Pagination
  pagination: () => {
    page: number;
    pageSize: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  loadMore: () => Promise<void>;

  // Actions
  refresh: () => Promise<void>;
  clear: () => void;
  hasResults: () => boolean;
  totalCount: () => number;
}

/**
 * Freqhole search hook with unified search backend integration
 * Currently supports songs search with derived artists/albums from song results
 */
export function useFreqholeSearch(apiClient: ApiClient): FreqholeSearchReturn {
  // === CORE STATE ===
  const [searchQuery, setSearchQuerySignal] = createSignal("");
  const [filters, setFiltersSignal] = createSignal<FreqholeSearchFilters>({});
  const [searchField, setSearchFieldSignal] = createSignal<string | null>(
    "all"
  );
  const [activeTab, setActiveTabSignal] = createSignal<
    "all" | "songs" | "artists" | "albums" | "playlists"
  >("all");

  // === RESULTS STATE ===
  const [songsData, setSongsData] = createSignal<Song[]>([]);
  const [totalCount, setTotalCount] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // === SUGGESTIONS STATE ===
  const [suggestions, setSuggestions] = createSignal<
    Array<{
      text: string;
      category: string;
      highlight?: string;
    }>
  >([]);

  // === PAGINATION STATE ===
  const [currentPage, setCurrentPage] = createSignal(1);
  const [pageSize] = createSignal(50);
  const [hasNext, setHasNext] = createSignal(false);
  const [hasPrev, setHasPrev] = createSignal(false);

  // === DELAYED LOADING STATE ===
  const delayedLoading = useStandardDelayedLoading();

  // === DEBOUNCING STATE ===
  let suggestionTimeout: ReturnType<typeof setTimeout> | undefined;

  // === COMPUTED VALUES ===
  const songs = createMemo(() => songsData());

  // Extract unique artists from songs
  const artists = createMemo(() => {
    const artistMap = new Map<string, { count: number; avgRank: number }>();
    songsData().forEach((song) => {
      if (song.artist) {
        const existing = artistMap.get(song.artist);
        const songRank = (song as any).search_rank || 0;

        if (existing) {
          existing.count += 1;
          existing.avgRank = (existing.avgRank + songRank) / 2;
        } else {
          artistMap.set(song.artist, { count: 1, avgRank: songRank });
        }
      }
    });

    return Array.from(artistMap.entries())
      .map(([name, data]) => ({
        name,
        song_count: data.count,
        avgRank: data.avgRank,
      }))
      .sort((a, b) => b.avgRank - a.avgRank); // Sort by search ranking (higher first)
  });

  // Extract unique albums from songs
  const albums = createMemo(() => {
    const albumMap = new Map<
      string,
      { artist: string; tracks: Set<string>; year?: number; avgRank: number }
    >();

    songsData().forEach((song) => {
      if (song.album && song.artist) {
        const key = `${song.album}|${song.artist}`;
        const existing = albumMap.get(key);
        const songRank = (song as any).search_rank || 0;

        if (existing) {
          existing.tracks.add(song.id);
          existing.avgRank = (existing.avgRank + songRank) / 2;
          if (song.year && !existing.year) {
            existing.year = song.year;
          }
        } else {
          albumMap.set(key, {
            artist: song.artist,
            tracks: new Set([song.id]),
            year: song.year || undefined,
            avgRank: songRank,
          });
        }
      }
    });

    return Array.from(albumMap.entries())
      .map(([key, data]) => {
        const [album] = key.split("|");
        return {
          album: album || "",
          artist: data.artist,
          track_count: data.tracks.size,
          year: data.year,
          avgRank: data.avgRank,
        };
      })
      .filter((album) => album.album) // Filter out albums with empty names
      .sort((a, b) => b.avgRank - a.avgRank); // Sort by search ranking (higher first)
  });

  // Playlists are not available from the music search API - commented out
  // const playlists = createMemo(() => []);

  const pagination = createMemo(() => ({
    page: currentPage(),
    pageSize: pageSize(),
    totalPages: Math.ceil(totalCount() / pageSize()),
    hasNext: hasNext(),
    hasPrev: hasPrev(),
  }));

  const hasResults = createMemo(() => {
    return songsData().length > 0;
  });

  // === CORE FUNCTIONS ===

  /**
   * Build search parameters for API call
   */
  const buildSearchParams = (page = currentPage()) => {
    const params: any = {
      ...filters(),
      page,
      page_size: pageSize(),
    };

    if (searchQuery()) {
      params.q = searchQuery();

      // Add search fields if specific field is selected
      const currentField = searchField();
      if (currentField && currentField !== "all") {
        params.search_fields = [currentField];
      }
    }

    return params;
  };

  /**
   * Convert search result to Song format
   */
  const convertSearchResultToSong = (searchResult: any): Song => {
    return {
      id: searchResult.id,
      title: searchResult.title,
      artist: searchResult.artist || null,
      album: searchResult.album || null,
      album_artist: searchResult.album_artist || searchResult.artist || null,
      track_number: searchResult.track_number || null,
      disc_number: searchResult.disc_number || null,
      duration_seconds: searchResult.duration_seconds || null,
      genre: searchResult.genre || null,
      year: searchResult.year || null,
      bpm: searchResult.bpm || null,
      key_signature: searchResult.key_signature || null,
      user_rating: searchResult.rating || searchResult.user_rating || null,
      user_is_favorite:
        searchResult.is_favorite || searchResult.user_is_favorite || false,
      tags: searchResult.tags || [],
      display_title: searchResult.title,
      detailed_display_title: searchResult.title,
      created_at: searchResult.created_at,
      media_blob_id: searchResult.media_blob_id,
      thumbnail_blob_id: searchResult.thumbnail_blob_id || null,
      waveform_blob_id: searchResult.waveform_blob_id || null,
      thumbnail_blob_ids: searchResult.thumbnail_blob_ids || [],
      preference_updated_at: searchResult.preference_updated_at || null,
    };
  };

  /**
   * Perform search API call
   */
  const performSearch = async (pageToLoad = 1, append = false) => {
    const query = searchQuery();

    if (!query.trim()) {
      clear();
      return;
    }

    try {
      setLoading(true);
      delayedLoading.startLoading();
      setError(null);

      const params = buildSearchParams(pageToLoad);

      // Use the same endpoint as the admin version
      const response = await apiClient.makeRequest<any>(
        "GET",
        "/api/music/search",
        { params }
      );

      let newSongs: Song[] = [];
      let serverTotal = 0;

      if (response?.songs) {
        // Convert search results to Song format
        newSongs = response.songs.map((song: any) =>
          convertSearchResultToSong(song)
        );
        serverTotal = response.total_count || response.total || 0;
      } else if (Array.isArray(response)) {
        newSongs = response.map((song: any) => convertSearchResultToSong(song));
        serverTotal = response.length;
      }

      setTotalCount(serverTotal);

      if (append && pageToLoad > 1) {
        // Append for infinite scroll
        const existing = songsData();
        setSongsData([...existing, ...newSongs]);
      } else {
        // Replace for new search
        setSongsData(newSongs);
      }

      setCurrentPage(pageToLoad);

      // Update pagination state
      setHasNext(pageToLoad * pageSize() < serverTotal);
      setHasPrev(pageToLoad > 1);
    } catch (err) {
      console.error("freqhole search: API error", err);
      setError(err instanceof Error ? err.message : "search failed");
      if (!append) {
        setSongsData([]);
        setTotalCount(0);
      }
    } finally {
      setLoading(false);
      delayedLoading.stopLoading();
    }
  };

  /**
   * Load suggestions from API with debouncing
   */
  const loadSuggestions = async (query: string) => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }

    // Clear previous timeout
    if (suggestionTimeout) {
      clearTimeout(suggestionTimeout);
    }

    // Use shorter debounce for better responsiveness
    suggestionTimeout = setTimeout(async () => {
      try {
        const response = await apiClient.makeRequest<any>(
          "GET",
          "/api/music/suggestions",
          {
            params: {
              field: searchField() || "all",
              partial: query,
              page_size: 20,
            },
          }
        );

        if (response?.suggestions && Array.isArray(response.suggestions)) {
          const processedSuggestions = response.suggestions.map(
            (suggestion: any) => ({
              text: suggestion.value || suggestion.query || String(suggestion),
              category: suggestion.suggestion_type || "suggestion",
              highlight: suggestion.highlight,
            })
          );

          setSuggestions(processedSuggestions);
        } else {
          setSuggestions([]);
        }
      } catch (err) {
        console.warn("freqhole search: failed to load suggestions:", err);
        setSuggestions([]);
      }
    }, 150); // Reduced to 150ms for better responsiveness
  };

  // === PUBLIC API ===

  const setSearchQuery = (query: string, executeSearch: boolean = false) => {
    setSearchQuerySignal(query);
    setCurrentPage(1);

    // Always load suggestions when query changes (debounced to prevent input interference)
    if (query.length >= 2) {
      loadSuggestions(query);
    } else {
      setSuggestions([]);
    }

    // Only perform search if explicitly requested
    if (executeSearch && query.trim()) {
      performSearch(1, false);
    } else if (!query.trim()) {
      // Clear results when query is empty
      clear();
    }
  };

  const updateFilters = (updates: Partial<FreqholeSearchFilters>) => {
    setFiltersSignal((prev) => ({ ...prev, ...updates }));
    setCurrentPage(1);
    if (searchQuery().trim()) {
      performSearch(1, false);
    }
  };

  const clearFilters = () => {
    setFiltersSignal({});
    setCurrentPage(1);
    if (searchQuery().trim()) {
      performSearch(1, false);
    }
  };

  const setSearchField = (field: string) => {
    setSearchFieldSignal(field);
    // Reload suggestions if there's a current query
    const query = searchQuery();
    if (query.length >= 2) {
      loadSuggestions(query);
    }
  };

  const setActiveTab = (
    tab: "all" | "songs" | "artists" | "albums" | "playlists"
  ) => {
    setActiveTabSignal(tab);
    // No need to re-execute search since we're just filtering the same results
  };

  const onSuggestionSelect = (suggestion: string) => {
    setSearchQuery(suggestion, true); // Execute search when selecting a suggestion
  };

  const loadMore = async () => {
    const pag = pagination();
    if (!pag.hasNext || loading()) {
      return;
    }

    const nextPage = currentPage() + 1;
    await performSearch(nextPage, true); // Append results
  };

  const refresh = async () => {
    setCurrentPage(1);
    if (searchQuery().trim()) {
      await performSearch(1, false);
    }
  };

  const clear = () => {
    setSongsData([]);
    setTotalCount(0);
    setError(null);
    setSuggestions([]);
    setCurrentPage(1);
    setHasNext(false);
    setHasPrev(false);
  };

  // === INITIALIZATION ===
  onMount(() => {
    // No initial search - wait for user input
  });

  // === RETURN API ===
  return {
    // Core state
    searchQuery,
    setSearchQuery,
    filters,
    updateFilters,
    clearFilters,
    searchField,
    setSearchField,
    activeTab,
    setActiveTab,

    // Results
    songs,
    artists,
    albums,
    // playlists, // Commented out until server API supports it

    // Loading and error states
    loading: delayedLoading.showLoading,
    error,
    searching: delayedLoading.showLoading,

    // Suggestions
    suggestions,
    onSuggestionSelect,

    // Pagination
    pagination,
    loadMore,

    // Actions
    refresh,
    clear,
    hasResults,
    totalCount: () => totalCount(),
  };
}
