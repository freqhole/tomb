// transport type cache - tracks which remotes use P2P vs HTTP
// separate file to avoid circular dependency between blobResolver and blobCache

import { getRemoteById } from "../../../app/services/remotes/remoteManager";
import { isCharnelAvailable } from "../../../app/api/client";
import { getPendingRemoteById } from "../../../app/services/storage/db";
import { debug } from "../../../utils/logger";

// sync cache of remote transport info - populated on first async lookup
// allows sync check of whether a remote uses transport-based blob fetching
interface TransportCacheEntry {
  transport: "http" | "wasm" | "app";
  isCharnelManaged: boolean;
}
const transportTypeCache = new Map<string, TransportCacheEntry>();

function pendingIdFromRemoteId(remoteId: string): string | null {
  if (!remoteId.startsWith("pending-")) return null;
  const id = remoteId.slice("pending-".length).trim();
  return id.length > 0 ? id : null;
}

async function getTransportEntry(remoteId: string): Promise<TransportCacheEntry | null> {
  const remote = await getRemoteById(remoteId);
  if (remote) {
    const entry: TransportCacheEntry = {
      transport: remote.transport,
      isCharnelManaged: remote.is_charnel_managed ?? false,
    };
    transportTypeCache.set(remoteId, entry);
    return entry;
  }

  const pendingId = pendingIdFromRemoteId(remoteId);
  if (!pendingId) return null;

  const pending = await getPendingRemoteById(pendingId);
  if (!pending) return null;

  const entry: TransportCacheEntry = {
    transport: pending.transport,
    isCharnelManaged: false,
  };
  transportTypeCache.set(remoteId, entry);
  return entry;
}

/**
 * check if a remote uses transport-based blob fetching (P2P or tauri-managed).
 * returns undefined if not yet cached (need async lookup).
 */
export function isP2PRemoteSync(remoteId: string): boolean | undefined {
  const cached = transportTypeCache.get(remoteId);
  if (cached === undefined) return undefined;
  // both P2P (wasm/app) and tauri-managed remotes use transport for blobs
  return cached.transport === "wasm" || cached.transport === "app" || cached.isCharnelManaged;
}

/**
 * check if a remote is tauri-managed (local files, always available).
 * returns undefined if not yet cached (need async lookup).
 */
export function isCharnelManagedRemoteSync(remoteId: string): boolean | undefined {
  const cached = transportTypeCache.get(remoteId);
  if (cached === undefined) return undefined;
  return cached.isCharnelManaged;
}

/**
 * cache a remote's transport info for future sync lookups.
 */
export function cacheTransportType(remoteId: string, transport: "http" | "wasm" | "app", isCharnelManaged: boolean = false) {
  transportTypeCache.set(remoteId, { transport, isCharnelManaged });
}

/**
 * eagerly cache transport info for a remote.
 * call this when switching to a remote to ensure sync lookups work immediately.
 */
export async function preCacheRemoteTransport(remoteId: string): Promise<void> {
  const entry = await getTransportEntry(remoteId);
  if (!entry) return;
  cacheTransportType(remoteId, entry.transport, entry.isCharnelManaged);
  debug(
    "transportCache",
    `pre-cached transport for ${remoteId}: ${entry.transport}, tauri-managed: ${entry.isCharnelManaged}`,
  );
}

/**
 * check if a remote uses P2P transport (wasm or app) OR is charnel-managed.
 * both types use transport-based blob fetching (not direct HTTP URLs).
 * also caches the result for future sync lookups.
 */
export async function isP2PRemote(remoteId: string): Promise<boolean> {
  const entry = await getTransportEntry(remoteId);
  if (!entry) return false;
  cacheTransportType(remoteId, entry.transport, entry.isCharnelManaged);
  // include charnel-managed HTTP remotes since they also use transport for blobs
  return (
    entry.transport === "wasm" ||
    entry.transport === "app" ||
    (isCharnelAvailable() && entry.isCharnelManaged)
  );
}

/**
 * check if a remote should use the blobResolver for audio/image access.
 * returns true for P2P remotes (wasm/app) and Tauri-managed remotes.
 */
export async function usesBlobResolver(remoteId: string): Promise<boolean> {
  const entry = await getTransportEntry(remoteId);
  if (!entry) return false;
  cacheTransportType(remoteId, entry.transport, entry.isCharnelManaged);
  return (
    entry.transport === "wasm" ||
    entry.transport === "app" ||
    (isCharnelAvailable() && entry.isCharnelManaged)
  );
}

/**
 * get the transport type for a remote.
 * also caches the result for future sync lookups.
 */
export async function getRemoteTransportType(
  remoteId: string,
): Promise<"http" | "wasm" | "app" | null> {
  const entry = await getTransportEntry(remoteId);
  if (!entry) return null;
  cacheTransportType(remoteId, entry.transport, entry.isCharnelManaged);
  return entry.transport;
}
