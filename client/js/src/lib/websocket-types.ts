/**
 * WebSocket message types and Zod schemas for type-safe communication
 *
 * These types mirror the Rust serde types on the server side to ensure
 * consistent message format between client and server.
 */

import { z } from "zod";

// Base schemas
const UuidSchema = z.string().uuid();
const DateTimeSchema = z.string().datetime();

/**
 * Notification channel enum matching server-side NotificationChannel
 */
export const NotificationChannelSchema = z.enum([
  "MediaBlobs",
  "ThumbnailJobs",
  "UserAuth",
  "System",
  "Analytics",
]);

export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

/**
 * Media blob data structure matching the server-side MediaBlob
 */
export const MediaBlobSchema = z.object({
  id: UuidSchema,
  data: z.array(z.number()).optional(), // Vec<u8> as number array, often omitted
  sha256: z.string(),
  size: z.number().int().optional(),
  mime: z.string().optional(),
  source_client_id: z.string().optional(),
  local_path: z.string().nullish(),
  metadata: z.record(z.any()).default({}), // JSONB as Record<string, any>
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
  // Thumbnail support
  parent_blob_id: UuidSchema.optional(),
  blob_type: z
    .enum(["original", "thumbnail", "waveform", "preview"])
    .default("original"),
  thumbnail_data: z.array(z.number()).optional(), // Thumbnail blob data when available
});

export type MediaBlob = z.infer<typeof MediaBlobSchema>;

/**
 * Song data structure matching the server-side Song
 */
export const SongSchema = z.object({
  id: UuidSchema,
  media_blob_id: UuidSchema,
  thumbnail_blob_id: UuidSchema.optional(),
  waveform_blob_id: UuidSchema.optional(),
  title: z.string(),
  artist: z.string().optional(),
  album: z.string().optional(),
  album_artist: z.string().optional(),
  track_number: z.number().int().optional(),
  disc_number: z.number().int().optional(),
  duration: z.string().optional(), // PgInterval as ISO duration string
  genre: z.string().optional(),
  year: z.number().int().optional(),
  bpm: z.number().int().optional(),
  key_signature: z.string().optional(),
  rating: z.number().int().optional(),
  is_favorite: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.any()).default({}),
  deleted_at: DateTimeSchema.optional(),
  deleted_by: UuidSchema.optional(),
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
  version: z.number().int(),
});

export type Song = z.infer<typeof SongSchema>;

/**
 * Playlist data structure matching the server-side Playlist
 */
export const PlaylistSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  description: z.string().optional(),
  client_id: z.string().optional(),
  is_public: z.boolean().default(false),
  is_collaborative: z.boolean().default(false),
  metadata: z.record(z.any()).default({}),
  deleted_at: DateTimeSchema.optional(),
  deleted_by: UuidSchema.optional(),
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
  version: z.number().int(),
});

export type Playlist = z.infer<typeof PlaylistSchema>;

/**
 * PlaylistSong data structure matching the server-side PlaylistSong
 */
export const PlaylistSongSchema = z.object({
  id: UuidSchema,
  playlist_id: UuidSchema,
  song_id: UuidSchema,
  position: z.number().int(),
  created_at: DateTimeSchema,
  added_by_client_id: z.string().optional(),
  metadata: z.record(z.any()).default({}),
});

export type PlaylistSong = z.infer<typeof PlaylistSongSchema>;

/**
 * Messages sent from client to server
 */
export const WebSocketMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("Ping"),
  }),
  z.object({
    type: z.literal("GetMediaBlobs"),
    data: z
      .object({
        limit: z.number().int().positive().optional(),
        offset: z.number().int().min(0).optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("UploadMediaBlob"),
    data: z.object({
      blob: MediaBlobSchema,
    }),
  }),
  z.object({
    type: z.literal("GetMediaBlob"),
    data: z.object({
      id: UuidSchema,
    }),
  }),
  z.object({
    type: z.literal("GetMediaBlobData"),
    data: z.object({
      id: UuidSchema,
    }),
  }),
  z.object({
    type: z.literal("SubscribeToNotifications"),
    data: z.object({
      channel: NotificationChannelSchema,
    }),
  }),
  z.object({
    type: z.literal("UnsubscribeFromNotifications"),
    data: z.object({
      channel: NotificationChannelSchema,
    }),
  }),
  z.object({
    type: z.literal("GetNotificationStatus"),
  }),
  z.object({
    type: z.literal("GetThumbnails"),
    data: z.object({
      media_blob_id: UuidSchema,
    }),
  }),
  z.object({
    type: z.literal("GetSongs"),
    data: z
      .object({
        limit: z.number().int().positive().optional(),
        offset: z.number().int().min(0).optional(),
        artist: z.string().optional(),
        album: z.string().optional(),
        favorites_only: z.boolean().optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("GetSong"),
    data: z.object({
      id: UuidSchema,
    }),
  }),
  z.object({
    type: z.literal("GetPlaylists"),
    data: z
      .object({
        limit: z.number().int().positive().optional(),
        offset: z.number().int().min(0).optional(),
        public_only: z.boolean().optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("GetPlaylist"),
    data: z.object({
      id: UuidSchema,
    }),
  }),
  z.object({
    type: z.literal("GetPlaylistSongs"),
    data: z.object({
      playlist_id: UuidSchema,
    }),
  }),
]);

export type WebSocketMessage = z.infer<typeof WebSocketMessageSchema>;

/**
 * Messages sent from server to client
 */
export const WebSocketResponseSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("Welcome"),
    data: z.object({
      message: z.string(),
      user_id: UuidSchema.optional(),
      connection_id: z.string(),
    }),
  }),
  z.object({
    type: z.literal("Pong"),
  }),
  z.object({
    type: z.literal("MediaBlobs"),
    data: z.object({
      blobs: z.array(MediaBlobSchema),
      total_count: z.number().int().min(0),
    }),
  }),
  z.object({
    type: z.literal("MediaBlob"),
    data: z.object({
      blob: MediaBlobSchema,
    }),
  }),
  z.object({
    type: z.literal("MediaBlobData"),
    data: z.object({
      id: UuidSchema,
      data: z.array(z.number()),
      mime: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("Error"),
    data: z.object({
      message: z.string(),
      code: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("ConnectionStatus"),
    data: z.object({
      connected: z.boolean(),
      user_count: z.number().int().min(0),
    }),
  }),
  z.object({
    type: z.literal("Notification"),
    data: z.object({
      id: UuidSchema,
      channel: NotificationChannelSchema,
      event_type: z.string(),
      payload: z.any(),
      priority: z.string(),
      timestamp: DateTimeSchema,
    }),
  }),
  z.object({
    type: z.literal("NotificationSubscribed"),
    data: z.object({
      channel: NotificationChannelSchema,
    }),
  }),
  z.object({
    type: z.literal("NotificationUnsubscribed"),
    data: z.object({
      channel: NotificationChannelSchema,
    }),
  }),
  z.object({
    type: z.literal("NotificationStatus"),
    data: z.object({
      subscribed_channels: z.array(NotificationChannelSchema),
      connection_id: z.string(),
      is_authenticated: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal("Thumbnails"),
    data: z.object({
      media_blob_id: UuidSchema,
      thumbnails: z.array(MediaBlobSchema),
    }),
  }),
  z.object({
    type: z.literal("Songs"),
    data: z.object({
      songs: z.array(SongSchema),
      total_count: z.number().int().min(0),
    }),
  }),
  z.object({
    type: z.literal("Song"),
    data: z.object({
      song: SongSchema,
    }),
  }),
  z.object({
    type: z.literal("Playlists"),
    data: z.object({
      playlists: z.array(PlaylistSchema),
      total_count: z.number().int().min(0),
    }),
  }),
  z.object({
    type: z.literal("Playlist"),
    data: z.object({
      playlist: PlaylistSchema,
    }),
  }),
  z.object({
    type: z.literal("PlaylistSongs"),
    data: z.object({
      playlist_id: UuidSchema,
      songs: z.array(PlaylistSongSchema),
    }),
  }),
]);

export type WebSocketResponse = z.infer<typeof WebSocketResponseSchema>;

/**
 * Connection status for presence indication
 */
export enum ConnectionStatus {
  Disconnected = "disconnected", // Red light
  Connecting = "connecting", // Yellow light
  Connected = "connected", // Green light
  Error = "error", // Red light with error
}

/**
 * Helper functions for message creation and validation
 */
export const createMessage = {
  ping: (): WebSocketMessage => ({ type: "Ping" }),

  getMediaBlobs: (limit?: number, offset?: number): WebSocketMessage => ({
    type: "GetMediaBlobs",
    data: { limit, offset },
  }),

  getMediaBlob: (id: string): WebSocketMessage => ({
    type: "GetMediaBlob",
    data: { id },
  }),

  getMediaBlobData: (id: string): WebSocketMessage => ({
    type: "GetMediaBlobData",
    data: { id },
  }),

  uploadMediaBlob: (blob: MediaBlob): WebSocketMessage => ({
    type: "UploadMediaBlob",
    data: { blob },
  }),

  subscribeToNotifications: (
    channel: NotificationChannel
  ): WebSocketMessage => ({
    type: "SubscribeToNotifications",
    data: { channel },
  }),

  unsubscribeFromNotifications: (
    channel: NotificationChannel
  ): WebSocketMessage => ({
    type: "UnsubscribeFromNotifications",
    data: { channel },
  }),

  getNotificationStatus: (): WebSocketMessage => ({
    type: "GetNotificationStatus",
  }),

  getThumbnails: (mediaBlobId: string): WebSocketMessage => ({
    type: "GetThumbnails",
    data: { media_blob_id: mediaBlobId },
  }),

  getSongs: (options?: {
    limit?: number;
    offset?: number;
    artist?: string;
    album?: string;
    favorites_only?: boolean;
  }): WebSocketMessage => ({
    type: "GetSongs",
    data: options,
  }),

  getSong: (id: string): WebSocketMessage => ({
    type: "GetSong",
    data: { id },
  }),

  getPlaylists: (options?: {
    limit?: number;
    offset?: number;
    public_only?: boolean;
  }): WebSocketMessage => ({
    type: "GetPlaylists",
    data: options,
  }),

  getPlaylist: (id: string): WebSocketMessage => ({
    type: "GetPlaylist",
    data: { id },
  }),

  getPlaylistSongs: (playlistId: string): WebSocketMessage => ({
    type: "GetPlaylistSongs",
    data: { playlist_id: playlistId },
  }),
};

/**
 * Utility functions for message parsing and validation
 */
export const parseWebSocketMessage = (data: unknown): WebSocketMessage => {
  return WebSocketMessageSchema.parse(data);
};

export const parseWebSocketResponse = (data: unknown): WebSocketResponse => {
  return WebSocketResponseSchema.parse(data);
};

/**
 * Safe message parsing that returns error instead of throwing
 */
export const safeParseWebSocketResponse = (
  data: unknown
):
  | { success: true; data: WebSocketResponse }
  | { success: false; error: z.ZodError } => {
  const result = WebSocketResponseSchema.safeParse(data);
  return result;
};

/**
 * Type guards for response types
 */
export const isWelcomeMessage = (
  response: WebSocketResponse
): response is Extract<WebSocketResponse, { type: "Welcome" }> => {
  return response.type === "Welcome";
};

export const isMediaBlobsMessage = (
  response: WebSocketResponse
): response is Extract<WebSocketResponse, { type: "MediaBlobs" }> => {
  return response.type === "MediaBlobs";
};

export const isSongsMessage = (
  response: WebSocketResponse
): response is Extract<WebSocketResponse, { type: "Songs" }> => {
  return response.type === "Songs";
};

export const isSongMessage = (
  response: WebSocketResponse
): response is Extract<WebSocketResponse, { type: "Song" }> => {
  return response.type === "Song";
};

export const isPlaylistsMessage = (
  response: WebSocketResponse
): response is Extract<WebSocketResponse, { type: "Playlists" }> => {
  return response.type === "Playlists";
};

export const isPlaylistMessage = (
  response: WebSocketResponse
): response is Extract<WebSocketResponse, { type: "Playlist" }> => {
  return response.type === "Playlist";
};

export const isPlaylistSongsMessage = (
  response: WebSocketResponse
): response is Extract<WebSocketResponse, { type: "PlaylistSongs" }> => {
  return response.type === "PlaylistSongs";
};

export const isErrorMessage = (
  response: WebSocketResponse
): response is Extract<WebSocketResponse, { type: "Error" }> => {
  return response.type === "Error";
};

export const isConnectionStatusMessage = (
  response: WebSocketResponse
): response is Extract<WebSocketResponse, { type: "ConnectionStatus" }> => {
  return response.type === "ConnectionStatus";
};

export const isMediaBlobMessage = (
  response: WebSocketResponse
): response is Extract<WebSocketResponse, { type: "MediaBlob" }> => {
  return response.type === "MediaBlob";
};

export const isMediaBlobDataMessage = (
  response: WebSocketResponse
): response is Extract<WebSocketResponse, { type: "MediaBlobData" }> => {
  return response.type === "MediaBlobData";
};

export const isNotificationMessage = (
  response: WebSocketResponse
): response is Extract<WebSocketResponse, { type: "Notification" }> => {
  return response.type === "Notification";
};

export const isNotificationSubscribedMessage = (
  response: WebSocketResponse
): response is Extract<
  WebSocketResponse,
  { type: "NotificationSubscribed" }
> => {
  return response.type === "NotificationSubscribed";
};

export const isNotificationUnsubscribedMessage = (
  response: WebSocketResponse
): response is Extract<
  WebSocketResponse,
  { type: "NotificationUnsubscribed" }
> => {
  return response.type === "NotificationUnsubscribed";
};

export const isNotificationStatusMessage = (
  response: WebSocketResponse
): response is Extract<WebSocketResponse, { type: "NotificationStatus" }> => {
  return response.type === "NotificationStatus";
};

/**
 * Validates and parses incoming WebSocket message with detailed error info
 */
export const validateIncomingMessage = (
  rawData: string
):
  | { success: true; data: WebSocketResponse }
  | { success: false; error: string; details?: unknown } => {
  try {
    const json = JSON.parse(rawData);
    const result = WebSocketResponseSchema.safeParse(json);

    if (result.success) {
      return { success: true, data: result.data };
    } else {
      return {
        success: false,
        error: "Message validation failed",
        details: result.error.flatten(),
      };
    }
  } catch (error) {
    return {
      success: false,
      error: "Invalid JSON",
      details: error instanceof Error ? error.message : String(error),
    };
  }
};

/**
 * Validates outgoing WebSocket message before sending
 */
export const validateOutgoingMessage = (
  message: unknown
):
  | { success: true; data: WebSocketMessage }
  | { success: false; error: string; details?: unknown } => {
  const result = WebSocketMessageSchema.safeParse(message);

  if (result.success) {
    return { success: true, data: result.data };
  } else {
    return {
      success: false,
      error: "Message validation failed",
      details: result.error.flatten(),
    };
  }
};
