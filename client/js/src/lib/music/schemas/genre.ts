import { z } from "zod";

// Individual genre statistics
export const GenreStatSchema = z.object({
  name: z.string(),
  song_count: z.number(),
  album_count: z.number(),
  artist_count: z.number(),
  total_duration: z.number(),
});

export type GenreStat = z.infer<typeof GenreStatSchema>;

// Response for GET /api/music/genres
export const GenreStatsResponseSchema = z.object({
  genres: z.array(GenreStatSchema),
  total: z.number(),
});

export type GenreStatsResponse = z.infer<typeof GenreStatsResponseSchema>;

// Request parameters for POST /api/music/genres
export const GenreSearchRequestSchema = z.object({
  genre: z.string().optional(),
  artist: z.string().optional(),
  q: z.string().optional(),
  tags: z.array(z.string()).optional(),
  sort_by: z.string().optional(),
  sort_direction: z.string().optional(),
  page: z.number().optional(),
  page_size: z.number().optional(),
});

export type GenreSearchRequest = z.infer<typeof GenreSearchRequestSchema>;

// Artist summary within a genre
export const GenreArtistSchema = z.object({
  artist: z.string(),
  song_count: z.number(),
  album_count: z.number(),
  total_duration: z.number(),
  genres: z.array(z.string()),
  avg_rating: z.number().nullable(),
  favorite_count: z.number(),
});

export type GenreArtist = z.infer<typeof GenreArtistSchema>;

// Album summary within a genre/artist
export const GenreAlbumSchema = z.object({
  album: z.string().nullable(),
  artist: z.string().nullable(),
  year: z.number().nullable(),
  track_count: z.number(),
  disc_count: z.number(),
  total_duration: z.string().nullable(),
  genres: z.string().nullable(),
  avg_rating: z.number().nullable(),
  favorite_count: z.number(),
  album_thumbnail_id: z.string().nullable(),
});

export type GenreAlbum = z.infer<typeof GenreAlbumSchema>;

// Response when searching for artists within genres
export const GenreArtistsResponseSchema = z.object({
  artists: z.array(GenreArtistSchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
  total_pages: z.number(),
  has_next: z.boolean(),
  has_prev: z.boolean(),
});

export type GenreArtistsResponse = z.infer<typeof GenreArtistsResponseSchema>;

// Response when searching for albums within genre/artist
export const GenreAlbumsResponseSchema = z.object({
  albums: z.array(GenreAlbumSchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
  total_pages: z.number(),
  has_next: z.boolean(),
  has_prev: z.boolean(),
});

export type GenreAlbumsResponse = z.infer<typeof GenreAlbumsResponseSchema>;

// Unified response for POST /api/music/genres
export const GenreSearchResponseSchema = z.union([
  GenreArtistsResponseSchema,
  GenreAlbumsResponseSchema,
]);

export type GenreSearchResponse = z.infer<typeof GenreSearchResponseSchema>;
