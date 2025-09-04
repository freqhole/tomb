import { z } from "zod";

// uuid string pattern validation
const UuidSchema = z.string().uuid();

// core admin song schema - extends the base song with admin-specific fields
export const AdminSongSchema = z.object({
  id: UuidSchema,
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
  updated_at: z.string().optional(),
  media_blob_id: z.string(),
  thumbnail_blob_id: z.string().nullable(),
  waveform_blob_id: z.string().nullable(),
  thumbnail_blob_ids: z.array(z.string()),
  // admin-specific fields
  file_path: z.string().nullable().optional(),
  file_size: z.number().nullable().optional(),
  file_format: z.string().nullable().optional(),
  bitrate: z.number().nullable().optional(),
  sample_rate: z.number().nullable().optional(),
});

export type AdminSong = z.infer<typeof AdminSongSchema>;

// admin filters schema for complex filtering - enhanced with unified search parameters
export const AdminMusicFiltersSchema = z.object({
  // text search
  q: z.string().optional(),
  search_type: z.enum(["websearch", "plainto", "phrase", "fuzzy"]).optional(),

  // legacy fields
  favorites: z.boolean().optional(),
  is_favorite: z.boolean().optional(),
  title_search: z.string().optional(),

  // basic filters
  artist: z.string().optional(),
  artist_exact: z.boolean().optional(),
  album: z.string().optional(),
  album_exact: z.boolean().optional(),
  genre: z.string().optional(),
  title: z.string().optional(),

  // numeric range filters
  year: z.number().optional(),
  year_min: z.number().optional(),
  year_max: z.number().optional(),
  rating: z.number().optional(),
  rating_min: z.number().optional(),
  rating_max: z.number().optional(),
  bpm: z.number().optional(),
  bpm_min: z.number().optional(),
  bpm_max: z.number().optional(),
  duration_seconds: z.number().optional(),
  duration_min: z.number().optional(),
  duration_max: z.number().optional(),

  // boolean filters
  has_thumbnail: z.boolean().optional(),
  has_lyrics: z.boolean().optional(),
  has_waveform: z.boolean().optional(),

  // array filters
  tags: z.array(z.string()).optional(),
  tags_any: z.array(z.string()).optional(),
  tags_exclude: z.array(z.string()).optional(),
  file_formats: z.array(z.string()).optional(),

  // file/technical filters
  file_format: z.string().optional(),
  format: z.string().optional(),
  bitrate_min: z.number().optional(),
  bitrate_max: z.number().optional(),
  sample_rate_min: z.number().optional(),
  sample_rate_max: z.number().optional(),

  // date filters
  created_after: z.string().optional(),
  created_before: z.string().optional(),
  updated_after: z.string().optional(),
  updated_before: z.string().optional(),

  // advanced metadata filters
  key_signature: z.string().optional(),

  // null checking filters
  rating_is_null: z.boolean().optional(),
  genre_is_null: z.boolean().optional(),
  year_is_null: z.boolean().optional(),
  bpm_is_null: z.boolean().optional(),
  key_signature_is_null: z.boolean().optional(),
  artist_is_null: z.boolean().optional(),
  album_is_null: z.boolean().optional(),
  album_artist_is_null: z.boolean().optional(),

  // pagination and sorting
  page: z.number().optional(),
  page_size: z.number().optional(),
  sort_by: z.string().optional(),
  sort_field: z.string().optional(),
  sort_direction: z.enum(["asc", "desc"]).optional(),

  // response options
  include_deleted: z.boolean().optional(),
  include_hidden: z.boolean().optional(),
  songs_only: z.boolean().optional(),
});

export type AdminMusicFilters = z.infer<typeof AdminMusicFiltersSchema>;

// pagination schema
export const AdminPaginationSchema = z.object({
  page: z.number().min(1).optional(),
  page_size: z.number().min(1).max(1000).optional(),
  limit: z.number().min(1).max(1000).optional(),
  offset: z.number().min(0).optional(),
});

export type AdminPagination = z.infer<typeof AdminPaginationSchema>;

// music list response
export const MusicListResponseSchema = z.object({
  songs: z.array(AdminSongSchema),
  total_count: z.number(),
  page: z.number().optional(),
  page_size: z.number().optional(),
  total_pages: z.number().optional(),
  has_next: z.boolean(),
  has_prev: z.boolean(),
  filters_applied: AdminMusicFiltersSchema.optional(),
});

export type MusicListResponse = z.infer<typeof MusicListResponseSchema>;

// bulk operation types
export const BulkOperationTypeSchema = z.enum([
  "update_rating",
  "toggle_favorite",
  "add_tags",
  "remove_tags",
  "replace_tags",
  "update_genre",
  "update_year",
  "delete",
  "export",
]);

export const BulkOperationSchema = z.object({
  operation_type: BulkOperationTypeSchema,
  song_ids: z.array(UuidSchema).optional(),
  filters: AdminMusicFiltersSchema.optional(),
  parameters: z.record(z.any()),
  preview_only: z.boolean().optional(),
});

export type BulkOperation = z.infer<typeof BulkOperationSchema>;

// admin grid state for UI
export interface AdminGridState<T = AdminSong> {
  items: T[];
  total: number;
  loading: boolean;
  error: string | null;
  selectedIds: Set<string>;
  filters: AdminMusicFilters;
  pagination: AdminPagination & {
    total_pages?: number;
    has_next?: boolean;
    has_prev?: boolean;
  };
  sortField: string | null;
  sortDirection: "asc" | "desc" | null;
}

// selection system types
export interface SelectionState {
  selectedIds: Set<string>;
  lastSelectedId: string | null;
  selectMode: "single" | "multi" | "range";
}

export interface SelectionActions {
  selectItem: (id: string, multi?: boolean) => void;
  selectRange: (startId: string, endId: string) => void;
  selectAll: (items: AdminSong[]) => void;
  clearSelection: () => void;
  toggleSelection: (id: string) => void;
  isSelected: (id: string) => boolean;
  getSelectedItems: (items: AdminSong[]) => AdminSong[];
}

// event registry types
export interface EventRegistry {
  register: (
    element: HTMLElement | Document,
    type: string,
    handler: (event: Event) => void,
    options?: AddEventListenerOptions
  ) => void;
  cleanup: () => void;
}

// filter option for dropdowns
export const FilterOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  count: z.number(),
});

export type FilterOption = z.infer<typeof FilterOptionSchema>;

// advanced filter metadata
export const FilterMetadataSchema = z.object({
  genres: z.array(FilterOptionSchema),
  artists: z.array(FilterOptionSchema),
  years: z.array(FilterOptionSchema),
  file_formats: z.array(FilterOptionSchema),
  tags: z.array(FilterOptionSchema),
  rating_range: z.object({
    min: z.number(),
    max: z.number(),
    most_common: z.number().optional(),
  }),
  summary: z.object({
    total_songs: z.number(),
    rated_songs: z.number(),
    favorite_songs: z.number(),
    unique_genres: z.number(),
    unique_artists: z.number(),
    unique_years: z.number(),
  }),
});

export type FilterMetadata = z.infer<typeof FilterMetadataSchema>;

// update request schemas
export const AdminSongUpdateSchema = z.object({
  is_favorite: z.boolean().optional(),
  rating: z.number().min(0).max(5).nullable().optional(),
  title: z.string().optional(),
  artist: z.string().nullable().optional(),
  album: z.string().nullable().optional(),
  album_artist: z.string().nullable().optional(),
  year: z.number().nullable().optional(),
  genre: z.string().nullable().optional(),
  bpm: z.number().nullable().optional(),
  key_signature: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

export type AdminSongUpdate = z.infer<typeof AdminSongUpdateSchema>;

export const BulkUpdateRequestSchema = z.object({
  song_ids: z.array(UuidSchema).optional(),
  filters: AdminMusicFiltersSchema.optional(),
  updates: AdminSongUpdateSchema,
  preview_only: z.boolean().optional(),
});

export type BulkUpdateRequest = z.infer<typeof BulkUpdateRequestSchema>;

// api response for bulk operations
export const BulkOperationResponseSchema = z.object({
  operation_id: z.string(),
  total_songs: z.number(),
  preview: z.array(AdminSongSchema).optional(),
  estimated_duration_seconds: z.number().optional(),
  warnings: z.array(z.string()).optional(),
  success: z.boolean(),
  message: z.string(),
});

export type BulkOperationResponse = z.infer<typeof BulkOperationResponseSchema>;
