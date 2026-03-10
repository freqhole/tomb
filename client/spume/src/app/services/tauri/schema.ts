/**
 * zod schemas for tauri ↔ spume communication
 *
 * shared types for both commands (invoke) and events (listen)
 */

import { z } from "zod";

// ============================================================================
// command schemas (JS → Rust via invoke)
// ============================================================================

/**
 * freqhole server config returned by get_freqhole_config command
 */
export const FreqholeConfigSchema = z.object({
  /** server unique identifier */
  server_id: z.string(),
  /** server display name */
  server_name: z.string(),
  /** server URL (e.g. http://localhost:8686) */
  server_url: z.string(),
  /** invite code for authentication (used for initial login after setup) */
  invite_code: z.string().optional(),
  /** admin username (used with invite code for authentication) */
  admin_username: z.string().optional(),
  /** whether to disable backdrop blur (performance setting) */
  disable_backdrop_blur: z.boolean().optional(),
});

export type FreqholeConfig = z.infer<typeof FreqholeConfigSchema>;

/**
 * auth invite result from generate_auto_auth_invite command
 */
export const AuthInviteSchema = z.string();

export type AuthInvite = z.infer<typeof AuthInviteSchema>;

// ============================================================================
// event schemas (Rust → JS via emit/listen)
// ============================================================================

/**
 * config changed event - server config was updated, refetch needed
 */
export const ConfigChangedEventSchema = z.object({
  type: z.literal("config-changed"),
  data: z.object({
    message: z.string(),
  }),
});

/**
 * scan progress event - sent during library scan
 */
export const ScanProgressEventSchema = z.object({
  type: z.literal("scan-progress"),
  data: z.object({
    songs_added: z.number(),
    albums_added: z.number(),
    artists_added: z.number(),
    jobs_pending: z.number(),
    jobs_total: z.number(),
  }),
});

/**
 * scan complete event - scan finished
 */
export const ScanCompleteEventSchema = z.object({
  type: z.literal("scan-complete"),
  data: z.object({
    songs_added: z.number(),
    albums_added: z.number(),
    artists_added: z.number(),
  }),
});

/**
 * discriminated union of all event types
 */
export const TauriEventSchema = z.discriminatedUnion("type", [
  ConfigChangedEventSchema,
  ScanProgressEventSchema,
  ScanCompleteEventSchema,
]);

export type TauriEvent = z.infer<typeof TauriEventSchema>;
export type ConfigChangedEvent = z.infer<typeof ConfigChangedEventSchema>;
export type ScanProgressEvent = z.infer<typeof ScanProgressEventSchema>;
export type ScanCompleteEvent = z.infer<typeof ScanCompleteEventSchema>;
