import {
  createSignal,
  createMemo,
  createEffect,
  onMount,
  onCleanup,
} from "solid-js";
import { z } from "zod";
import type { SearchSuggestion } from "../../lib/search/types.js";

// Response schemas for validation
const UnifiedSearchResponseSchema = z.object({
  songs: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      artist: z.string().nullable(),
      album: z.string().nullable(),
      album_artist: z.string().nullable(),
      track_number: z.number().nullable(),
      disc_number: z.number().nullable(),
      duration_seconds: z.number().nullable(),
      genre: z.string().nullable(),
      year: z.number().nullable(),
      bpm: z.number().nullable(),
      key_signature: z.string().nullable(),
      rating: z.number().nullable(),
      is_favorite: z.boolean(),
      tags: z.array(z.string()),
      display_title: z.string(),
      detailed_display_title: z.string(),
      created_at: z.string(),
      updated_at: z.string().nullable(),
      media_blob_id: z.string(),
      thumbnail_blob_id: z.string().nullable(),
      waveform_blob_id: z.string().nullable(),
      thumbnail_blob_ids: z.array(z.string()),
    })
  ),
  total_count: z.number(),
  page: z.number(),
  page_size: z.number(),
  total_pages: z.number(),
  has_next: z.boolean(),
  has_prev: z.boolean(),
  offset: z.number(),
  query_time_ms: z.number(),
  search_query: z.string().nullable(),
  filters_applied: z.object({
    text_search: z.string().nullable(),
    artist_filters: z.array(z.string()),
    album_filters: z.array(z.string()),
    genre_filters: z.array(z.string()),
    year_range: z.tuple([z.number(), z.number()]).nullable(),
    rating_range: z.tuple([z.number(), z.number()]).nullable(),
    duration_range: z.tuple([z.number(), z.number()]).nullable(),
    boolean_filters: z.record(z.boolean()),
    tag_filters: z.object({
      required_tags: z.array(z.string()),
      optional_tags: z.array(z.string()),
      excluded_tags: z.array(z.string()),
    }),
    date_filters: z.object({
      created_after: z.string().nullable(),
      created_before: z.string().nullable(),
      updated_after: z.string().nullable(),
      updated_before: z.string().nullable(),
    }),
    file_filters: z.object({
      formats: z.array(z.string()),
      bitrate_range: z.tuple([z.number(), z.number()]).nullable(),
      size_range: z.tuple([z.number(), z.number()]).nullable(),
    }),
    total_filter_count: z.number(),
  }),
  sort_applied: z.object({
    primary_field: z.string(),
    primary_direction: z.string(),
    secondary_field: z.string().nullable(),
    secondary_direction: z.string().nullable(),
  }),
  suggestions: z.array(
    z.object({
      query: z.string(),
      highlight: z.string(),
      result_count: z.number(),
      suggestion_type: z.string(),
    })
  ),
  filter_suggestions: z.array(
    z.object({
      filter_type: z.string(),
      filter_value: z.string(),
      result_count: z.number(),
      confidence: z.number(),
    })
  ),
  related_searches: z.array(z.string()),
  aggregations: z.any().nullable(),
  debug: z.any().nullable(),
});

type UnifiedSearchResponse = z.infer<typeof UnifiedSearchResponseSchema>;
type Song = UnifiedSearchResponse["songs"][0];

export interface UnifiedSearchParams {
  // text search
  q?: string;
  search_type?: "websearch" | "plainto" | "phrase" | "fuzzy";
  search_fields?: string[];

  // pagination
  page?: number;
  page_size?: number;
  offset?: number;
  limit?: number;

  // sorting
  sort_by?: string;
  sort_direction?: "asc" | "desc";
  secondary_sort?: string;

  // basic filters
  artist?: string;
  artist_exact?: boolean;
  album?: string;
  album_exact?: boolean;
  genre?: string;
  title?: string;

  // numeric range filters
  year?: number;
  year_min?: number;
  year_max?: number;
  rating?: number;
  rating_min?: number;
  rating_max?: number;
  bpm?: number;
  bpm_min?: number;
  bpm_max?: number;
  duration_seconds?: number;
  duration_min?: number;
  duration_max?: number;
  track_number?: number;
  disc_number?: number;

  // boolean filters
  is_favorite?: boolean;
  has_thumbnail?: boolean;
  has_lyrics?: boolean;
  has_waveform?: boolean;
  is_compilation?: boolean;

  // array/multi-value filters
  tags?: string[];
  tags_any?: string[];
  tags_exclude?: string[];
  genres?: string[];
  artists?: string[];
  albums?: string[];

  // file/technical filters
  file_format?: string;
  file_formats?: string[];
  bitrate_min?: number;
  bitrate_max?: number;
  sample_rate_min?: number;
  sample_rate_max?: number;
  file_size_min?: number;
  file_size_max?: number;

  // date filters
  created_after?: string;
  created_before?: string;
  updated_after?: string;
  updated_before?: string;
  added_after?: string;
  added_before?: string;

  // advanced admin filters
  key_signature?: string;
  key_signatures?: string[];
  mood?: string;
  energy_level_min?: number;
  energy_level_max?: number;
  tempo_category?: string;

  // library management
  playlist_id?: string;
  not_in_playlist?: string;
  duplicate_check?: string;
  missing_metadata?: string[];
  has_errors?: boolean;
  needs_review?: boolean;

  // response options
  include_deleted?: boolean;
  include_hidden?: boolean;
  full_metadata?: boolean;
  include_file_info?: boolean;
  include_statistics?: boolean;
  include_related?: boolean;

  // performance options
  skip_total_count?: boolean;
  explain_query?: boolean;

  // null checking filters
  rating_is_null?: boolean;
  genre_is_null?: boolean;
  year_is_null?: boolean;
  bpm_is_null?: boolean;
  key_signature_is_null?: boolean;
  artist_is_null?: boolean;
  album_is_null?: boolean;
  album_artist_is_null?: boolean;

  // legacy compatibility
  favorites_only?: boolean;
  songs_only?: boolean;
}

export interface UnifiedSearchConfig {
  domain: string;
  searchEndpoint: string;
  filterOptionsEndpoint?: string;
  suggestionsEndpoint?: string;
  defaultParams?: UnifiedSearchParams;
  debounceMs?: number;
  defaultPageSize?: number;
  executeInitialSearch?: boolean;
  autoSearch?: boolean; // Whether to automatically search on parameter changes
  autoSuggestions?: boolean; // Whether to automatically fetch suggestions on query change
}

// Default configuration values
const DEFAULT_CONFIG = {
  debounceMs: 300,
  defaultPageSize: 20,
  executeInitialSearch: true,
  autoSearch: false,
  autoSuggestions: true,
  defaultParams: {} as UnifiedSearchParams,
};

export interface SearchMetadata {
  queryTimeMs: number;
  totalResults: number;
  searchQuery?: string;
  filtersApplied: number;
  sortApplied?: string;
  lastUpdated: Date;
}

export interface UnifiedSearchReturn {
  // core search state
  searchParams: () => UnifiedSearchParams;
  setSearchParams: (params: Partial<UnifiedSearchParams>) => void;
  updateParam: (key: keyof UnifiedSearchParams, value: any) => void;
  clearParams: () => void;

  // results
  results: () => Song[];
  totalCount: () => number;
  hasResults: () => boolean;
  isEmpty: () => boolean;

  // pagination
  currentPage: () => number;
  totalPages: () => number;
  pageSize: () => number;
  hasNext: () => boolean;
  hasPrev: () => boolean;
  nextPage: () => void;
  prevPage: () => void;
  goToPage: (page: number) => void;

  // loading states
  loading: () => boolean;
  loadingMore: () => boolean;
  searching: () => boolean;
  loadingSuggestions: () => boolean;
  suggestionsError: () => Error | null;
  error: () => string | null;

  // search actions
  search: (immediate?: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  clearSearch: () => void;

  // text search
  searchQuery: () => string;
  setSearchQuery: (query: string, triggerSearch?: boolean) => void;
  searchSuggestions: () => SearchSuggestion[];

  // search field
  searchField: () => string | null;
  setSearchField: (field: string, triggerSearch?: boolean) => void;
  searchFields: () => string[];
  setSearchFields: (fields: string[], triggerSearch?: boolean) => void;

  // filters
  activeFilters: () => Record<string, any>;
  hasActiveFilters: () => boolean;
  addFilter: (key: string, value: any, triggerSearch?: boolean) => void;
  removeFilter: (key: string, triggerSearch?: boolean) => void;
  clearFilters: (triggerSearch?: boolean) => void;

  // sorting
  sortBy: () => string | null;
  sortDirection: () => "asc" | "desc";
  setSorting: (
    field: string,
    direction?: "asc" | "desc",
    triggerSearch?: boolean
  ) => void;
  toggleSort: (field: string) => void;
  clearSort: (triggerSearch?: boolean) => void;

  // advanced features
  searchMetadata: () => SearchMetadata;

  // url synchronization
  syncWithUrl: () => void;
  getShareableUrl: () => string;
  loadFromUrl: () => void;
}

function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: number | undefined;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = window.setTimeout(() => func(...args), wait);
  };
}

function buildSearchUrl(endpoint: string, params: UnifiedSearchParams): string {
  const url = new URL(endpoint, window.location.origin);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      if (Array.isArray(value)) {
        value.forEach((v) => url.searchParams.append(key, String(v)));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  });

  return url.toString();
}

function shouldTriggerSearch(_params: UnifiedSearchParams): boolean {
  // trigger search if there's a query, any filters, or show all (no params)
  return true;
}

export function useUnifiedSearch(
  config: UnifiedSearchConfig
): UnifiedSearchReturn {
  // core state
  const [searchParams, setSearchParams] = createSignal<UnifiedSearchParams>(
    config.defaultParams ?? DEFAULT_CONFIG.defaultParams
  );
  const [results, setResults] = createSignal<Song[]>([]);
  const [totalCount, setTotalCount] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [searching, setSearching] = createSignal(false);
  const [suggestions, setSuggestions] = createSignal<SearchSuggestion[]>([]);
  // Expose loading states for UI components
  const [loadingSuggestions, setLoadingSuggestions] = createSignal(false);
  const [suggestionsError, setSuggestionsError] = createSignal<Error | null>(
    null
  );
  const [error, setError] = createSignal<string | null>(null);
  const [searchMetadata, setSearchMetadata] = createSignal<SearchMetadata>({
    queryTimeMs: 0,
    totalResults: 0,
    filtersApplied: 0,
    lastUpdated: new Date(),
  });

  // debounced search function
  const debouncedSearch = debounce(async () => {
    await performSearch();
  }, config.debounceMs ?? DEFAULT_CONFIG.debounceMs);

  // core search function
  const performSearch = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = searchParams();
      const url = buildSearchUrl(config.searchEndpoint, params);

      console.log("performing search with url:", url);

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`search failed: ${response.statusText}`);
      }

      const data = await response.json();
      const validated = UnifiedSearchResponseSchema.parse(data);

      setResults(validated.songs);
      setTotalCount(validated.total_count);

      // store metadata
      setSearchMetadata({
        queryTimeMs: validated.query_time_ms,
        totalResults: validated.total_count,
        searchQuery: validated.search_query || undefined,
        filtersApplied: validated.filters_applied.total_filter_count,
        sortApplied: validated.sort_applied.primary_field,
        lastUpdated: new Date(),
      });
    } catch (err) {
      console.error("search error:", err);
      setError(err instanceof Error ? err.message : "search failed");
      setResults([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
      setSearching(false);
    }
  };

  // Conditionally enable automatic reactive search triggering
  createEffect(() => {
    if (config.autoSearch ?? DEFAULT_CONFIG.autoSearch) {
      const params = searchParams();
      if (shouldTriggerSearch(params)) {
        debouncedSearch();
      }
    }
  });

  // update individual parameters
  const updateParam = (key: keyof UnifiedSearchParams, value: any) => {
    setSearchParams((prev) => ({ ...prev, [key]: value }));
  };

  // clear all parameters
  const clearParams = () => {
    setSearchParams({
      ...(config.defaultParams ?? DEFAULT_CONFIG.defaultParams),
    });
  };

  // text search management
  const searchQuery = createMemo(() => searchParams().q || "");

  const setSearchQuery = (query: string, triggerSearch: boolean = false) => {
    updateParam("q", query || undefined);

    // Fetch suggestions if autoSuggestions is enabled
    if (
      (config.autoSuggestions ?? DEFAULT_CONFIG.autoSuggestions) &&
      query.trim().length >= 2
    ) {
      fetchSuggestions(query);
    } else if (query.trim().length < 2) {
      setSuggestions([]);
    }

    // Only trigger search if explicitly requested
    if (triggerSearch) {
      debouncedSearch();
    }
    // Otherwise don't automatically trigger search or set searching state
  };

  // Debounced suggestion fetching
  let suggestionTimeout: number | undefined;
  const fetchSuggestions = (query: string) => {
    clearTimeout(suggestionTimeout);
    suggestionTimeout = window.setTimeout(() => {
      loadSuggestionsFromApi(query);
    }, config.debounceMs ?? DEFAULT_CONFIG.debounceMs);
  };

  // Fetch suggestions from API
  const loadSuggestionsFromApi = async (query: string) => {
    if (!query || query.length < 2 || !config.suggestionsEndpoint) {
      setSuggestions([]);
      return;
    }

    setLoadingSuggestions(true);
    setSuggestionsError(null);

    try {
      // Use the currently selected search field for suggestions
      const currentFields = searchParams().search_fields || ["all"];
      const suggestionsField =
        currentFields.length === 1 ? currentFields[0] : "all";
      const suggestionsUrl = `${config.suggestionsEndpoint}?field=${suggestionsField}&partial=${encodeURIComponent(query)}&page_size=15`;

      const response = await fetch(suggestionsUrl);
      if (!response.ok) {
        throw new Error(`suggestions api error: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.suggestions && Array.isArray(data.suggestions)) {
        const processedSuggestions = data.suggestions.map(
          (suggestion: any) => ({
            text: suggestion.value || suggestion.query || String(suggestion),
            category: suggestion.suggestion_type || "title",
            highlight: suggestion.highlight,
          })
        );

        setSuggestions(processedSuggestions);
      } else {
        setSuggestions([]);
      }
    } catch (error) {
      setSuggestionsError(
        error instanceof Error ? error : new Error(String(error))
      );
      setSuggestions([]);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  // pagination management
  const currentPage = createMemo(() => searchParams().page || 1);
  const totalPages = createMemo(() => {
    const total = totalCount();
    const pageSize =
      searchParams().page_size ||
      config.defaultPageSize ||
      DEFAULT_CONFIG.defaultPageSize;
    return total === 0 ? 0 : Math.ceil(total / pageSize);
  });
  const pageSize = createMemo(
    () =>
      searchParams().page_size ||
      config.defaultPageSize ||
      DEFAULT_CONFIG.defaultPageSize
  );
  const hasNext = createMemo(() => currentPage() < totalPages());
  const hasPrev = createMemo(() => currentPage() > 1);

  const nextPage = () => {
    if (hasNext()) {
      updateParam("page", currentPage() + 1);
    }
  };

  const prevPage = () => {
    if (hasPrev()) {
      updateParam("page", currentPage() - 1);
    }
  };

  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages()) {
      updateParam("page", page);
    }
  };

  // filter management
  const activeFilters = createMemo(() => {
    const params = searchParams();
    const filters: Record<string, any> = {};

    Object.entries(params).forEach(([key, value]) => {
      if (
        value !== undefined &&
        value !== null &&
        value !== "" &&
        key !== "page" &&
        key !== "page_size" &&
        key !== "sort_by" &&
        key !== "sort_direction" &&
        key !== "q"
      ) {
        filters[key] = value;
      }
    });

    return filters;
  });

  const hasActiveFilters = createMemo(() => {
    const filters = activeFilters();
    return Object.keys(filters).length > 0 || searchQuery().length > 0;
  });

  const addFilter = (
    key: string,
    value: any,
    triggerSearch: boolean = true
  ) => {
    updateParam(key as keyof UnifiedSearchParams, value);
    if (triggerSearch) {
      debouncedSearch();
    }
  };

  const removeFilter = (key: string, triggerSearch: boolean = true) => {
    updateParam(key as keyof UnifiedSearchParams, undefined);
    if (triggerSearch) {
      debouncedSearch();
    }
  };

  const clearFilters = (triggerSearch: boolean = true) => {
    const params = searchParams();
    const clearedParams: UnifiedSearchParams = {
      page: params.page || 1,
      page_size: params.page_size || DEFAULT_CONFIG.defaultPageSize,
      sort_by: params.sort_by,
      sort_direction: params.sort_direction,
    };
    setSearchParams(clearedParams);
    if (triggerSearch) {
      debouncedSearch();
    }
  };

  // sorting management
  const sortBy = createMemo(() => searchParams().sort_by || null);
  const sortDirection = createMemo(
    () => searchParams().sort_direction || "asc"
  );

  const setSorting = (
    field: string,
    direction: "asc" | "desc" = "asc",
    triggerSearch: boolean = true
  ) => {
    updateParam("sort_by", field);
    updateParam("sort_direction", direction);
    if (triggerSearch) {
      debouncedSearch();
    }
  };

  const toggleSort = (field: string) => {
    const currentSort = sortBy();
    const currentDirection = sortDirection();

    if (currentSort === field) {
      // toggle direction
      setSorting(field, currentDirection === "asc" ? "desc" : "asc");
    } else {
      // new field, default to asc
      setSorting(field, "asc");
    }
  };

  const clearSort = (triggerSearch: boolean = true) => {
    updateParam("sort_by", undefined);
    updateParam("sort_direction", undefined);
    if (triggerSearch) {
      debouncedSearch();
    }
  };

  // search field management
  const searchField = createMemo(() => {
    const fields = searchParams().search_fields;
    return fields && fields.length === 1 ? fields[0] : null;
  }) as () => string | null;

  const searchFields = createMemo(() => searchParams().search_fields || []);

  const setSearchField = (field: string, triggerSearch: boolean = true) => {
    updateParam("search_fields", [field]);
    if (triggerSearch) {
      debouncedSearch();
    }
  };

  const setSearchFields = (fields: string[], triggerSearch: boolean = true) => {
    updateParam("search_fields", fields);
    if (triggerSearch) {
      debouncedSearch();
    }
  };

  // search actions
  const search = async (immediate: boolean = false) => {
    if (immediate) {
      await performSearch();
    } else {
      debouncedSearch();
    }
  };

  const refresh = async () => {
    await performSearch();
  };

  const loadMore = async () => {
    if (hasNext() && !loadingMore()) {
      setLoadingMore(true);
      try {
        const currentResults = results();
        nextPage();

        // Perform search for next page
        const params = searchParams();
        const url = buildSearchUrl(config.searchEndpoint, params);

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`search failed: ${response.statusText}`);
        }

        const data = await response.json();
        const validated = UnifiedSearchResponseSchema.parse(data);

        // Append new results to existing ones
        setResults([...currentResults, ...validated.songs]);
        setTotalCount(validated.total_count);
      } catch (err) {
        console.error("load more error:", err);
        setError(err instanceof Error ? err.message : "load more failed");
      } finally {
        setLoadingMore(false);
      }
    }
  };

  const clearSearch = () => {
    updateParam("q", undefined);
  };

  // url synchronization helpers
  const syncWithUrl = () => {
    const url = new URL(window.location.href);
    const params = searchParams();

    // clear existing search params
    const keys = Array.from(url.searchParams.keys());
    keys.forEach((key) => {
      if (!["debug", "admin"].includes(key)) {
        url.searchParams.delete(key);
      }
    });

    // add current search params
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        if (Array.isArray(value)) {
          value.forEach((v) => url.searchParams.append(key, String(v)));
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    });

    window.history.replaceState({}, "", url.toString());
  };

  const getShareableUrl = () => {
    const url = new URL(window.location.href);
    syncWithUrl();
    return url.toString();
  };

  const loadFromUrl = () => {
    const url = new URL(window.location.href);
    const urlParams: Partial<UnifiedSearchParams> = {};

    url.searchParams.forEach((value, key) => {
      if (key === "page" || key === "page_size") {
        const parsed = parseInt(value);
        if (!isNaN(parsed)) {
          (urlParams as any)[key] = parsed;
        }
      } else if (
        [
          "tags",
          "tags_any",
          "tags_exclude",
          "genres",
          "artists",
          "albums",
        ].includes(key)
      ) {
        const existing =
          (urlParams[key as keyof UnifiedSearchParams] as string[]) || [];
        existing.push(value);
        (urlParams as any)[key] = existing;
      } else {
        (urlParams as any)[key] = value;
      }
    });

    setSearchParams((prev) => ({
      ...prev,
      ...(urlParams as UnifiedSearchParams),
    }));
  };

  // initialize from url on mount and perform initial search if configured
  onMount(() => {
    loadFromUrl();
    if (config.executeInitialSearch ?? DEFAULT_CONFIG.executeInitialSearch) {
      performSearch();
    }
    // Fetch initial suggestions if there's a query
    const query = searchQuery();
    if (query && query.length >= 2) {
      fetchSuggestions(query);
    }
  });

  // cleanup
  onCleanup(() => {
    // cleanup any pending debounced calls
    if (suggestionTimeout) {
      clearTimeout(suggestionTimeout);
    }
  });

  return {
    // core search state
    searchParams,
    setSearchParams,
    updateParam,
    clearParams,

    // results
    results,
    totalCount,
    hasResults: () => results().length > 0,
    isEmpty: () => results().length === 0,

    // pagination
    currentPage,
    pageSize: () => pageSize() || DEFAULT_CONFIG.defaultPageSize,
    totalPages,
    hasNext,
    hasPrev,
    nextPage,
    prevPage,
    goToPage,

    // loading states
    loading,
    loadingMore,
    searching,
    loadingSuggestions,
    suggestionsError,
    error,

    // search actions
    search,
    refresh,
    loadMore,
    clearSearch,

    // text search
    searchQuery,
    setSearchQuery: (query: string, triggerSearch: boolean = false) => {
      setSearchQuery(query);
      if (triggerSearch || (config.autoSearch ?? DEFAULT_CONFIG.autoSearch)) {
        debouncedSearch();
      }
    },
    searchSuggestions: () => suggestions(),

    // filters
    activeFilters,
    hasActiveFilters,
    addFilter,
    removeFilter,
    clearFilters,

    // sorting
    sortBy,
    sortDirection,
    setSorting,
    toggleSort,
    clearSort,

    // search field
    searchField,
    setSearchField,
    searchFields,
    setSearchFields,

    // advanced features
    searchMetadata,

    // url synchronization
    syncWithUrl,
    getShareableUrl,
    loadFromUrl,
  };
}
