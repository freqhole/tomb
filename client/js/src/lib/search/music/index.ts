//! Music search module exports

// Filter types and schemas
export * from "./filter-types";

// Filter API client
export * from "./filter-client";

// Re-export commonly used types for convenience
export type {
  FilterOption,
  FilterParams,
  GenreFiltersResponse,
  ArtistFiltersResponse,
  YearFiltersResponse,
  AllFiltersResponse,
  RatingRange,
  FilterSummary,
  DefaultFilterOptions,
} from "./filter-types";

// Re-export main client class
export {
  MusicFilterClient,
  MusicFilterApiError,
  createMusicFilterClient,
  createDefaultMusicFilterClient,
} from "./filter-client";
