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
});

export type MediaBlob = z.infer<typeof MediaBlobSchema>;

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
