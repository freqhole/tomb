// zod schemas for Remote types - centralized validation and type inference
//
// uses discriminated union to distinguish HTTP vs P2P transports.
// includes migration transform for legacy remotes that don't have transport field.

import { z } from "zod";

// ============================================================================
// transport types
// ============================================================================

/** transport type: http for standard REST, wasm/app for P2P */
export type TransportType = "http" | "wasm" | "app";

// ============================================================================
// common fields shared by all remote types
// ============================================================================

const RemoteCommonSchema = z.object({
  remote_id: z.string(),
  name: z.string(),
  is_active: z.boolean(),
  last_connected_at: z.number().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
  // server info (from /api/hello)
  description: z.string().nullable(),
  image_url: z.string().nullable(),
  image_blob_id: z.string().nullable(),
  version: z.string().nullable(),
  last_info_check: z.number().nullable(),
  // optional fields
  api_key: z.string().optional(),
  is_charnel_managed: z.boolean().optional(),
  is_offline: z.boolean().optional(),
  offline_since: z.number().nullable().optional(),
  last_checked: z.number().nullable().optional(),
  // when true, this remote is excluded from all graph visualizations
  // (treated as offline for coloring, drawn with a diagonal slash)
  graph_disabled: z.boolean().optional(),
});

// ============================================================================
// HTTP remote - uses base_url for standard REST transport
// ============================================================================

const HttpRemoteSchema = RemoteCommonSchema.extend({
  transport: z.literal("http"),
  // base_url is required for normal HTTP remotes, but optional for charnel-managed
  // (charnel-managed remotes use IPC dispatch, not HTTP)
  base_url: z.string().optional(),
  peer_addr: z.undefined().optional(), // not used for HTTP
});

export type HttpRemote = z.infer<typeof HttpRemoteSchema>;

// ============================================================================
// P2P remote - uses peer_addr for wasm/app transport
// ============================================================================

const P2PRemoteSchema = RemoteCommonSchema.extend({
  transport: z.enum(["wasm", "app"]),
  peer_addr: z.string().min(1),
  base_url: z.string().optional(), // may be empty string for P2P
});

export type P2PRemote = z.infer<typeof P2PRemoteSchema>;

// ============================================================================
// legacy remote - old format without transport field (for migration)
// ============================================================================

const LegacyRemoteSchema = RemoteCommonSchema.extend({
  base_url: z.string(),
  transport_type: z.enum(["http", "wasm", "app"]).optional(),
  peer_addr: z.string().optional(),
});

// ============================================================================
// discriminated union + migration transform
// ============================================================================

/**
 * infer transport from legacy remote data.
 * - if peer_addr is set and transport_type is wasm/app, it's P2P
 * - otherwise default to HTTP
 */
function inferTransport(
  legacy: z.infer<typeof LegacyRemoteSchema>
): HttpRemote | P2PRemote {
  const isP2P =
    legacy.peer_addr &&
    (legacy.transport_type === "wasm" || legacy.transport_type === "app");

  if (isP2P) {
    return {
      ...legacy,
      transport: legacy.transport_type as "wasm" | "app",
      peer_addr: legacy.peer_addr!,
      base_url: legacy.base_url || undefined,
    };
  }

  return {
    ...legacy,
    transport: "http",
    base_url: legacy.base_url,
    peer_addr: undefined,
  };
}

/**
 * main Remote schema - parses both new discriminated format and legacy format.
 * legacy data is automatically migrated to discriminated union format.
 */
const RemoteSchema = z.union([
  HttpRemoteSchema,
  P2PRemoteSchema,
  // legacy format with transform
  LegacyRemoteSchema.transform(inferTransport),
]);

/** remote type - discriminated union of HTTP and P2P remotes */
export type Remote = HttpRemote | P2PRemote;

// ============================================================================
// helper functions
// ============================================================================

/** type guard for HTTP remotes */
export function isHttpRemote(remote: Remote): remote is HttpRemote {
  return remote.transport === "http";
}

/** type guard for P2P remotes */
export function isP2PRemote(remote: Remote): remote is P2PRemote {
  return remote.transport === "wasm" || remote.transport === "app";
}

/**
 * parse raw IDB data into a Remote.
 * handles both legacy and new formats.
 */
export function parseRemote(raw: unknown): Remote {
  return RemoteSchema.parse(raw);
}

/**
 * safely parse raw IDB data into a Remote.
 * returns undefined if parsing fails or input is nullish.
 */
export function safeParseRemote(raw: unknown): Remote | undefined {
  if (raw == null) return undefined;
  const result = RemoteSchema.safeParse(raw);
  return result.success ? result.data : undefined;
}

/**
 * parse array of raw IDB data into Remotes.
 * filters out any that fail to parse.
 */
export function parseRemotes(rawList: unknown[]): Remote[] {
  return rawList
    .map((r) => safeParseRemote(r))
    .filter((r): r is Remote => r !== undefined);
}

// ============================================================================
// RemoteRef - reference type for API calls
// ============================================================================

/**
 * RemoteRef is a permissive type that accepts both new discriminated format
 * and legacy format. use with resolveTransport/resolveBaseUrl/resolvePeerAddr
 * from client.ts to extract values safely.
 *
 * remote_id and name are optional for transient connections (auth flows, etc.)
 */
export type RemoteRef = {
  remote_id?: string;
  name?: string;
  // new discriminated format
  transport?: TransportType;
  // http fields
  base_url?: string;
  // p2p fields
  peer_addr?: string;
  // legacy field
  transport_type?: TransportType;
  // optional
  api_key?: string;
  // tauri-managed remote (use local dispatch instead of HTTP)
  is_charnel_managed?: boolean;
};

/**
 * convert full Remote to minimal RemoteRef.
 * preserves transport field from discriminated union.
 */
export function toRemoteRef(remote: Remote): RemoteRef {
  if (isHttpRemote(remote)) {
    return {
      remote_id: remote.remote_id,
      name: remote.name,
      transport: "http",
      base_url: remote.base_url,
      api_key: remote.api_key,
      is_charnel_managed: remote.is_charnel_managed,
    };
  }
  return {
    remote_id: remote.remote_id,
    name: remote.name,
    transport: remote.transport,
    peer_addr: remote.peer_addr,
    api_key: remote.api_key,
    is_charnel_managed: remote.is_charnel_managed,
  };
}
