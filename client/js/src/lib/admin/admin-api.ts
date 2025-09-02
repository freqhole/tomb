import { z } from "zod";

// UUID string pattern validation
const UuidSchema = z.string().uuid();

// Core admin song schema - extends the base song with admin-specific fields
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
  // Admin-specific fields
  file_path: z.string().nullable().optional(),
  file_size: z.number().nullable().optional(),
  file_format: z.string().nullable().optional(),
  bitrate: z.number().nullable().optional(),
  sample_rate: z.number().nullable().optional(),
});

export type AdminSong = z.infer<typeof AdminSongSchema>;

// Admin filters schema for complex filtering
export const AdminMusicFiltersSchema = z.object({
  favorites: z.boolean().optional(),
  artist: z.string().optional(),
  album: z.string().optional(),
  genre: z.string().optional(),
  year: z.number().optional(),
  year_min: z.number().optional(),
  year_max: z.number().optional(),
  rating_min: z.number().optional(),
  rating_max: z.number().optional(),
  title_search: z.string().optional(),
  tags: z.array(z.string()).optional(),
  has_thumbnail: z.boolean().optional(),
  file_format: z.string().optional(),
  duration_min: z.number().optional(),
  duration_max: z.number().optional(),
  created_after: z.string().optional(),
  created_before: z.string().optional(),
  sort_field: z.string().optional(),
  sort_direction: z.enum(["asc", "desc"]).optional(),
});

export type AdminMusicFilters = z.infer<typeof AdminMusicFiltersSchema>;

// Pagination schema
export const AdminPaginationSchema = z.object({
  page: z.number().min(1).optional(),
  page_size: z.number().min(1).max(1000).optional(),
  limit: z.number().min(1).max(1000).optional(),
  offset: z.number().min(0).optional(),
});

export type AdminPagination = z.infer<typeof AdminPaginationSchema>;

// Music list response
export const MusicListResponseSchema = z.object({
  songs: z.array(AdminSongSchema),
  total: z.number(),
  page: z.number().optional(),
  page_size: z.number().optional(),
  total_pages: z.number().optional(),
  has_next: z.boolean(),
  has_prev: z.boolean(),
  filters_applied: AdminMusicFiltersSchema.optional(),
});

export type MusicListResponse = z.infer<typeof MusicListResponseSchema>;

// Bulk operation types
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

// Admin grid state for UI
export interface AdminGridState<T = AdminSong> {
  items: T[];
  total: number;
  loading: boolean;
  error: string | null;
  selectedIds: Set<string>;
  filters: AdminMusicFilters;
  pagination: AdminPagination & { total_pages?: number; has_next?: boolean; has_prev?: boolean };
  sortField: string | null;
  sortDirection: "asc" | "desc" | null;
}

// Selection system types
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

// Event registry types
export interface EventRegistry {
  register: (
    element: HTMLElement | Document,
    type: string,
    handler: (event: Event) => void,
    options?: AddEventListenerOptions
  ) => void;
  cleanup: () => void;
}

// Filter option for dropdowns
export const FilterOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  count: z.number(),
});

export type FilterOption = z.infer<typeof FilterOptionSchema>;

// Advanced filter metadata
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

// Update request schemas
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

// API response for bulk operations
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
