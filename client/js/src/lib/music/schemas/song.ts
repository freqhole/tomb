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
  rating: z.number().nullable(),
  is_favorite: z.boolean(),
  tags: z.array(z.string()),
  display_title: z.string(),
  detailed_display_title: z.string(),
  created_at: z.string(),
  media_blob_id: z.string(),
  thumbnail_blob_id: z.string().nullable(),
  waveform_blob_id: z.string().nullable(),
  thumbnail_blob_ids: z.array(z.string()),
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
