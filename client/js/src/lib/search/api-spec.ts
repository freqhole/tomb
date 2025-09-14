import { z } from "zod";

// Search domains for multi-domain support
export const SearchDomainSchema = z.enum([
  "music",
  "photos",
  "videos",
  "documents",
]);
export type SearchDomain = z.infer<typeof SearchDomainSchema>;

// Search type enumeration
export const SearchTypeSchema = z.enum(["websearch", "plainto", "phrase"]);
export type SearchType = z.infer<typeof SearchTypeSchema>;

// Sort fields and directions
export const SortBySchema = z.enum([
  "relevance",
  "title",
  "artist",
  "album",
  "created_at",
  "rating",
]);
export const SortDirectionSchema = z.enum(["asc", "desc"]);

// Base search options schema
export const SearchOptionsSchema = z.object({
  q: z.string().min(1, "Query is required"),
  structured: z.boolean().optional(),
  search_type: SearchTypeSchema.optional(),
  page: z.number().min(1).optional(),
  page_size: z.number().min(1).max(100).optional(),
  sort_by: SortBySchema.optional(),
  sort_direction: SortDirectionSchema.optional(),
});

// Music-specific search options
export const MusicSearchOptionsSchema = SearchOptionsSchema.extend({
  artist: z.string().optional(),
  album: z.string().optional(),
  genre: z.string().optional(),
  year: z.number().optional(),
  rating_min: z.number().min(1).max(5).optional(),
  rating_max: z.number().min(1).max(5).optional(),
  favorites_only: z.boolean().optional(),
});

// Songs-only search options
export const SongsSearchOptionsSchema = MusicSearchOptionsSchema;

// Suggestions options
export const SuggestionsOptionsSchema = z.object({
  q: z.string().min(1, "Query is required"),
  limit: z.number().min(1).max(50).optional(),
});

// Individual search result item schema
export const SearchResultItemSchema = z.object({
  id: z.string(),
  result_type: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  thumbnail_blob_id: z.string().optional(),
  media_blob_id: z.string().optional(),
  relevance_score: z.number(),
  metadata: z.record(z.any()),
  created_at: z.string(),
  updated_at: z.string(),
});

// Search suggestion schema - matches server Suggestion struct
export const SearchSuggestionSchema = z.object({
  value: z.string(),
  display: z.string(),
  highlight: z.string(),
  count: z.number(),
  suggestion_type: z.string(),
  confidence: z.number(),
});

// Song search result schema (for songs-only endpoint)
export const SongSearchResultSchema = z.object({
  id: z.string(),
  media_blob_id: z.string(),
  thumbnail_blob_id: z.string().optional(),
  waveform_blob_id: z.string().optional(),
  title: z.string(),
  artist: z.string().optional(),
  album: z.string().optional(),
  album_artist: z.string().optional(),
  track_number: z.number().optional(),
  disc_number: z.number().optional(),
  genre: z.string().optional(),
  year: z.number().optional(),
  bpm: z.number().optional(),
  key_signature: z.string().optional(),
  rating: z.number().optional(),
  is_favorite: z.boolean(),
  tags: z.array(z.string()),
  search_rank: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

// Main search response schema
export const SearchResultSchema = z.object({
  total_count: z.number(),
  page: z.number(),
  page_size: z.number(),
  total_pages: z.number(),
  query_time_ms: z.number(),
  results: z.array(SearchResultItemSchema),
  suggestions: z.array(SearchSuggestionSchema),
});

// Songs search response schema
export const SongsSearchResultSchema = z.object({
  total_count: z.number(),
  page: z.number(),
  page_size: z.number(),
  query_time_ms: z.number(),
  songs: z.array(SongSearchResultSchema),
});

// Suggestions response schema
export const SuggestionsResultSchema = z.object({
  suggestions: z.array(SearchSuggestionSchema),
  count: z.number(),
});

// Search API specification following the existing API_SPEC pattern
export const SEARCH_API_SPEC = {
  baseUrl: "http://localhost:8080",
  endpoints: {
    // Music search endpoints
    musicSearch: {
      method: "GET" as const,
      path: "/api/music/search",
      queryParams: MusicSearchOptionsSchema,
      requestSchema: z.void(),
      responseSchema: SearchResultSchema,
    },
    musicSearchSongs: {
      method: "GET" as const,
      path: "/api/music/search/songs",
      queryParams: SongsSearchOptionsSchema,
      requestSchema: z.void(),
      responseSchema: SongsSearchResultSchema,
    },
    musicSuggestions: {
      method: "GET" as const,
      path: "/api/music/search/suggestions",
      queryParams: SuggestionsOptionsSchema,
      requestSchema: z.void(),
      responseSchema: SuggestionsResultSchema,
    },
    // Future endpoints for other domains
    // photosSearch: {
    //   method: "GET" as const,
    //   path: "/api/photos/search",
    //   queryParams: SearchOptionsSchema,
    //   requestSchema: z.void(),
    //   responseSchema: SearchResultSchema,
    // },
    // videosSearch: {
    //   method: "GET" as const,
    //   path: "/api/videos/search",
    //   queryParams: SearchOptionsSchema,
    //   requestSchema: z.void(),
    //   responseSchema: SearchResultSchema,
    // },
    // documentsSearch: {
    //   method: "GET" as const,
    //   path: "/api/documents/search",
    //   queryParams: SearchOptionsSchema,
    //   requestSchema: z.void(),
    //   responseSchema: SearchResultSchema,
    // },
  },
} as const;

// Type helpers for working with the search API spec
export type SearchApiSpec = typeof SEARCH_API_SPEC;
export type SearchEndpointName = keyof SearchApiSpec["endpoints"];
export type SearchEndpointConfig<T extends SearchEndpointName> =
  SearchApiSpec["endpoints"][T];

// Inferred types from schemas
export type SearchOptions = z.infer<typeof SearchOptionsSchema>;
export type MusicSearchOptions = z.infer<typeof MusicSearchOptionsSchema>;
export type SongsSearchOptions = z.infer<typeof SongsSearchOptionsSchema>;
export type SuggestionsOptions = z.infer<typeof SuggestionsOptionsSchema>;

export type SearchResult = z.infer<typeof SearchResultSchema>;
export type SongsSearchResult = z.infer<typeof SongsSearchResultSchema>;
export type SuggestionsResult = z.infer<typeof SuggestionsResultSchema>;
export type SearchResultItem = z.infer<typeof SearchResultItemSchema>;
export type SongSearchResult = z.infer<typeof SongSearchResultSchema>;
export type SearchSuggestion = z.infer<typeof SearchSuggestionSchema>;
