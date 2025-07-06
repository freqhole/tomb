import { z } from "zod";
import {
  createPartialArraySchema,
  DEFAULT_ZOD_CONFIG,
} from "./search-validation.js";

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

// Songs-only search options
export const SongsSearchOptionsSchema = MusicSearchOptionsSchema;

// Suggestions options
export const SuggestionsOptionsSchema = z.object({
  q: z.string().min(1, "Query is required"),
  limit: z.number().min(1).max(50).nullish(),
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
  created_at: z.string(),
  updated_at: z.string(),
});

// Search suggestion schema
export const SearchSuggestionSchema = z.object({
  text: z.string(),
  category: z.string(),
  frequency: z.number(),
});

// Song search result schema (for songs-only endpoint)
export const SongSearchResultSchema = z.object({
  id: z.string(),
  media_blob_id: z.string(),
  thumbnail_blob_id: z.string().nullish(),
  waveform_blob_id: z.string().nullish(),
  title: z.string(),
  artist: z.string().nullish(),
  album: z.string().nullish(),
  album_artist: z.string().nullish(),
  track_number: z.number().nullish(),
  disc_number: z.number().nullish(),
  genre: z.string().nullish(),
  year: z.number().nullish(),
  bpm: z.number().nullish(),
  key_signature: z.string().nullish(),
  rating: z.number().nullish(),
  is_favorite: z.boolean(),
  tags: z.array(z.string()),
  search_rank: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

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
  SongSearchResultSchema,
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

// Suggestions response schema with graceful collection parsing
export const SuggestionsResultSchema = z.object({
  suggestions: SearchSuggestionsSchema,
  count: z.number(),
});

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
