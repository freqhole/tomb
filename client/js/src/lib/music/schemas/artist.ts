import { z } from "zod";

export const ArtistSummarySchema = z.object({
  artist: z.string(),
  song_count: z.number(),
  album_count: z.number(),
  total_duration: z.number(),
  genres: z.array(z.string()),
  avg_rating: z.number().nullable(),
  favorite_count: z.number(),
});

export type ArtistSummary = z.infer<typeof ArtistSummarySchema>;

// Response schemas for API endpoints
export const ArtistsListResponseSchema = z.object({
  artists: z.array(ArtistSummarySchema),
  total: z.number(),
});

export type ArtistsListResponse = z.infer<typeof ArtistsListResponseSchema>;

// Artist songs response (when getting songs for a specific artist)
export const ArtistSongsResponseSchema = z.object({
  songs: z.array(
    z.object({
      id: z.string().uuid(),
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
    })
  ),
  total: z.number().optional(),
  artist: z.string().optional(),
});

export type ArtistSongsResponse = z.infer<typeof ArtistSongsResponseSchema>;
