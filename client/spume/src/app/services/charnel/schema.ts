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
  /** server display name */
  server_name: z.string(),
  /** server URL (e.g. http://localhost:8686) */
  server_url: z.string(),
  /** absolute file path of server image (for convertFileSrc) */
  server_image_path: z.string().nullish(),
  /** whether to disable backdrop blur (performance setting) */
  disable_backdrop_blur: z.boolean().optional(),
  /** whether to sync queue songs from remotes to local library (default: true) */
  sync_queue_to_local: z.boolean().optional(),
});

export type FreqholeConfig = z.infer<typeof FreqholeConfigSchema>;

/**
 * config upgrade status from check_config_needs_upgrade command
 */
export const ConfigUpgradeStatusSchema = z.object({
  /** true if config version differs from binary version */
  needs_upgrade: z.boolean(),
  /** version in config file */
  config_version: z.string(),
  /** version of this binary */
  binary_version: z.string(),
});

export type ConfigUpgradeStatus = z.infer<typeof ConfigUpgradeStatusSchema>;

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
 * server image updated event - refresh remote icon silently
 */
export const ServerImageUpdatedEventSchema = z.object({
  type: z.literal("server-image-updated"),
  data: z.object({}),
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
    // rescan-only fields (optional, only present from rescan jobs)
    blobs_deleted: z.number().optional(),
    restored_blobs: z.number().optional(),
    restored_songs: z.number().optional(),
    purged_scan_dirs: z.number().optional(),
  }),
});

/**
 * knock created event - new federation knock request received
 */
export const KnockCreatedEventSchema = z.object({
  type: z.literal("knock-created"),
  data: z.object({
    id: z.string(),
    username: z.string(),
    node_id: z.string(),
    message: z.string().optional(),
  }),
});

/**
 * peer offline event - P2P connection to a peer failed
 */
export const PeerOfflineEventSchema = z.object({
  type: z.literal("peer-offline"),
  data: z.object({
    peer_addr: z.string(),
    reason: z.string(),
  }),
});

/**
 * job progress event - emitted after import jobs complete
 */
export const JobProgressEventSchema = z.object({
  type: z.literal("job-progress"),
  data: z.object({
    session_id: z.string(),
    directory: z.string(),
    songs_added: z.number(),
    jobs_pending: z.number(),
    jobs_total: z.number(),
  }),
});

/**
 * job session complete event - all jobs in session finished
 */
export const JobSessionCompleteEventSchema = z.object({
  type: z.literal("job-session-complete"),
  data: z.object({
    session_id: z.string(),
    songs_added: z.number(),
    albums_added: z.number(),
    artists_added: z.number(),
  }),
});

/**
 * deep-link share-link received event — user opened a `freqhole://o/<token>`
 * url while the app was running. spume routes it through the same
 * ResolveShareModal flow used for `https://...#?share=<token>` urls.
 */
export const ShareLinkReceivedEventSchema = z.object({
  type: z.literal("share-link-received"),
  data: z.object({
    /** full url the os handed off, e.g. `freqhole://o/<token>`. */
    url: z.string(),
  }),
});

/**
 * discriminated union of all event types
 */
export const TauriEventSchema = z.discriminatedUnion("type", [
  ConfigChangedEventSchema,
  ServerImageUpdatedEventSchema,
  ScanProgressEventSchema,
  ScanCompleteEventSchema,
  KnockCreatedEventSchema,
  PeerOfflineEventSchema,
  JobProgressEventSchema,
  JobSessionCompleteEventSchema,
  ShareLinkReceivedEventSchema,
]);

export type TauriEvent = z.infer<typeof TauriEventSchema>;
export type ConfigChangedEvent = z.infer<typeof ConfigChangedEventSchema>;
export type ServerImageUpdatedEvent = z.infer<typeof ServerImageUpdatedEventSchema>;
export type ScanProgressEvent = z.infer<typeof ScanProgressEventSchema>;
export type ScanCompleteEvent = z.infer<typeof ScanCompleteEventSchema>;
export type KnockCreatedEvent = z.infer<typeof KnockCreatedEventSchema>;
export type PeerOfflineEvent = z.infer<typeof PeerOfflineEventSchema>;
export type JobProgressEvent = z.infer<typeof JobProgressEventSchema>;
export type JobSessionCompleteEvent = z.infer<typeof JobSessionCompleteEventSchema>;
export type ShareLinkReceivedEvent = z.infer<typeof ShareLinkReceivedEventSchema>;
