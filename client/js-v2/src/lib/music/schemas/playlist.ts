import { z } from "zod";

// UUID string pattern validation
const UuidSchema = z.string().uuid();

export const PlaylistSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  is_public: z.boolean(),
  is_collaborative: z.boolean(),
  song_count: z.number().nullable(),
  visibility: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  media_blob_id: z.string().nullable(),
  thumbnail_blob_id: z.string().nullable(),
});

export type Playlist = z.infer<typeof PlaylistSchema>;

// Response schemas for API endpoints
export const PlaylistListResponseSchema = z.object({
  playlists: z.array(PlaylistSchema),
  total: z.number(),
  page: z.number().optional(),
  page_size: z.number().optional(),
  total_pages: z.number().optional(),
  has_next: z.boolean(),
  has_prev: z.boolean(),
});

export type PlaylistListResponse = z.infer<typeof PlaylistListResponseSchema>;

// Playlist creation request
export const CreatePlaylistRequestSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  is_public: z.boolean(),
  is_collaborative: z.boolean(),
  song_ids: z.array(z.string()).optional(),
  media_blob_id: z.string().nullable().optional(),
  thumbnail_blob_id: z.string().nullable().optional(),
});

export type CreatePlaylistRequest = z.infer<typeof CreatePlaylistRequestSchema>;

// Playlist update request
export const UpdatePlaylistRequestSchema = z.object({
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  is_public: z.boolean().optional(),
  is_collaborative: z.boolean().optional(),
  media_blob_id: z.string().nullable().optional(),
  thumbnail_blob_id: z.string().nullable().optional(),
});

export type UpdatePlaylistRequest = z.infer<typeof UpdatePlaylistRequestSchema>;

// Add songs to playlist request
export const AddSongsToPlaylistRequestSchema = z.object({
  song_ids: z.array(z.string()),
});

export type AddSongsToPlaylistRequest = z.infer<
  typeof AddSongsToPlaylistRequestSchema
>;

// Remove songs from playlist request
export const RemoveSongsFromPlaylistRequestSchema = z.object({
  song_ids: z.array(z.string()),
});

export type RemoveSongsFromPlaylistRequest = z.infer<
  typeof RemoveSongsFromPlaylistRequestSchema
>;

// Move song in playlist request
export const MoveSongRequestSchema = z.object({
  song_id: z.string(),
  to_position: z.number(),
});

export type MoveSongRequest = z.infer<typeof MoveSongRequestSchema>;

// Reorder playlist request
export const ReorderPlaylistRequestSchema = z.object({
  song_ids: z.array(z.string()),
});

export type ReorderPlaylistRequest = z.infer<
  typeof ReorderPlaylistRequestSchema
>;

// Create playlist from album request
export const CreatePlaylistFromAlbumRequestSchema = z.object({
  title: z.string(),
  is_public: z.boolean(),
});

export type CreatePlaylistFromAlbumRequest = z.infer<
  typeof CreatePlaylistFromAlbumRequestSchema
>;

// Playlist summary response
export const PlaylistSummaryResponseSchema = z.object({
  playlist: PlaylistSchema,
  song_count: z.number(),
  total_duration: z.number(),
  song_preview: z.array(z.string()),
});

export type PlaylistSummaryResponse = z.infer<
  typeof PlaylistSummaryResponseSchema
>;

// Playlist preference schemas
export const PlaylistPreferenceResponseSchema = z.object({
  user_id: UuidSchema,
  playlist_id: UuidSchema,
  is_favorite: z.boolean(),
  updated_at: z.string(),
});

export type PlaylistPreferenceResponse = z.infer<
  typeof PlaylistPreferenceResponseSchema
>;

// Playlist with user context response
export const PlaylistWithUserContextResponseSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  song_count: z.number(),
  total_duration_seconds: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  user_is_favorite: z.boolean(),
  preference_updated_at: z.string().nullable(),
  is_owned_by_user: z.boolean(),
  owner_user_id: UuidSchema.nullable(),
  ownership_created_at: z.string().nullable(),
});

export type PlaylistWithUserContextResponse = z.infer<
  typeof PlaylistWithUserContextResponseSchema
>;

// Album favorite status response
export const AlbumFavoriteStatusResponseSchema = z.object({
  album: z.string(),
  total_songs: z.number(),
  favorited_songs: z.number(),
  is_fully_favorited: z.boolean(),
});

export type AlbumFavoriteStatusResponse = z.infer<
  typeof AlbumFavoriteStatusResponseSchema
>;
