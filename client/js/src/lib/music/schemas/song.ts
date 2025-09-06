import { z } from "zod";

// UUID string pattern validation
const UuidSchema = z.string().uuid();

export const SongSchema = z.object({
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
  user_rating: z.number().min(1).max(5).nullable(),
  user_is_favorite: z.boolean(),
  tags: z.array(z.string()),
  display_title: z.string(),
  detailed_display_title: z.string(),
  created_at: z.string(),
  media_blob_id: z.string(),
  thumbnail_blob_id: z.string().nullable(),
  waveform_blob_id: z.string().nullable(),
  thumbnail_blob_ids: z.array(z.string()),
  preference_updated_at: z.string().nullable(),
});

export type Song = z.infer<typeof SongSchema>;

export const PlaylistSongSchema = z.object({
  position: z.number(),
  song: SongSchema,
  added_at: z.string(),
});

export type PlaylistSong = z.infer<typeof PlaylistSongSchema>;

export const QueueItemSchema = z.object({
  song: SongSchema,
  id: z.string(),
});

export type QueueItem = z.infer<typeof QueueItemSchema>;

// Response schemas for API endpoints
export const SongListResponseSchema = z.object({
  songs: z.array(SongSchema),
  total: z.number(),
  page: z.number().optional(),
  page_size: z.number().optional(),
  total_pages: z.number().optional(),
  has_next: z.boolean(),
  has_prev: z.boolean(),
});

export type SongListResponse = z.infer<typeof SongListResponseSchema>;

export const PlaylistSongsResponseSchema = z.object({
  playlist: z.object({
    id: UuidSchema,
    title: z.string(),
    description: z.string().nullable(),
    is_public: z.boolean(),
    is_collaborative: z.boolean(),
    song_count: z.number().nullable(),
    visibility: z.string(),
    created_at: z.string(),
  }),
  songs: z.array(PlaylistSongSchema),
});

export type PlaylistSongsResponse = z.infer<typeof PlaylistSongsResponseSchema>;

// Song update request
export const UpdateSongRequestSchema = z.object({
  is_favorite: z.boolean().optional(),
  rating: z.number().optional(),
});

export type UpdateSongRequest = z.infer<typeof UpdateSongRequestSchema>;

// Song update response
export const SongUpdateResponseSchema = z.object({
  message: z.string(),
  song: SongSchema,
});

export type SongUpdateResponse = z.infer<typeof SongUpdateResponseSchema>;

// User preference schemas
export const UpdateUserPreferenceRequestSchema = z.object({
  is_favorite: z.boolean().optional(),
  rating: z.number().min(1).max(5).optional(),
});

export type UpdateUserPreferenceRequest = z.infer<
  typeof UpdateUserPreferenceRequestSchema
>;

export const BulkUpdateUserPreferencesRequestSchema = z.object({
  song_ids: z.array(UuidSchema),
  updates: UpdateUserPreferenceRequestSchema,
});

export type BulkUpdateUserPreferencesRequest = z.infer<
  typeof BulkUpdateUserPreferencesRequestSchema
>;

export const UserPreferenceResponseSchema = z.object({
  user_id: UuidSchema,
  song_id: UuidSchema,
  is_favorite: z.boolean(),
  rating: z.number().min(1).max(5).nullable(),
  updated_at: z.string(),
});

export type UserPreferenceResponse = z.infer<
  typeof UserPreferenceResponseSchema
>;

export const BulkUserPreferenceResponseSchema = z.object({
  message: z.string(),
  updated_preferences: z.array(UserPreferenceResponseSchema),
});

export type BulkUserPreferenceResponse = z.infer<
  typeof BulkUserPreferenceResponseSchema
>;

// Song with user preferences (for user-aware queries)
