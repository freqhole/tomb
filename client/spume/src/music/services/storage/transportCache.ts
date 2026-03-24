// transport type cache - tracks which remotes use P2P vs HTTP
// separate file to avoid circular dependency between blobResolver and blobCache

import { getRemoteById } from "../../../app/services/remotes/remoteManager";
import { isP2PTransportType, isCharnelAvailable } from "../../../app/api/client";
import { debug } from "../../../utils/logger";

// sync cache of remote transport info - populated on first async lookup
// allows sync check of whether a remote uses transport-based blob fetching
interface TransportCacheEntry {
  transport: "http" | "wasm" | "app";
  isCharnelManaged: boolean;
}
const transportTypeCache = new Map<string, TransportCacheEntry>();

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
  const remote = await getRemoteById(remoteId);
  if (remote) {
    cacheTransportType(remoteId, remote.transport, remote.is_charnel_managed ?? false);
    debug("transportCache", `pre-cached transport for ${remoteId}: ${remote.transport}, tauri-managed: ${remote.is_charnel_managed}`);
  }
}

/**
 * check if a remote uses P2P transport (wasm or app) OR is charnel-managed.
 * both types use transport-based blob fetching (not direct HTTP URLs).
 * also caches the result for future sync lookups.
 */
export async function isP2PRemote(remoteId: string): Promise<boolean> {
  const remote = await getRemoteById(remoteId);
  if (!remote) return false;
  cacheTransportType(remoteId, remote.transport, remote.is_charnel_managed ?? false);
  // include charnel-managed HTTP remotes since they also use transport for blobs
  return isP2PTransportType(remote) || (isCharnelAvailable() && !!remote.is_charnel_managed);
}

/**
 * check if a remote should use the blobResolver for audio/image access.
 * returns true for P2P remotes (wasm/app) and Tauri-managed remotes.
 */
export async function usesBlobResolver(remoteId: string): Promise<boolean> {
  const remote = await getRemoteById(remoteId);
  if (!remote) return false;
  cacheTransportType(remoteId, remote.transport, remote.is_charnel_managed ?? false);
  return isP2PTransportType(remote) || (isCharnelAvailable() && !!remote.is_charnel_managed);
}

/**
 * get the transport type for a remote.
 * also caches the result for future sync lookups.
 */
export async function getRemoteTransportType(
  remoteId: string,
): Promise<"http" | "wasm" | "app" | null> {
  const remote = await getRemoteById(remoteId);
  if (!remote) return null;
  cacheTransportType(remoteId, remote.transport, remote.is_charnel_managed ?? false);
  return remote.transport;
}
