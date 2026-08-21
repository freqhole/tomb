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
 * device linked event - server registered this app's node_id after passkey link flow
 */
export const DeviceLinkedEventSchema = z.object({
  type: z.literal("device-linked"),
  data: z.object({
    /** the server's own peer_addr (node_id) - use to auto-add remote */
    peer_addr: z.string(),
    /** server display name */
    server_name: z.string(),
  }),
});

/**
 * knock accepted event - remote server accepted our knock request
 */
export const KnockAcceptedEventSchema = z.object({
  type: z.literal("knock-accepted"),
  data: z.object({
    /** the server's own peer_addr (node_id) - use to auto-add remote */
    peer_addr: z.string(),
    /** server display name */
    server_name: z.string(),
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
 * external-storage-mounted-changed event - a removable-storage device was
 * mounted or unmounted (rust-side disk-arbitration/udev watcher). spume
 * should refetch mounted/active device state.
 */
export const ExternalStorageMountedChangedEventSchema = z.object({
  type: z.literal("external-storage-mounted-changed"),
  data: z.object({}),
});

/**
 * external-storage-sync-progress event - per-song progress during a
 * removable-storage sync (phase 5 progress ui).
 */
export const ExternalStorageSyncProgressEventSchema = z.object({
  type: z.literal("external-storage-sync-progress"),
  data: z.object({
    device_id: z.string(),
    title: z.string(),
    current: z.number(),
    total: z.number(),
  }),
});

/**
 * discriminated union of all event types
 */
export const UpdateCheckResultEventSchema = z.object({
  type: z.literal("update-check-result"),
  data: z.object({
    update_available: z.boolean(),
    current_version: z.string(),
    latest_version: z.string().optional(),
    download_url: z.string(),
    error: z.string().optional(),
  }),
});

export const TauriEventSchema = z.discriminatedUnion("type", [
  ConfigChangedEventSchema,
  ServerImageUpdatedEventSchema,
  ScanProgressEventSchema,
  ScanCompleteEventSchema,
  KnockCreatedEventSchema,
  PeerOfflineEventSchema,
  DeviceLinkedEventSchema,
  KnockAcceptedEventSchema,
  ShareLinkReceivedEventSchema,
  UpdateCheckResultEventSchema,
  ExternalStorageMountedChangedEventSchema,
  ExternalStorageSyncProgressEventSchema,
]);

export type TauriEvent = z.infer<typeof TauriEventSchema>;
export type ConfigChangedEvent = z.infer<typeof ConfigChangedEventSchema>;
export type ServerImageUpdatedEvent = z.infer<typeof ServerImageUpdatedEventSchema>;
export type ScanProgressEvent = z.infer<typeof ScanProgressEventSchema>;
export type ScanCompleteEvent = z.infer<typeof ScanCompleteEventSchema>;
export type KnockCreatedEvent = z.infer<typeof KnockCreatedEventSchema>;
export type PeerOfflineEvent = z.infer<typeof PeerOfflineEventSchema>;
export type DeviceLinkedEvent = z.infer<typeof DeviceLinkedEventSchema>;
export type KnockAcceptedEvent = z.infer<typeof KnockAcceptedEventSchema>;
export type ShareLinkReceivedEvent = z.infer<typeof ShareLinkReceivedEventSchema>;
export type UpdateCheckResultEvent = z.infer<typeof UpdateCheckResultEventSchema>;
export type ExternalStorageMountedChangedEvent = z.infer<
  typeof ExternalStorageMountedChangedEventSchema
>;
export type ExternalStorageSyncProgressEvent = z.infer<
  typeof ExternalStorageSyncProgressEventSchema
>;
