//! Music filter types for the client library

import { z } from "zod";

/// Filter option with count information
export interface FilterOption {
  /// Filter value (used in API calls)
  value: string;
  /// Display label for UI
  label: string;
  /// Number of songs with this filter value
  count: number;
}

/// Query parameters for filter metadata requests
export interface FilterParams {
  /// Maximum number of items to return (default: 50)
  limit?: number;
  /// Minimum count threshold to include item (default: 0)
  min_count?: number;
}

/// Response for genre filters
export interface GenreFiltersResponse {
  /// Available genre options
  genres: FilterOption[];
  /// Total number of unique genres
  total_count: number;
}

/// Response for artist filters
export interface ArtistFiltersResponse {
  /// Available artist options
  artists: FilterOption[];
  /// Total number of unique artists
  total_count: number;
}

/// Response for year filters
export interface YearFiltersResponse {
  /// Available year options
  years: FilterOption[];
  /// Total number of unique years
  total_count: number;
}

/// Rating range information
export interface RatingRange {
  /// Minimum rating value
  min: number;
  /// Maximum rating value
  max: number;
  /// Most common rating
  most_common?: number | null;
}

/// Summary statistics for filters
export interface FilterSummary {
  /// Total number of songs
  total_songs: number;
  /// Number of songs with ratings
  rated_songs: number;
  /// Number of favorite songs
  favorite_songs: number;
  /// Number of unique genres
  unique_genres: number;
  /// Number of unique artists
  unique_artists: number;
  /// Number of unique years
  unique_years: number;
}

/// Combined metadata for all filter types
export interface AllFiltersResponse {
  /// Genre filter options
  genres: FilterOption[];
  /// Artist filter options
  artists: FilterOption[];
  /// Year filter options
  years: FilterOption[];
  /// Rating range information
  rating_range: RatingRange;
  /// Summary statistics
  summary: FilterSummary;
}

// Zod schemas for validation
export const FilterOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  count: z.number().int().min(0),
});

export const FilterParamsSchema = z.object({
  limit: z.number().int().min(1).max(1000).optional().default(50),
  min_count: z.number().int().min(0).optional().default(0),
});

export const GenreFiltersResponseSchema = z.object({
  genres: z.array(FilterOptionSchema),
  total_count: z.number().int().min(0),
});

export const ArtistFiltersResponseSchema = z.object({
  artists: z.array(FilterOptionSchema),
  total_count: z.number().int().min(0),
});

export const YearFiltersResponseSchema = z.object({
  years: z.array(FilterOptionSchema),
  total_count: z.number().int().min(0),
});

export const RatingRangeSchema = z.object({
  min: z.number().int().min(1).max(5),
  max: z.number().int().min(1).max(5),
  most_common: z.number().int().min(1).max(5).nullish(),
});

export const FilterSummarySchema = z.object({
  total_songs: z.number().int().min(0),
  rated_songs: z.number().int().min(0),
  favorite_songs: z.number().int().min(0),
  unique_genres: z.number().int().min(0),
  unique_artists: z.number().int().min(0),
  unique_years: z.number().int().min(0),
});

// Paginated filter options structure matching the actual API
export const PaginatedFilterOptionsSchema = z.object({
  items: z.array(FilterOptionSchema),
  total_count: z.number().int().min(0),
  page: z.number().int().min(1),
  page_size: z.number().int().min(1),
  total_pages: z.number().int().min(1),
  has_next: z.boolean(),
  has_prev: z.boolean(),
});

// Utility for handling potentially empty arrays with proper typing
// Handles cases where API returns undefined, null, or empty array
export function createOptionalArraySchema<T extends z.ZodTypeAny>(
  itemSchema: T
) {
  return z
    .array(itemSchema)
    .nullable()
    .optional()
    .transform((val) => val || [])
    .default([]);
}

// Duration range structure from the actual API
export const DurationRangeSchema = z.object({
  min_seconds: z.number().int().min(0),
  max_seconds: z.number().int().min(0),
  label: z.string(),
  count: z.number().int().min(0),
});

// BPM range structure from the actual API
export const BpmRangeSchema = z.object({
  min_bpm: z.number().int().min(0),
  max_bpm: z.number().int().min(0),
  label: z.string(),
  count: z.number().int().min(0),
});

// Year range structure from the actual API
export const YearRangeSchema = z.object({
  min_year: z.number().int(),
  max_year: z.number().int(),
  label: z.string(),
  count: z.number().int().min(0),
});

// Bitrate range structure from the actual API
export const BitrateRangeSchema = z.object({
  min_bitrate: z.number().int().min(0),
  max_bitrate: z.number().int().min(0),
  label: z.string(),
  count: z.number().int().min(0),
});

// Library statistics structure from the actual API
export const LibraryStatisticsSchema = z.object({
  total_songs: z.number().int().min(0),
  total_artists: z.number().int().min(0),
  total_albums: z.number().int().min(0),
  total_genres: z.number().int().min(0),
  total_tags: z.number().int().min(0),
  total_playtime_seconds: z.number().int().min(0),
  avg_song_duration: z.number(),
  total_file_size_bytes: z.number().int().min(0),
  last_updated: z.string(),
});

// The actual filter-options API response structure
export const FilterOptionsResponseSchema = z.object({
  artists: PaginatedFilterOptionsSchema,
  albums: PaginatedFilterOptionsSchema,
  genres: PaginatedFilterOptionsSchema,
  tags: PaginatedFilterOptionsSchema,
  years: z.array(FilterOptionSchema),
  year_ranges: createOptionalArraySchema(YearRangeSchema),
  rating_distribution: createOptionalArraySchema(z.number().int().min(0)),
  avg_rating: z.number(),
  file_formats: createOptionalArraySchema(FilterOptionSchema),
  bitrate_ranges: createOptionalArraySchema(BitrateRangeSchema),
  duration_ranges: createOptionalArraySchema(DurationRangeSchema),
  key_signatures: createOptionalArraySchema(FilterOptionSchema),
  bpm_ranges: createOptionalArraySchema(BpmRangeSchema),
  mood_categories: createOptionalArraySchema(FilterOptionSchema),
  favorites_count: z.number().int().min(0),
  has_thumbnail_count: z.number().int().min(0),
  has_lyrics_count: z.number().int().min(0),
  compilation_count: z.number().int().min(0),
  statistics: LibraryStatisticsSchema,
});

// Keep the old schema for backward compatibility
export const AllFiltersResponseSchema = z.object({
  genres: z.array(FilterOptionSchema),
  artists: z.array(FilterOptionSchema),
  years: z.array(FilterOptionSchema),
  rating_range: RatingRangeSchema,
  summary: FilterSummarySchema,
});

// Type exports from schemas
export type ValidatedFilterParams = z.infer<typeof FilterParamsSchema>;
export type ValidatedGenreFiltersResponse = z.infer<
  typeof GenreFiltersResponseSchema
>;
export type ValidatedArtistFiltersResponse = z.infer<
  typeof ArtistFiltersResponseSchema
>;
export type ValidatedYearFiltersResponse = z.infer<
  typeof YearFiltersResponseSchema
>;
export type ValidatedAllFiltersResponse = z.infer<
  typeof AllFiltersResponseSchema
>;
export type PaginatedFilterOptions = z.infer<
  typeof PaginatedFilterOptionsSchema
>;
export type FilterOptionsResponse = z.infer<typeof FilterOptionsResponseSchema>;
export type YearRange = z.infer<typeof YearRangeSchema>;
export type BitrateRange = z.infer<typeof BitrateRangeSchema>;
export type DurationRange = z.infer<typeof DurationRangeSchema>;
export type BpmRange = z.infer<typeof BpmRangeSchema>;
export type LibraryStatistics = z.infer<typeof LibraryStatisticsSchema>;

// Default filter options structure for component compatibility
export interface DefaultFilterOptions {
  genres: Omit<FilterOption, "count">[];
  artists: Omit<FilterOption, "count">[];
  types: Omit<FilterOption, "count">[];
}

// Transform helpers
export function transformToDefaultFormat(
  response: AllFiltersResponse
): DefaultFilterOptions {
  return {
    genres: response.genres.map(({ value, label }) => ({ value, label })),
    artists: response.artists.map(({ value, label }) => ({ value, label })),
    types: [
      { value: "song", label: "Song" },
      { value: "album", label: "Album" },
      { value: "artist", label: "Artist" },
    ],
  };
}

export function enrichWithCounts(
  defaultOptions: DefaultFilterOptions,
  response: AllFiltersResponse
): {
  genres: FilterOption[];
  artists: FilterOption[];
  types: Omit<FilterOption, "count">[];
} {
  const genreMap = new Map(response.genres.map((g) => [g.value, g.count]));
  const artistMap = new Map(response.artists.map((a) => [a.value, a.count]));

  return {
    genres: defaultOptions.genres.map((g) => ({
      ...g,
      count: genreMap.get(g.value) || 0,
    })),
    artists: defaultOptions.artists.map((a) => ({
      ...a,
      count: artistMap.get(a.value) || 0,
    })),
    types: defaultOptions.types,
  };
}
