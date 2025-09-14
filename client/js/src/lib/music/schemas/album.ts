import { z } from "zod";

// UUID string pattern validation
const UuidSchema = z.string().uuid();

export const AlbumSchema = z.object({
  album: z.string().nullable(),
  artist: z.string().nullable(),
  year: z.number().nullable(),
  track_count: z.number(),
  disc_count: z.number(),
  total_duration: z.string().nullable(), // formatted string from server
  genres: z.string().nullable(), // single string from server, not array
  avg_rating: z.number().nullable(),
  favorite_count: z.number(),
  album_thumbnail_id: z.string().nullable(),
});

export type Album = z.infer<typeof AlbumSchema>;

// Response schemas for API endpoints
export const AlbumListResponseSchema = z.object({
  albums: z.array(AlbumSchema),
  total: z.number(),
  page: z.number().optional(),
  page_size: z.number().optional(),
  total_pages: z.number().optional(),
  has_next: z.boolean(),
  has_prev: z.boolean(),
});

export type AlbumListResponse = z.infer<typeof AlbumListResponseSchema>;

// Album tracks response (when getting tracks for a specific album)
export const AlbumTracksResponseSchema = z.object({
  album: z.string(),
  artist: z.string().nullable(),
  tracks: z.array(
    z.object({
      song_id: UuidSchema,
      title: z.string(),
      artist: z.string().nullable(),
      disc_number: z.number().nullable(),
      track_number: z.number().nullable(),
      duration: z.number().nullable(),
      genre: z.string().nullable(),
      year: z.number().nullable(),
      rating: z.number().nullable(),
      is_favorite: z.boolean(),
      media_blob_id: z.string(),
      thumbnail_id: z.string().nullable(),
      waveform_id: z.string().nullable(),
      track_display: z.string(),
    })
  ),
});

export type AlbumTracksResponse = z.infer<typeof AlbumTracksResponseSchema>;

// Albums filtering request schema
export const AlbumsFilterRequestSchema = z.object({
  tags: z.array(z.string()).optional(),
  query: z.string().optional(),
  artist: z.string().optional(),
  year_min: z.number().optional(),
  year_max: z.number().optional(),
  page: z.number().optional(),
  page_size: z.number().optional(),
  sort_by: z.string().optional(),
  sort_direction: z.string().optional(),
});

export type AlbumsFilterRequest = z.infer<typeof AlbumsFilterRequestSchema>;

// Albums filtering response schema
export const AlbumsFilterResponseSchema = z.object({
  albums: z.array(AlbumSchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
  total_pages: z.number(),
  has_next: z.boolean(),
  has_prev: z.boolean(),
});

export type AlbumsFilterResponse = z.infer<typeof AlbumsFilterResponseSchema>;
