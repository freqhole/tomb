import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { renderHook } from "@solidjs/testing-library";
import { useSearch } from "../../src/hooks/useSearch.js";
import { useSearchSuggestions } from "../../src/hooks/useSearchSuggestions.js";
import { useSearchState } from "../../src/hooks/useSearchState.js";
import { useSearchData } from "../../src/hooks/useSearchData.js";
import { useSearchAll } from "../../src/hooks/useSearchAll.js";
import type { ApiClient } from "../../src/lib/api-client.js";
import type {
  SearchResult,
  SongsSearchResult,
  SuggestionsResult,
} from "../../src/lib/search-types.js";

// Mock localStorage
const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

// Mock window and localStorage for Node.js environment
global.window = {
  localStorage: mockLocalStorage,
} as any;

global.localStorage = mockLocalStorage;

// Mock debounce function to make it synchronous in tests
vi.mock("../../src/hooks/useSearchSuggestions.js", async () => {
  const actual = await vi.importActual(
    "../../src/hooks/useSearchSuggestions.js"
  );
  return {
    ...actual,
    default: actual.useSearchSuggestions,
  };
});

// Create a synchronous debounce for tests
const mockDebounce = <T extends (...args: any[]) => void>(
  func: T,
  delay: number
): T => {
  return func; // Just return the function without delay in tests
};

// Mock API client
const createMockApiClient = (): ApiClient => {
  const mockSearchResult: SearchResult = {
    results: [
      {
        id: "1",
        result_type: "song",
        title: "Test Song",
        subtitle: "Test Artist",
        description: "Test Album",
        thumbnail_blob_id: null,
        media_blob_id: "blob_1",
        relevance_score: 0.95,
        metadata: {
          artist: "Test Artist",
          album: "Test Album",
          genre: "Rock",
          year: 2023,
        },
        created_at: "2023-01-01T00:00:00Z",
        updated_at: "2023-01-01T00:00:00Z",
      },
    ],
    suggestions: [],
    total_count: 1,
    page: 1,
    page_size: 20,
    total_pages: 1,
    query_time_ms: 25,
  };

  const mockSongsResult: SongsSearchResult = {
    songs: [
      {
        id: "2",
        media_blob_id: "blob_2",
        thumbnail_blob_id: null,
        waveform_blob_id: null,
        title: "Another Song",
        artist: "Another Artist",
        album: "Another Album",
        album_artist: "Another Artist",
        track_number: 1,
        disc_number: 1,
        genre: "Jazz",
        year: 2022,
        duration_ms: 240000,
        rating: 5,
        is_favorite: true,
        key_signature: null,
        tempo_bpm: null,
        created_at: "2023-01-02T00:00:00Z",
        updated_at: "2023-01-02T00:00:00Z",
      },
    ],
    total_count: 1,
    page: 1,
    page_size: 20,
    query_time_ms: 30,
  };

  const mockSuggestionsResult: SuggestionsResult = {
    suggestions: [
      { text: "test music", type: "query" },
      { text: "test artist", type: "artist" },
    ],
  };

  return {
    searchMusic: vi.fn().mockResolvedValue(mockSearchResult),
    searchSongs: vi.fn().mockResolvedValue(mockSongsResult),
    getMusicSuggestions: vi.fn().mockResolvedValue(mockSuggestionsResult),
  } as any;
};

describe("Search Hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage.getItem.mockReturnValue(null);
  });

  describe("useSearch", () => {
    it("should initialize with default values", () => {
      const { result } = renderHook(() => {
        const apiClient = createMockApiClient();
        return useSearch({ apiClient });
      });

      expect(result.query()).toBe("");
      expect(result.domain()).toBe("music");
      expect(result.results()).toBeNull();
      expect(result.loading()).toBe(false);
      expect(result.error()).toBeNull();
      expect(result.hasResults()).toBe(false);
      expect(result.canSearch()).toBe(false);
    });

    it("should initialize with provided values", () => {
      const { result } = renderHook(() => {
        const apiClient = createMockApiClient();
        return useSearch({
          apiClient,
          initialQuery: "test query",
          initialDomain: "music",
        });
      });

      expect(result.query()).toBe("test query");
      expect(result.domain()).toBe("music");
      expect(result.canSearch()).toBe(true);
    });

    it("should perform search and update results", async () => {
      const apiClient = createMockApiClient();
      const { result } = renderHook(() => {
        return useSearch({ apiClient, autoSearch: false });
      });

      result.setQuery("test");
      await result.search();

      expect(apiClient.searchMusic).toHaveBeenCalledWith("test", undefined);

      // Test the results directly since reactivity is tricky in tests
      const results = result.results();
      expect(results).not.toBeNull();
      expect(results!.results).toHaveLength(1);
      expect(results!.results[0].title).toBe("Test Song");
    });

    it("should handle search errors", async () => {
      const apiClient = createMockApiClient();
      const error = new Error("Search failed");
      apiClient.searchMusic = vi.fn().mockRejectedValue(error);

      const { result } = renderHook(() => {
        return useSearch({ apiClient, autoSearch: false });
      });

      result.setQuery("test");
      await result.search();

      expect(result.error()).toBe(error);
      expect(result.hasResults()).toBe(false);
    });

    it("should clear results", async () => {
      const apiClient = createMockApiClient();
      const { result } = renderHook(() => {
        return useSearch({ apiClient, autoSearch: false });
      });

      result.setQuery("test");
      await result.search();

      // Test the results directly
      expect(result.results()).not.toBeNull();
      expect(result.results()!.results).toHaveLength(1);

      result.clearResults();
      expect(result.results()).toBeNull();
      expect(result.songsResults()).toBeNull();
    });
  });

  describe("useSearchSuggestions", () => {
    it("should initialize with empty suggestions", () => {
      const { result } = renderHook(() => {
        const apiClient = createMockApiClient();
        const [query] = createSignal("");
        return useSearchSuggestions({ apiClient, query });
      });

      expect(result.suggestions()).toEqual([]);
      expect(result.loading()).toBe(false);
      expect(result.error()).toBeNull();
      expect(result.hasSuggestions()).toBe(false);
    });

    it("should not fetch suggestions for short queries", () => {
      const apiClient = createMockApiClient();
      const { result } = renderHook(() => {
        const [query, setQuery] = createSignal("a");
        return { hook: useSearchSuggestions({ apiClient, query }), setQuery };
      });

      result.setQuery("a");
      expect(apiClient.getMusicSuggestions).not.toHaveBeenCalled();
    });

    it("should fetch suggestions for valid queries", async () => {
      const apiClient = createMockApiClient();
      const { result } = renderHook(() => {
        const [query, setQuery] = createSignal("");
        return {
          hook: useSearchSuggestions({
            apiClient,
            query,
            debounceMs: 0, // No debounce in tests
          }),
          setQuery,
        };
      });

      result.setQuery("test");

      // Trigger the suggestions manually since effects don't fire in Node.js
      await result.hook.refresh();

      expect(apiClient.getMusicSuggestions).toHaveBeenCalledWith("test", {
        q: "test",
        limit: 10,
      });
    });

    it("should handle suggestions errors", async () => {
      const apiClient = createMockApiClient();
      const error = new Error("Suggestions failed");
      apiClient.getMusicSuggestions = vi.fn().mockRejectedValue(error);

      const { result } = renderHook(() => {
        const [query, setQuery] = createSignal("");
        return {
          hook: useSearchSuggestions({
            apiClient,
            query,
            debounceMs: 0, // No debounce in tests
          }),
          setQuery,
        };
      });

      result.setQuery("test");

      // Trigger the suggestions manually since effects don't fire in Node.js
      await result.hook.refresh();

      expect(result.hook.error()).toBe(error);
      expect(result.hook.hasSuggestions()).toBe(false);
    });
  });

  describe("useSearchState", () => {
    it("should initialize with default values", () => {
      const { result } = renderHook(() => useSearchState({}));

      expect(result.query()).toBe("");
      expect(result.domain()).toBe("music");
      expect(result.currentPage()).toBe(1);
      expect(result.pageSize()).toBe(20);
      expect(result.sortBy()).toBe("relevance");
      expect(result.sortDirection()).toBe("desc");
      expect(result.isSearchPanelOpen()).toBe(false);
      expect(result.isFiltersPanelOpen()).toBe(false);
    });

    it("should initialize with provided values", () => {
      const { result } = renderHook(() =>
        useSearchState({
          initialQuery: "test query",
          initialDomain: "music",
        })
      );

      expect(result.query()).toBe("test query");
      expect(result.domain()).toBe("music");
    });

    it("should update query and save to localStorage", () => {
      const { result } = renderHook(() => useSearchState({}));

      result.setQuery("new query");
      expect(result.query()).toBe("new query");
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        "search-state",
        expect.stringContaining("new query")
      );
    });

    it("should manage search history", () => {
      const { result } = renderHook(() =>
        useSearchState({ enableHistory: true })
      );

      result.addToHistory("query 1");
      result.addToHistory("query 2");

      expect(result.searchHistory()).toEqual(["query 2", "query 1"]);

      result.removeFromHistory("query 1");
      expect(result.searchHistory()).toEqual(["query 2"]);

      result.clearHistory();
      expect(result.searchHistory()).toEqual([]);
    });

    it("should handle filters", () => {
      const { result } = renderHook(() => useSearchState({}));

      result.updateFilter("artist", "Test Artist");
      expect(result.filters().artist).toBe("Test Artist");

      result.updateFilter("rating_min", 4);
      expect(result.filters().rating_min).toBe(4);

      result.clearFilters();
      expect(result.filters().artist).toBe("");
      expect(result.filters().rating_min).toBeNull();
    });

    it("should handle pagination", () => {
      const { result } = renderHook(() => useSearchState({}));

      result.nextPage();
      expect(result.currentPage()).toBe(2);

      result.nextPage();
      expect(result.currentPage()).toBe(3);

      result.prevPage();
      expect(result.currentPage()).toBe(2);

      result.prevPage();
      expect(result.currentPage()).toBe(1);

      result.prevPage(); // Should not go below 1
      expect(result.currentPage()).toBe(1);
    });

    it("should generate correct search options", () => {
      const { result } = renderHook(() => useSearchState({}));

      result.setQuery("test query");
      result.updateFilter("artist", "Test Artist");
      result.updateFilter("rating_min", 4);
      result.setCurrentPage(2);
      result.setPageSize(10);

      const options = result.getMusicSearchOptions();

      expect(options).toEqual({
        q: "test query",
        page: 2,
        page_size: 10,
        sort_by: "relevance",
        sort_direction: "desc",
        artist: "Test Artist",
        rating_min: 4,
      });
    });
  });

  describe("useSearchData", () => {
    it("should process search results", () => {
      createRoot(() => {
        const searchResults = () => ({
          results: [
            {
              id: "1",
              result_type: "song",
              title: "Test Song",
              subtitle: "Test Artist",
              description: "Test Album",
              thumbnail_blob_id: null,
              media_blob_id: "blob_1",
              relevance_score: 0.95,
              metadata: {},
              created_at: "2023-01-01T00:00:00Z",
              updated_at: "2023-01-01T00:00:00Z",
            },
          ],
          suggestions: [],
          total_count: 1,
          page: 1,
          page_size: 20,
          total_pages: 1,
          query_time_ms: 25,
        });

        const searchState = useSearchState({});
        const dataHook = useSearchData({
          searchResults,
          songsResults: () => null,
          searchState,
        });

        expect(dataHook.hasResults()).toBe(true);
        expect(dataHook.processedResults()).toHaveLength(1);
        expect(dataHook.isEmpty()).toBe(false);
      });
    });

    it("should filter results based on search state", () => {
      createRoot(() => {
        const searchResults = () => ({
          results: [],
          suggestions: [],
          total_count: 0,
          page: 1,
          page_size: 20,
          total_pages: 1,
          query_time_ms: 25,
        });

        const songsResults = () => ({
          songs: [
            {
              id: "1",
              media_blob_id: "blob_1",
              thumbnail_blob_id: null,
              waveform_blob_id: null,
              title: "Test Song",
              artist: "Test Artist",
              album: "Test Album",
              album_artist: "Test Artist",
              track_number: 1,
              disc_number: 1,
              genre: "Rock",
              year: 2023,
              duration_ms: 240000,
              rating: 4,
              is_favorite: false,
              key_signature: null,
              tempo_bpm: null,
              created_at: "2023-01-01T00:00:00Z",
              updated_at: "2023-01-01T00:00:00Z",
            },
            {
              id: "2",
              media_blob_id: "blob_2",
              thumbnail_blob_id: null,
              waveform_blob_id: null,
              title: "Another Song",
              artist: "Another Artist",
              album: "Another Album",
              album_artist: "Another Artist",
              track_number: 1,
              disc_number: 1,
              genre: "Jazz",
              year: 2022,
              duration_ms: 180000,
              rating: 5,
              is_favorite: true,
              key_signature: null,
              tempo_bpm: null,
              created_at: "2023-01-02T00:00:00Z",
              updated_at: "2023-01-02T00:00:00Z",
            },
          ],
          total_count: 2,
          page: 1,
          page_size: 20,
          query_time_ms: 30,
        });

        const searchState = useSearchState({});
        searchState.updateFilter("artist", "Test Artist");

        const dataHook = useSearchData({
          searchResults,
          songsResults,
          searchState,
        });

        expect(dataHook.filteredResults()).toHaveLength(1);
        expect(dataHook.filteredResults()[0]).toHaveProperty(
          "artist",
          "Test Artist"
        );
      });
    });

    it("should calculate correct statistics", () => {
      createRoot(() => {
        const searchResults = () => ({
          results: [
            {
              id: "1",
              result_type: "song",
              title: "Test Song",
              subtitle: "Test Artist",
              description: "Test Album",
              thumbnail_blob_id: null,
              media_blob_id: "blob_1",
              relevance_score: 0.95,
              metadata: {},
              created_at: "2023-01-01T00:00:00Z",
              updated_at: "2023-01-01T00:00:00Z",
            },
          ],
          suggestions: [],
          total_count: 100,
          page: 2,
          page_size: 20,
          total_pages: 5,
          query_time_ms: 25,
        });

        const songsResults = () => null;

        const searchState = useSearchState({});
        searchState.setCurrentPage(2);
        searchState.setPageSize(20);

        const dataHook = useSearchData({
          searchResults,
          songsResults,
          searchState,
        });

        const stats = dataHook.searchStats();
        expect(stats.totalResults).toBe(100);
        expect(stats.totalPages).toBe(5);
        expect(stats.currentPage).toBe(2);
        expect(stats.hasNextPage).toBe(true);
        expect(stats.hasPrevPage).toBe(true);
      });
    });

    it("should group results correctly", () => {
      createRoot(() => {
        const searchResults = () => ({
          results: [],
          suggestions: [],
          total_count: 0,
          page: 1,
          page_size: 20,
          total_pages: 0,
          query_time_ms: 25,
        });

        const songsResults = () => ({
          songs: [
            {
              id: "1",
              media_blob_id: "blob_1",
              thumbnail_blob_id: null,
              waveform_blob_id: null,
              title: "Song 1",
              artist: "Artist A",
              album: "Album A",
              album_artist: "Artist A",
              track_number: 1,
              disc_number: 1,
              genre: "Rock",
              year: 2023,
              duration_ms: 240000,
              rating: 4,
              is_favorite: false,
              key_signature: null,
              tempo_bpm: null,
              created_at: "2023-01-01T00:00:00Z",
              updated_at: "2023-01-01T00:00:00Z",
            },
            {
              id: "2",
              media_blob_id: "blob_2",
              thumbnail_blob_id: null,
              waveform_blob_id: null,
              title: "Song 2",
              artist: "Artist A",
              album: "Album B",
              album_artist: "Artist A",
              track_number: 1,
              disc_number: 1,
              genre: "Rock",
              year: 2023,
              duration_ms: 180000,
              rating: 5,
              is_favorite: true,
              key_signature: null,
              tempo_bpm: null,
              created_at: "2023-01-02T00:00:00Z",
              updated_at: "2023-01-02T00:00:00Z",
            },
          ],
          total_count: 2,
          page: 1,
          page_size: 20,
          query_time_ms: 30,
        });

        const searchState = useSearchState({});
        const dataHook = useSearchData({
          searchResults,
          songsResults,
          searchState,
        });

        const grouped = dataHook.groupedResults();
        expect(grouped.byArtist["Artist A"]).toHaveLength(2);
        expect(grouped.byGenre["Rock"]).toHaveLength(2);
        expect(grouped.byYear[2023]).toHaveLength(2);
        expect(grouped.byAlbum["Album A"]).toHaveLength(1);
        expect(grouped.byAlbum["Album B"]).toHaveLength(1);
      });
    });
  });

  describe("useSearchAll", () => {
    it("should combine all search functionality", () => {
      const { result } = renderHook(() => {
        const apiClient = createMockApiClient();
        return useSearchAll({
          apiClient,
          initialQuery: "test query",
          enableHistory: true,
          enableSuggestions: true,
        });
      });

      expect(result.state.query()).toBe("test query");
      expect(result.search.query()).toBe("test query");
      expect(result.canPerformSearch()).toBe(true);
      expect(result.isActive()).toBe(true);
    });

    it("should perform integrated search", async () => {
      const apiClient = createMockApiClient();
      const { result } = renderHook(() => {
        return useSearchAll({
          apiClient,
          initialQuery: "test query",
          enableHistory: true,
          autoSearch: false,
        });
      });

      await result.performSearch();

      expect(apiClient.searchMusic).toHaveBeenCalled();

      // Test results directly
      expect(result.search.results()).not.toBeNull();
      expect(result.search.results()!.results).toHaveLength(1);
      expect(result.state.searchHistory()).toContain("test query");
    });

    it("should clear all state", async () => {
      const apiClient = createMockApiClient();
      const { result } = renderHook(() => {
        return useSearchAll({
          apiClient,
          initialQuery: "test query",
          autoSearch: false,
        });
      });

      await result.performSearch();

      // Test results directly
      expect(result.search.results()).not.toBeNull();
      expect(result.search.results()!.results).toHaveLength(1);

      result.clearAll();
      expect(result.state.query()).toBe("");
      expect(result.search.results()).toBeNull();
      expect(result.search.songsResults()).toBeNull();
    });
  });
});
