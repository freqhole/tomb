// Search API specifications and types
// Music domain-specific search and filters
export * as Music from "./music/index.js";
export type {
  SearchDomain,
  SearchType,
  SearchOptions,
  MusicSearchOptions,
  SongsSearchOptions,
  SuggestionsOptions,
  SearchResult,
  SongsSearchResult,
  SuggestionsResult,
  SearchResultItem,
  SongSearchResult,
  SearchSuggestion,
  SearchClientConfig,
} from "./types.js";

export {
  SearchDomainSchema,
  SearchTypeSchema,
  SearchOptionsSchema,
  MusicSearchOptionsSchema,
  SongsSearchOptionsSchema,
  SuggestionsOptionsSchema,
  SearchResultSchema,
  SongsSearchResultSchema,
  SuggestionsResultSchema,
  SearchResultItemSchema,
  SongSearchResultSchema,
  SearchSuggestionSchema,
  DEFAULT_SEARCH_CLIENT_CONFIG,
} from "./types.js";

// Search validation utilities
export type { ZodErrorConfig } from "./validation.js";

export {
  DEFAULT_ZOD_CONFIG,
  createPartialArraySchema,
  createRequestSchema,
  SearchValidation,
  searchValidation,
  createValidatedResponseSchema,
} from "./validation.js";

// Search builder functionality removed - use modern searchPost API instead

// Re-export enhanced ApiClient with search methods
export { ApiClient, ApiError } from "../api-client.js";

// Utility functions for common search patterns
export function createSearchQuery(
  query: string,
  domain: "music" | "photos" | "videos" | "documents" = "music"
) {
  return {
    q: query,
    domain,
    structured: false,
    search_type: "websearch" as const,
    page: 1,
    page_size: 20,
  };
}

export function createStructuredSearchQuery(
  field: string,
  value: string,
  domain: "music" | "photos" | "videos" | "documents" = "music"
) {
  return {
    q: `${field}:${value}`,
    domain,
    structured: true,
    search_type: "websearch" as const,
    page: 1,
    page_size: 20,
  };
}

// Common search configurations
export const SEARCH_PRESETS = {
  // Music search presets
  MUSIC_QUICK: {
    search_type: "websearch" as const,
    page_size: 10,
    sort_by: "relevance" as const,
  },
  MUSIC_DETAILED: {
    search_type: "websearch" as const,
    page_size: 50,
    sort_by: "relevance" as const,
  },
  MUSIC_FAVORITES: {
    search_type: "websearch" as const,
    page_size: 20,
    favorites_only: true,
    sort_by: "rating" as const,
  },
  // Autocomplete presets
  SUGGESTIONS_QUICK: {
    limit: 5,
  },
  SUGGESTIONS_DETAILED: {
    limit: 15,
  },
} as const;

// Search error types
export class SearchTimeoutError extends Error {
  constructor(query: string, timeout: number) {
    super(`Search for "${query}" timed out after ${timeout}ms`);
    this.name = "SearchTimeoutError";
  }
}

export class SearchValidationError extends Error {
  constructor(field: string, value: unknown, expectedType: string) {
    super(`Invalid ${field}: expected ${expectedType}, got ${typeof value}`);
    this.name = "SearchValidationError";
  }
}

export class SearchEmptyResultError extends Error {
  constructor(query: string) {
    super(`No results found for query: "${query}"`);
    this.name = "SearchEmptyResultError";
  }
}

// Re-export music filter types and client for convenience
export type {
  FilterOption,
  FilterParams,
  AllFiltersResponse,
  MusicFilterClient,
} from "./music/index.js";

export {
  createMusicFilterClient,
  createDefaultMusicFilterClient,
} from "./music/index.js";
