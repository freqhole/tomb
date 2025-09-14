import { z } from "zod";
import { createPartialArraySchema, DEFAULT_ZOD_CONFIG } from "./validation.js";
import { SongSchema } from "../music/schemas/song.js";

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
export type SortBy = z.infer<typeof SortBySchema>;
export const SortDirectionSchema = z.enum(["asc", "desc"]);

// Base search options schema
export const SearchOptionsSchema = z.object({
  q: z.string().min(1, "Query is required"),
  structured: z.boolean().nullish(),
  search_type: SearchTypeSchema.nullish(),
  page: z.number().min(1).nullish(),
  page_size: z.number().min(1).max(100).nullish(),
  sort_by: SortBySchema.nullish(),
  sort_direction: SortDirectionSchema.nullish(),
});

// Music-specific search options
export const MusicSearchOptionsSchema = SearchOptionsSchema.extend({
  artist: z.string().nullish(),
  album: z.string().nullish(),
  genre: z.string().nullish(),
  year: z.number().nullish(),
  rating_min: z.number().min(1).max(5).nullish(),
  rating_max: z.number().min(1).max(5).nullish(),
  favorites_only: z.boolean().nullish(),
});

// Unified search options with all filters (used by /api/music/search endpoint)
export const UnifiedSearchOptionsSchema = z.object({
  // Text search
  q: z.string().nullish(),
  search_type: SearchTypeSchema.nullish(),
  search_fields: z.array(z.string()).nullish(),

  // Pagination
  page: z.number().min(1).nullish(),
  page_size: z.number().min(1).max(100).nullish(),
  offset: z.number().min(0).nullish(),
  limit: z.number().min(1).max(100).nullish(),

  // Sorting
  sort_by: z.string().nullish(),
  sort_direction: SortDirectionSchema.nullish(),
  secondary_sort: z.string().nullish(),

  // Basic filters
  artist: z.string().nullish(),
  artist_exact: z.boolean().nullish(),
  album: z.string().nullish(),
  album_exact: z.boolean().nullish(),
  genre: z.string().nullish(),
  title: z.string().nullish(),

  // Numeric range filters
  year: z.number().nullish(),
  year_min: z.number().nullish(),
  year_max: z.number().nullish(),
  rating: z.number().min(1).max(5).nullish(),
  rating_min: z.number().min(1).max(5).nullish(),
  rating_max: z.number().min(1).max(5).nullish(),
  bpm: z.number().nullish(),
  bpm_min: z.number().nullish(),
  bpm_max: z.number().nullish(),
  duration_seconds: z.number().nullish(),
  duration_min: z.number().nullish(),
  duration_max: z.number().nullish(),
  track_number: z.number().nullish(),
  disc_number: z.number().nullish(),

  // Boolean filters
  is_favorite: z.boolean().nullish(),
  has_thumbnail: z.boolean().nullish(),
  has_lyrics: z.boolean().nullish(),
  has_waveform: z.boolean().nullish(),
  is_compilation: z.boolean().nullish(),

  // Array/multi-value filters
  tags: z.array(z.string()).nullish(),
  tags_any: z.array(z.string()).nullish(),
  tags_exclude: z.array(z.string()).nullish(),
  genres: z.array(z.string()).nullish(),
  artists: z.array(z.string()).nullish(),
  albums: z.array(z.string()).nullish(),

  // File/technical filters
  file_format: z.string().nullish(),
  file_formats: z.array(z.string()).nullish(),
  bitrate_min: z.number().nullish(),
  bitrate_max: z.number().nullish(),
  sample_rate_min: z.number().nullish(),
  sample_rate_max: z.number().nullish(),
  file_size_min: z.number().nullish(),
  file_size_max: z.number().nullish(),

  // Date filters (as ISO strings)
  created_after: z.string().nullish(),
  created_before: z.string().nullish(),
  updated_after: z.string().nullish(),
  updated_before: z.string().nullish(),
  added_after: z.string().nullish(),
  added_before: z.string().nullish(),

  // Advanced admin filters
  key_signature: z.string().nullish(),
  key_signatures: z.array(z.string()).nullish(),
  mood: z.string().nullish(),
  energy_level_min: z.number().nullish(),
  energy_level_max: z.number().nullish(),
  tempo_category: z.string().nullish(),

  // Library management
  playlist_id: z.string().nullish(),
  not_in_playlist: z.string().nullish(),
  duplicate_check: z.string().nullish(),
  missing_metadata: z.array(z.string()).nullish(),
  has_errors: z.boolean().nullish(),
  needs_review: z.boolean().nullish(),

  // Response options
  include_deleted: z.boolean().nullish(),
  include_hidden: z.boolean().nullish(),
  full_metadata: z.boolean().nullish(),
  include_file_info: z.boolean().nullish(),
  include_statistics: z.boolean().nullish(),
  include_related: z.boolean().nullish(),

  // Performance options
  skip_total_count: z.boolean().nullish(),
  explain_query: z.boolean().nullish(),

  // Null checking filters
  rating_is_null: z.boolean().nullish(),
  genre_is_null: z.boolean().nullish(),
  year_is_null: z.boolean().nullish(),
  bpm_is_null: z.boolean().nullish(),
  key_signature_is_null: z.boolean().nullish(),
  artist_is_null: z.boolean().nullish(),
  album_is_null: z.boolean().nullish(),
  album_artist_is_null: z.boolean().nullish(),

  // Legacy compatibility
  favorites_only: z.boolean().nullish(),
  songs_only: z.boolean().nullish(),
});

// Songs-only search options
export const SongsSearchOptionsSchema = MusicSearchOptionsSchema;

// Suggestions options
export const SuggestionsOptionsSchema = z.object({
  q: z.string().min(1, "Query is required").optional(),
  limit: z.number().min(1).max(50).nullish(),
  field: z.string().default("title"), // Field to search in (artist, album, etc.)
  partial: z.string().min(1, "Partial query is required").optional(), // The server expects this parameter
  page: z.number().min(1).nullish(),
  page_size: z.number().min(1).max(50).nullish(),
});

// Individual search result item schema
export const SearchResultItemSchema = z.object({
  id: z.string(),
  result_type: z.string(),
  title: z.string(),
  subtitle: z.string().nullish(),
  description: z.string().nullish(),
  thumbnail_blob_id: z.string().nullish(),
  media_blob_id: z.string().nullish(),
  relevance_score: z.number(),
  metadata: z.record(z.any()),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

// Search suggestion schema
export const SearchSuggestionSchema = z.object({
  text: z.string(),
  category: z.string().optional(),
  frequency: z.number().optional(),
  // Server fields
  value: z.string().optional(),
  display: z.string().optional(),
  highlight: z.string().optional(),
  count: z.number().optional(),
  suggestion_type: z.string().optional(),
  confidence: z.number().optional(),
  // Used for type compatibility
  query: z.string().optional(),
});

// Song search result schema (for songs-only endpoint)
// Use canonical SongSchema instead of duplicate search result schema
export const SongSearchResultSchema = SongSchema;

// Collection schemas using partial parsing for graceful degradation
export const SearchResultItemsSchema = createPartialArraySchema(
  SearchResultItemSchema,
  DEFAULT_ZOD_CONFIG
);

export const SearchSuggestionsSchema = createPartialArraySchema(
  SearchSuggestionSchema,
  DEFAULT_ZOD_CONFIG
);

export const SongSearchResultsSchema = createPartialArraySchema(
  SongSchema,
  DEFAULT_ZOD_CONFIG
);

// Main search response schema with graceful collection parsing
export const SearchResultSchema = z.object({
  total_count: z.number(),
  page: z.number(),
  page_size: z.number(),
  total_pages: z.number(),
  query_time_ms: z.number(),
  results: SearchResultItemsSchema,
  suggestions: SearchSuggestionsSchema,
});

// Songs search response schema with graceful collection parsing
export const SongsSearchResultSchema = z.object({
  total_count: z.number(),
  page: z.number(),
  page_size: z.number(),
  query_time_ms: z.number(),
  songs: SongSearchResultsSchema,
});

// Unified search response schema (for /api/music/search endpoint)
export const UnifiedSearchResultSchema = z.object({
  // Results
  songs: SongSearchResultsSchema,
  total_count: z.number(),
  total: z.number().optional(), // Alternative field name

  // Pagination
  page: z.number(),
  page_size: z.number(),
  total_pages: z.number().optional(),
  has_next: z.boolean().optional(),
  has_prev: z.boolean().optional(),

  // Performance
  query_time_ms: z.number().optional(),

  // Applied filters info
  applied_filters: z
    .object({
      text_search: z.string().nullish(),
      artist_filters: z.array(z.string()),
      album_filters: z.array(z.string()),
      genre_filters: z.array(z.string()),
      year_range: z.tuple([z.number(), z.number()]).nullish(),
      rating_range: z.tuple([z.number(), z.number()]).nullish(),
      tag_filters: z.array(z.string()),
      favorites_only: z.boolean().nullish(),
    })
    .optional(),

  // Sort info
  sort_applied: z
    .object({
      primary_field: z.string(),
      primary_direction: z.string(),
      secondary_field: z.string().nullish(),
      secondary_direction: z.string().nullish(),
    })
    .optional(),

  // Aggregations and stats
  aggregations: z.record(z.any()).nullable().optional(),
  debug: z.record(z.any()).nullable().optional(),
});

// POST search request schema - cleaner version for JSON body
export const PostSearchRequestSchema = z.object({
  // Text search
  query: z.string().optional(),
  search_type: SearchTypeSchema.optional(),
  search_fields: z.array(z.string()).optional(),

  // Pagination
  page: z.number().min(1).default(1),
  page_size: z.number().min(1).max(100).default(50),

  // Sorting
  sort_by: z.string().optional(),
  sort_direction: SortDirectionSchema.optional(),

  // Filters
  filters: z
    .object({
      // Basic filters
      artist: z.string().optional(),
      album: z.string().optional(),
      genre: z.string().optional(),
      title: z.string().optional(),

      // Numeric range filters
      year: z.number().optional(),
      year_min: z.number().optional(),
      year_max: z.number().optional(),
      rating: z.number().min(1).max(5).optional(),
      rating_min: z.number().min(1).max(5).optional(),
      rating_max: z.number().min(1).max(5).optional(),

      // Boolean filters
      is_favorite: z.boolean().optional(),
      has_thumbnail: z.boolean().optional(),

      // Array filters
      tags: z.array(z.string()).optional(),
      tags_any: z.array(z.string()).optional(),
      tags_exclude: z.array(z.string()).optional(),
      genres: z.array(z.string()).optional(),
      artists: z.array(z.string()).optional(),
      albums: z.array(z.string()).optional(),
    })
    .optional(),
});

// POST search response schema
export const PostSearchResponseSchema = z.object({
  // Results
  songs: SongSearchResultsSchema,
  total: z.number(),

  // Pagination
  page: z.number().optional(),
  page_size: z.number().optional(),
  total_pages: z.number().optional(),
  has_next: z.boolean(),
  has_prev: z.boolean(),
});

// Suggestions response schema with graceful collection parsing
export const SuggestionsResultSchema = z.object({
  suggestions: SearchSuggestionsSchema,
  query_time_ms: z.number().optional(),
  total_count: z.number().optional(),
  count: z.number().optional(),
  page: z.number().optional(),
  page_size: z.number().optional(),
  total_pages: z.number().optional(),
  has_next: z.boolean().optional(),
  has_prev: z.boolean().optional(),
});

// Inferred types from schemas
export type SearchOptions = z.infer<typeof SearchOptionsSchema>;
export type MusicSearchOptions = z.infer<typeof MusicSearchOptionsSchema>;
export type SongsSearchOptions = z.infer<typeof SongsSearchOptionsSchema>;
export type SuggestionsOptions = z.infer<typeof SuggestionsOptionsSchema>;
export type UnifiedSearchOptions = z.infer<typeof UnifiedSearchOptionsSchema>;
export type PostSearchRequest = z.infer<typeof PostSearchRequestSchema>;
export type PostSearchResponse = z.infer<typeof PostSearchResponseSchema>;

export type SearchResult = z.infer<typeof SearchResultSchema>;
export type SongsSearchResult = z.infer<typeof SongsSearchResultSchema>;
export type SuggestionsResult = z.infer<typeof SuggestionsResultSchema>;
export type UnifiedSearchResult = z.infer<typeof UnifiedSearchResultSchema>;
export type SearchResultItem = z.infer<typeof SearchResultItemSchema>;
export type SongSearchResult = z.infer<typeof SongSchema>;
export type SearchSuggestion = z.infer<typeof SearchSuggestionSchema>;

// Search client configuration
export interface SearchClientConfig {
  enableValidation?: boolean;
  logValidationErrors?: boolean;
  logLevel?: "error" | "warn" | "info";
  throwOnValidationErrors?: boolean;
}

export const DEFAULT_SEARCH_CLIENT_CONFIG: SearchClientConfig = {
  enableValidation: true,
  logValidationErrors: true,
  logLevel: "warn",
  throwOnValidationErrors: false,
};
