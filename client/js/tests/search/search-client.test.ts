import { describe, test, expect, beforeEach, vi } from "vitest";
import { ApiClient } from "../../src/lib/api-client.js";
import { createMusicSearchBuilder } from "../../src/lib/search-builder.js";
import type {
  SearchResult,
  SongsSearchResult,
  SuggestionsResult,
} from "../../src/lib/search-types.js";

// Mock fetch for testing
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("Search Client", () => {
  let apiClient: ApiClient;

  beforeEach(() => {
    apiClient = new ApiClient({
      baseUrl: "http://localhost:8080",
      credentials: "include",
    });
    mockFetch.mockClear();
  });

  describe("Music Search", () => {
    test("should search music with basic query", async () => {
      const mockResponse: SearchResult = {
        total_count: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
        query_time_ms: 10,
        results: [
          {
            id: "test-id",
            result_type: "song",
            title: "Test Song",
            subtitle: "Test Artist",
            description: "Test Album",
            thumbnail_blob_id: null,
            media_blob_id: "media-id",
            relevance_score: 0.95,
            metadata: {},
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
          },
        ],
        suggestions: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await apiClient.searchMusic("jazz piano");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8080/api/music/search?q=jazz+piano",
        expect.objectContaining({
          method: "GET",
          credentials: "include",
        })
      );

      expect(result).toEqual(mockResponse);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].title).toBe("Test Song");
    });

    test("should search music with filters", async () => {
      const mockResponse: SearchResult = {
        total_count: 0,
        page: 1,
        page_size: 20,
        total_pages: 0,
        query_time_ms: 5,
        results: [],
        suggestions: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await apiClient.searchMusic("blues", {
        artist: "B.B. King",
        rating_min: 4,
        favorites_only: true,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("artist=B.B.+King"),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("rating_min=4"),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("favorites_only=true"),
        expect.any(Object)
      );
    });

    test("should handle API errors gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "Server error",
      });

      await expect(apiClient.searchMusic("test query")).rejects.toThrow(
        "Music search failed"
      );
    });
  });

  describe("Songs Search", () => {
    test("should search songs only", async () => {
      const mockResponse: SongsSearchResult = {
        total_count: 1,
        page: 1,
        page_size: 20,
        query_time_ms: 8,
        songs: [
          {
            id: "song-id",
            media_blob_id: "media-id",
            thumbnail_blob_id: null,
            waveform_blob_id: null,
            title: "Jazz Song",
            artist: "Jazz Artist",
            album: "Jazz Album",
            album_artist: "Jazz Artist",
            track_number: 1,
            disc_number: 1,
            genre: "Jazz",
            year: 2020,
            bpm: 120,
            key_signature: "C major",
            rating: 5,
            is_favorite: true,
            tags: ["jazz", "piano"],
            search_rank: 0.98,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await apiClient.searchSongs("jazz");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8080/api/music/search/songs?q=jazz",
        expect.any(Object)
      );

      expect(result.songs).toHaveLength(1);
      expect(result.songs[0].title).toBe("Jazz Song");
    });
  });

  describe("Music Suggestions", () => {
    test("should get music suggestions", async () => {
      const mockResponse: SuggestionsResult = {
        suggestions: [
          {
            text: "piano",
            category: "word",
            frequency: 15,
          },
          {
            text: "jazz piano",
            category: "title",
            frequency: 5,
          },
        ],
        count: 2,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await apiClient.getMusicSuggestions("pian", { limit: 10 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/music/search/suggestions"),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("q=pian"),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("limit=10"),
        expect.any(Object)
      );

      expect(result.suggestions).toHaveLength(2);
      expect(result.count).toBe(2);
    });
  });

  describe("Search Builder", () => {
    test("should build complex music search query", async () => {
      const mockResponse: SearchResult = {
        total_count: 0,
        page: 1,
        page_size: 10,
        total_pages: 0,
        query_time_ms: 3,
        results: [],
        suggestions: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const searchBuilder = createMusicSearchBuilder(apiClient);

      await searchBuilder
        .query("jazz piano")
        .artist("Miles Davis")
        .rating(4)
        .pageSize(10)
        .sortByRating("desc")
        .execute();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("q=jazz+piano"),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("artist=Miles+Davis"),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("rating_min=4"),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("page_size=10"),
        expect.any(Object)
      );
    });

    test("should build structured search query", async () => {
      const mockResponse: SearchResult = {
        total_count: 0,
        page: 1,
        page_size: 20,
        total_pages: 0,
        query_time_ms: 2,
        results: [],
        suggestions: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const searchBuilder = createMusicSearchBuilder(apiClient);

      await searchBuilder.genreSearch("jazz").execute();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("q=genre%3Ajazz"),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("structured=true"),
        expect.any(Object)
      );
    });

    test("should execute songs search through builder", async () => {
      const mockResponse: SongsSearchResult = {
        total_count: 0,
        page: 1,
        page_size: 20,
        query_time_ms: 4,
        songs: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const searchBuilder = createMusicSearchBuilder(apiClient);

      const result = await searchBuilder
        .query("blues")
        .favoritesOnly()
        .executeSongs();

      expect(result.songs).toEqual([]);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/music/search/songs"),
        expect.any(Object)
      );
    });

    test("should get suggestions through builder", async () => {
      const mockResponse: SuggestionsResult = {
        suggestions: [],
        count: 0,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const searchBuilder = createMusicSearchBuilder(apiClient);

      const result = await searchBuilder.query("rock").getSuggestions(5);

      expect(result.count).toBe(0);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/music/search/suggestions"),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("limit=5"),
        expect.any(Object)
      );
    });

    test("should throw error when executing without query", async () => {
      const searchBuilder = createMusicSearchBuilder(apiClient);

      await expect(
        searchBuilder.artist("Test Artist").execute()
      ).rejects.toThrow("Query is required for search execution");
    });

    test("should clone builder with current state", () => {
      const searchBuilder = createMusicSearchBuilder(apiClient);

      const originalBuilder = searchBuilder
        .query("test")
        .artist("Test Artist")
        .rating(3);

      const clonedBuilder = originalBuilder.clone();

      expect(clonedBuilder.getQuery()).toBe("test");
      expect(clonedBuilder.getOptions()).toEqual(
        expect.objectContaining({
          artist: "Test Artist",
          rating_min: 3,
        })
      );

      // Modify clone should not affect original
      clonedBuilder.query("different query");
      expect(originalBuilder.getQuery()).toBe("test");
      expect(clonedBuilder.getQuery()).toBe("different query");
    });
  });
});
