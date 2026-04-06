/**
 * utilities for file picking, uploading, blob data fetching, snatch,
 * and save-to-disk in the skein widget system.
 *
 * supports two runtime modes:
 * - Tauri mode: native file dialogs + IPC invoke for uploads
 * - browser mode: hidden <input> file picker (upload requires Tauri)
 *
 * thumbnail fetching has a P2P fallback: when the blob isn't available
 * locally (e.g. a peer uploaded it), we proxy the thumbnail request
 * through connected canvas peers via p2p_proxy_request.
 *
 * snatch: download a full blob from a canvas peer via iroh-blobs verified
 * transfer, then ingest it into the local grimoire (creating a media_blobz
 * entry, domain entity, and thumbnail job).
 *
 * save to disk: export a locally-stored blob to a user-chosen filesystem
 * path via the native save dialog.
 */

import { isTauriMode } from "../p2p/tauri-transport";

const TAG = "[file-utils]";

const PEER_TIMEOUT_MS = 8000;

async function withPeerTimeout<T>(promise: Promise<T>, ms = PEER_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("peer timeout")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

/** result from picking a file */
export interface PickedFile {
  /** file path (Tauri mode only — null in browser mode) */
  path: string | null;
  /** filename with extension */
  filename: string;
  /** file size in bytes (0 when unknown, e.g. Tauri mode before upload) */
  size: number;
  /** the raw File object (browser mode only — null in Tauri mode) */
  file: File | null;
}

/** result from uploading a file */
export interface FileUploadResult {
  blobId: string;
  domain: string;
  entityId: string;
  jobId: string | null;
  sha256: string;
  blake3: string | null;
  size: number;
  mime: string;
  existing: boolean;
  /** embedded thumbnail data URL (browser-generated or fetched from grimoire) */
  thumbnailDataUrl?: string | null;
}

/** blob locality — whether the blob exists in the local grimoire DB */
export type BlobLocality = "local" | "remote" | "unknown";

/** result from checking blob locality */
export interface BlobLocalityInfo {
  /** whether the blob is in the local grimoire DB */
  locality: BlobLocality;
  /** blob metadata (only present when local) */
  metadata?: {
    id: string;
    mime?: string;
    filename?: string;
    size?: number;
    blake3?: string;
    /** blob-level metadata JSON — check source field for snatch detection */
    blobMetadata?: Record<string, unknown>;
  };
}

/** metadata about a blob needed for snatch operations */
export interface SnatchBlobInfo {
  blobId: string;
  filename: string;
  mime: string;
  size: number;
  blake3: string;
  domain: string;
}

/** options for snatch operations */
export interface SnatchOptions {
  /** called with progress updates during download (0.0 to 1.0, or -1 if total unknown) */
  onProgress?: (fraction: number) => void;
}

/** options for file upload */
export interface UploadOptions {
  title?: string;
  description?: string;
  metadata?: string;
  /** wait for thumbnail job to complete before returning (default: true) */
  waitForCompletion?: boolean;
}

/** options for thumbnail fetching */
export interface ThumbnailOptions {
  /** thumbnail size in pixels (default: 200) */
  size?: number;
  /** canvas peers to try for P2P fallback — keys are peer IDs, values have nodeId */
  peers?: Record<string, { nodeId: string }>;
}

/** peers map type — extracted for reuse across functions */
export type PeersMap = Record<string, { nodeId: string }>;

// ---------------------------------------------------------------------------
// peer node ID helper (cached)
// ---------------------------------------------------------------------------

let _cachedLocalNodeId: string | null | undefined = undefined;

async function getLocalNodeId(): Promise<string | null> {
  if (_cachedLocalNodeId !== undefined) return _cachedLocalNodeId;
  try {
    const { getStoredIdentity } = await import("../p2p/identity");
    const identity = await getStoredIdentity();
    _cachedLocalNodeId = identity?.node_id ?? null;
  } catch {
    _cachedLocalNodeId = null;
  }
  return _cachedLocalNodeId;
}

/** extract peer node IDs from the peers map, filtering out the local node */
async function getPeerNodeIds(
  peers: PeersMap | Record<string, { nodeId: string }>
): Promise<string[]> {
  const localNodeId = await getLocalNodeId();
  return Object.values(peers)
    .map((p) => p.nodeId)
    .filter((id): id is string => Boolean(id) && id !== localNodeId);
}

// ---------------------------------------------------------------------------
// tauri bridge helper
// ---------------------------------------------------------------------------

/**
 * invoke a Tauri command. lazily imports @tauri-apps/api/core so the module
 * can be parsed even when Tauri is not present.
 */
async function tauriInvoke(cmd: string, args: Record<string, unknown>): Promise<any> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(cmd, args);
}

// ---------------------------------------------------------------------------
// thumbnail cache
// ---------------------------------------------------------------------------

/**
 * in-memory cache of fetched thumbnails. keyed by "blobId:size".
 * survives for the session — cleared on page reload.
 * avoids redundant local + P2P fetches when widgets re-render.
 */
const thumbnailCache = new Map<string, string>();

/** session-scoped locality cache — avoids repeated IDB lookups for blobs we already know are local */
const localityCache = new Map<string, BlobLocalityInfo>();

function cacheKey(blobId: string, size: number): string {
  return `${blobId}:${size}`;
}

/** clear the entire thumbnail cache (e.g. on disconnect) */
export function clearThumbnailCache(): void {
  thumbnailCache.clear();
}

// ---------------------------------------------------------------------------
// blob locality check
// ---------------------------------------------------------------------------

/**
 * check whether a blob exists in the local grimoire database.
 * used to determine whether to show "snatch" (remote) or "save to disk" (local).
 *
 * returns locality info including metadata when the blob is local.
 */
export async function checkBlobLocality(
  blobId: string,
  blake3?: string
): Promise<BlobLocalityInfo> {
  if (!blobId) {
    return { locality: "unknown" };
  }

  const cached = localityCache.get(blobId);
  if (cached && cached.locality === "local") {
    return cached;
  }

  if (!isTauriMode()) {
    try {
      const { hasBlob, getBlobRecord, getBlobRecordBySha256 } =
        await import("../storage/skein-blob-store");
      const exists = await hasBlob(blobId);
      if (!exists) {
        // blobId might be a server-assigned UUID that doesn't match our IDB primary key.
        // fall back to sha256 index lookup — the browser originally stored the blob
        // under its sha256 hash, but a Tauri peer's snatch may have overwritten the
        // automerge doc's blobId with the server UUID.
        const sha256Record = await getBlobRecordBySha256(blobId);
        if (sha256Record) {
          const result: BlobLocalityInfo = {
            locality: "local",
            metadata: {
              id: sha256Record.blob_id,
              mime: sha256Record.mime || undefined,
              filename: sha256Record.filename || undefined,
              size: sha256Record.size || undefined,
              blake3: sha256Record.blake3 || undefined,
            },
          };
          localityCache.set(blobId, result);
          return result;
        }
        // fallback: try blake3 index — the blobId might be a server UUID that
        // doesn't match our sha256-based primary key, but the content hash is
        // the same regardless of which peer assigned the ID.
        if (blake3) {
          const { getBlobRecordByBlake3 } = await import("../storage/skein-blob-store");
          const blake3Record = await getBlobRecordByBlake3(blake3);
          if (blake3Record) {
            const result: BlobLocalityInfo = {
              locality: "local",
              metadata: {
                id: blake3Record.blob_id,
                mime: blake3Record.mime || undefined,
                filename: blake3Record.filename || undefined,
                size: blake3Record.size || undefined,
                blake3: blake3Record.blake3 || undefined,
              },
            };
            localityCache.set(blobId, result);
            return result;
          }
        }

        return { locality: "remote" };
      }
      const record = await getBlobRecord(blobId);
      if (record) {
        const result: BlobLocalityInfo = {
          locality: "local",
          metadata: {
            id: record.blob_id,
            mime: record.mime || undefined,
            filename: record.filename || undefined,
            size: record.size || undefined,
            blake3: record.blake3 || undefined,
          },
        };
        localityCache.set(blobId, result);
        return result;
      }
      const result: BlobLocalityInfo = { locality: "local" };
      localityCache.set(blobId, result);
      return result;
    } catch (err) {
      console.debug(TAG, "browser blob locality check failed:", err);
      return { locality: "unknown" };
    }
  }

  try {
    const response = await tauriInvoke("api_call", {
      path: "/api/blob_metadata",
      body: { id: blobId },
    });

    if (!response.success || !response.data) {
      return { locality: "remote" };
    }

    const blob = response.data;
    let blobMetadata: Record<string, unknown> | undefined;
    if (blob.metadata && typeof blob.metadata === "object") {
      blobMetadata = blob.metadata as Record<string, unknown>;
    } else if (typeof blob.metadata === "string") {
      try {
        blobMetadata = JSON.parse(blob.metadata);
      } catch {
        // not valid JSON — ignore
      }
    }

    const result: BlobLocalityInfo = {
      locality: "local",
      metadata: {
        id: blob.id,
        mime: blob.mime ?? undefined,
        filename: blob.filename ?? undefined,
        size: blob.size ?? undefined,
        blake3: blob.blake3 ?? undefined,
        blobMetadata,
      },
    };
    localityCache.set(blobId, result);
    return result;
  } catch (err) {
    console.debug(TAG, "blob locality check failed:", err);
    return { locality: "unknown" };
  }
}

// ---------------------------------------------------------------------------
// snatch (download from peer + ingest locally)
// ---------------------------------------------------------------------------

/**
 * snatch a blob from a canvas peer: download the full file via iroh-blobs
 * verified transfer, then ingest it into the local grimoire to create a
 * media_blobz entry, domain entity, and thumbnail job.
 *
 * after snatch, the blob resolves locally (no more P2P dependency for
 * thumbnails or previews).
 *
 * in browser mode, uses the midden node's fetch methods and stores
 * in OPFS + IndexedDB. in Tauri mode, uses IPC commands.
 */
export async function snatchBlob(
  info: SnatchBlobInfo,
  peers: PeersMap,
  options?: SnatchOptions
): Promise<FileUploadResult> {
  if (!isTauriMode()) {
    const { getMiddenNode } = await import("../p2p/identity");
    const { storeBlob, storeDomainEntity, computeSha256 } =
      await import("../storage/skein-blob-store");

    const peerAddrs = await getPeerNodeIds(peers);

    if (peerAddrs.length === 0) {
      throw new Error("no peers available for snatch");
    }

    const node = await getMiddenNode();
    let lastError: unknown;

    for (const peerAddr of peerAddrs) {
      try {
        console.log(
          TAG,
          `browser snatch: blob ${info.blobId.slice(0, 8)}... from peer ${peerAddr.slice(0, 16)}...`
        );

        // download strategy: prefer iroh-blobs verified, fall back to custom protocol
        let bytes: Uint8Array | undefined;
        let blake3Hash = info.blake3;

        const nodeAny = node as any;
        const onProgress = options?.onProgress;
        let downloaded = false;

        // strategy 1: iroh-blobs verified download when blake3 is known from doc
        // (skips the compute_blake3 RPC — goes straight to ensure + download)
        if (
          !downloaded &&
          blake3Hash &&
          typeof nodeAny.download_verified_with_ensure === "function"
        ) {
          try {
            console.log(
              TAG,
              `trying iroh-blobs verified (blake3 known) from ${peerAddr.slice(0, 16)}...`
            );
            if (onProgress) onProgress(-1); // indeterminate — iroh-blobs has no progress API yet
            bytes = await withPeerTimeout(
              nodeAny.download_verified_with_ensure(peerAddr, blake3Hash) as Promise<Uint8Array>,
              30000
            );
            downloaded = true;
          } catch (err) {
            console.debug(TAG, `iroh-blobs verified (blake3 known) failed:`, err);
          }
        }

        // strategy 2: iroh-blobs verified download with on-demand blake3 compute
        // (asks peer to compute blake3, then downloads verified)
        if (!downloaded && typeof nodeAny.download_verified_by_id === "function") {
          try {
            console.log(
              TAG,
              `trying iroh-blobs verified (compute blake3) from ${peerAddr.slice(0, 16)}...`
            );
            if (onProgress) onProgress(-1);
            const result: any = await withPeerTimeout(
              nodeAny.download_verified_by_id(peerAddr, info.blobId) as Promise<any>,
              30000
            );
            bytes = result[0] as Uint8Array;
            blake3Hash = (result[1] as string) || blake3Hash;
            downloaded = true;
          } catch (err) {
            console.debug(TAG, `iroh-blobs verified (compute blake3) failed:`, err);
          }
        }

        if (!bytes) {
          throw new Error("iroh-blobs download failed — no fallback available");
        }

        console.log(
          TAG,
          `browser snatch: downloaded ${formatFileSize(bytes.length)}, storing in OPFS...`
        );

        // store in OPFS + IDB — compute sha256 so the record is findable
        // even when the automerge doc's blobId gets overwritten by a Tauri
        // peer with a server-assigned UUID.
        const sha256 = await computeSha256(bytes.buffer as ArrayBuffer);
        await storeBlob(sha256, bytes.buffer as ArrayBuffer, {
          blob_id: sha256,
          sha256: sha256,
          blake3: blake3Hash,
          filename: info.filename,
          mime: info.mime,
          size: info.size || bytes.length,
          domain: info.domain,
          blob_type: "original",
          parent_blob_id: null,
          metadata: { source: "snatch" },
        });

        // create domain entity record
        const entityId = crypto.randomUUID();
        await storeDomainEntity({
          entity_id: entityId,
          blob_id: sha256,
          domain: info.domain,
          title: info.filename,
          description: "",
          metadata: {},
          created_at: Date.now(),
        });

        // clear thumbnail cache for this blob
        const key200 = cacheKey(info.blobId, 200);
        const key50 = cacheKey(info.blobId, 50);
        thumbnailCache.delete(key200);
        thumbnailCache.delete(key50);

        // mark blob as local in the locality cache since we just downloaded it
        localityCache.set(info.blobId, { locality: "local" });
        // also cache by sha256 key so resolveBlob can find it later
        localityCache.set(sha256, { locality: "local" });

        console.log(
          TAG,
          `browser snatch complete: blob ${sha256.slice(0, 8)}... (doc blobId=${info.blobId.slice(0, 8)}...)`
        );

        return {
          blobId: sha256,
          domain: info.domain,
          entityId,
          jobId: null,
          sha256: sha256,
          blake3: blake3Hash || null,
          size: info.size || bytes.length,
          mime: info.mime,
          existing: false,
        };
      } catch (err) {
        lastError = err;
        console.debug(TAG, `browser snatch from peer ${peerAddr.slice(0, 16)}... failed:`, err);
        continue;
      }
    }

    throw lastError ?? new Error("browser snatch failed: all peers exhausted");
  }

  const peerAddrs = await getPeerNodeIds(peers);

  if (peerAddrs.length === 0) {
    throw new Error("no peers available for snatch");
  }

  // try each peer until one succeeds
  let lastError: unknown;
  for (const peerAddr of peerAddrs) {
    try {
      console.log(
        TAG,
        `snatching blob ${info.blobId.slice(0, 8)}... from peer ${peerAddr.slice(0, 16)}...`
      );

      // step 1: download full blob — prefer iroh-blobs verified, fall back to unverified
      let blobResult: { data: string; blake3: string; size?: number } | null = null;

      // strategy 1: if blake3 known from doc, use verified+ensure directly (skips compute step)
      if (info.blake3) {
        try {
          console.log(
            TAG,
            `trying iroh-blobs verified (blake3 known) from ${peerAddr.slice(0, 16)}...`
          );
          const verified = await tauriInvoke("p2p_fetch_blob_verified", {
            peerAddr,
            blake3Hash: info.blake3,
          });
          blobResult = { data: verified.data, blake3: info.blake3, size: verified.size };
        } catch (err) {
          console.debug(TAG, `iroh-blobs verified (blake3 known) failed:`, err);
        }
      }

      // strategy 2: verified by id (computes blake3 on peer, then iroh-blobs download)
      if (!blobResult) {
        try {
          console.log(
            TAG,
            `trying iroh-blobs verified (compute blake3) from ${peerAddr.slice(0, 16)}...`
          );
          blobResult = await tauriInvoke("p2p_fetch_blob_verified_by_id", {
            peerAddr,
            blobId: info.blobId,
          });
        } catch (err) {
          console.debug(TAG, `iroh-blobs verified (compute blake3) failed:`, err);
        }
      }

      if (!blobResult) {
        throw new Error("iroh-blobs download failed — no fallback available");
      }

      if (!blobResult.data) {
        throw new Error("peer returned empty blob data");
      }

      console.log(
        TAG,
        `downloaded ${blobResult.size ? formatFileSize(blobResult.size) : "unknown size"} from peer, ingesting locally...`
      );

      // step 2: ingest into local grimoire via the upload endpoint.
      // pass the base64 data directly + metadata marking this as a snatch.
      const uploadResponse = await tauriInvoke("api_call", {
        path: "/api/upload/file",
        body: {
          data: blobResult.data,
          filename: info.filename,
          metadata: JSON.stringify({ source: "snatch", original_blob_id: info.blobId }),
          wait_for_completion: true,
        },
      });

      if (!uploadResponse.success) {
        const detail =
          uploadResponse.errors?.[0]?.detail ?? uploadResponse.message ?? "ingest failed";
        throw new Error(`snatch ingest failed: ${detail}`);
      }

      const d = uploadResponse.data;
      if (!d) {
        throw new Error("snatch ingest returned no data");
      }

      console.log(TAG, `snatch complete: blob ${d.blob_id?.slice(0, 8)}... domain=${d.domain}`);

      // clear thumbnail cache for this blob so it re-fetches from local
      const key200 = cacheKey(info.blobId, 200);
      const key50 = cacheKey(info.blobId, 50);
      thumbnailCache.delete(key200);
      thumbnailCache.delete(key50);

      // mark blob as local in the locality cache since we just downloaded it
      localityCache.set(info.blobId, { locality: "local" });

      return {
        blobId: d.blob_id,
        domain: d.domain,
        entityId: d.entity_id,
        jobId: d.job_id ?? null,
        sha256: d.sha256,
        blake3: d.blake3 ?? null,
        size: d.size,
        mime: d.mime,
        existing: d.existing ?? false,
      };
    } catch (err) {
      lastError = err;
      console.debug(TAG, `snatch from peer ${peerAddr.slice(0, 16)}... failed:`, err);
      continue;
    }
  }

  throw lastError ?? new Error("snatch failed: all peers exhausted");
}

// ---------------------------------------------------------------------------
// save blob to disk
// ---------------------------------------------------------------------------

/**
 * dynamically load the Tauri dialog plugin's save function.
 */
async function loadTauriSaveDialog(): Promise<{
  save: (options?: { defaultPath?: string; title?: string }) => Promise<string | null>;
}> {
  // @ts-ignore — @tauri-apps/plugin-dialog is only available in Tauri builds
  return import("@tauri-apps/plugin-dialog");
}

/**
 * save a locally-stored blob to a user-chosen location on the filesystem.
 * opens a native save dialog, then copies the blob file to the chosen path.
 *
 * only works after the blob exists locally (either uploaded or snatched).
 * requires Tauri mode.
 *
 * for browser mode, falls back to a programmatic <a download> click using
 * blob data fetched from the local API.
 *
 * returns true if the file was saved, false if the user cancelled.
 */
export async function saveBlobToDisk(blobId: string, filename: string): Promise<boolean> {
  if (!isTauriMode()) {
    // browser fallback: fetch blob data and trigger download
    return saveBlobToDiskBrowser(blobId, filename);
  }

  try {
    // open native save dialog with suggested filename
    const { save } = await loadTauriSaveDialog();
    const destPath = await save({
      defaultPath: filename,
      title: "save file",
    });

    if (!destPath) {
      return false; // user cancelled
    }

    // copy blob file to chosen path via custom Tauri command
    await tauriInvoke("save_blob_to_path", {
      blobId,
      destPath,
    });

    console.log(TAG, `saved blob ${blobId.slice(0, 8)}... to ${destPath}`);
    return true;
  } catch (err) {
    console.error(TAG, "save to disk failed:", err);
    throw err;
  }
}

/**
 * browser fallback for save to disk — fetch blob data as base64 and
 * trigger a programmatic download via a hidden <a> element.
 */
async function saveBlobToDiskBrowser(blobId: string, filename: string): Promise<boolean> {
  try {
    // fetch blob data from local API (browser mode would need HTTP transport)
    const dataUrl = await getFullBlobDataUrl(blobId);
    if (!dataUrl) {
      throw new Error("could not fetch blob data for download");
    }

    // convert data URL to blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    // trigger download via hidden <a> element
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();

    // cleanup after a short delay
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);

    return true;
  } catch (err) {
    console.error(TAG, "browser save to disk failed:", err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// full blob data (for previews)
// ---------------------------------------------------------------------------

/**
 * fetch the full blob data (not just thumbnail) as a data URL.
 * used for full-screen photo preview, video playback, etc.
 *
 * resolution order:
 * 1. local grimoire via api_call
 * 2. P2P proxy via connected canvas peers
 *
 * returns null if the blob data is not available.
 */
export async function getFullBlobDataUrl(blobId: string, peers?: PeersMap): Promise<string | null> {
  // try local first
  const localResult = await fetchFullBlobLocal(blobId);
  if (localResult) {
    return localResult;
  }

  // try P2P fallback
  if (peers) {
    const peerResult = await fetchFullBlobFromPeers(blobId, peers);
    if (peerResult) {
      return peerResult;
    }
  }

  return null;
}

/**
 * fetch full blob data from local grimoire.
 * tries the path-based approach first (for asset:// URL in Tauri),
 * falls back to base64 data endpoint.
 */
async function fetchFullBlobLocal(blobId: string): Promise<string | null> {
  if (!isTauriMode()) {
    try {
      const { getBlobObjectURL } = await import("../storage/skein-blob-store");
      const url = await getBlobObjectURL(blobId);
      return url;
    } catch {
      return null;
    }
  }

  try {
    // try getting base64 data from the blob_data endpoint
    const response = await tauriInvoke("api_call", {
      path: `/api/blobs/${blobId}/data`,
      body: {},
    });

    if (!response.success || !response.data) {
      return null;
    }

    const { data, mime } = response.data;
    if (!data || !mime) {
      return null;
    }

    return `data:${mime};base64,${data}`;
  } catch (err) {
    return null;
  }
}

/**
 * fetch full blob data from canvas peers via P2P proxy.
 */
async function fetchFullBlobFromPeers(blobId: string, peers: PeersMap): Promise<string | null> {
  const peerAddrs = await getPeerNodeIds(peers);

  if (peerAddrs.length === 0) {
    return null;
  }

  if (!isTauriMode()) {
    try {
      const { getMiddenNode } = await import("../p2p/identity");
      const node = await getMiddenNode();
      const nodeAny = node as any;

      for (const peerAddr of peerAddrs) {
        try {
          let bytes: Uint8Array | null = null;
          let contentType = "application/octet-stream";

          if (typeof nodeAny.download_verified_by_id === "function") {
            const result = await withPeerTimeout<any>(
              nodeAny.download_verified_by_id(peerAddr, blobId),
              30000
            );
            bytes = result[0] as Uint8Array;
          } else if (typeof nodeAny.fetch_blob === "function") {
            const result = await withPeerTimeout<any>(nodeAny.fetch_blob(peerAddr, blobId), 30000);
            bytes = result.data;
            contentType = result.content_type || contentType;
          }

          if (bytes) {
            const blob = new Blob([new Uint8Array(bytes)], { type: contentType });
            console.log(
              TAG,
              `fetched full blob ${blobId.slice(0, 8)}... from browser peer ${peerAddr.slice(0, 16)}...`
            );
            return URL.createObjectURL(blob);
          }

          // fallback: proxy_request for blob data
          if (!bytes && typeof nodeAny.proxy_request === "function") {
            try {
              const proxyResult = await withPeerTimeout<any>(
                nodeAny.proxy_request(peerAddr, "GET", `/api/blobs/${blobId}/data`, null),
                30000
              );
              if (proxyResult.status === 200) {
                const parsed = JSON.parse(proxyResult.body);
                if (parsed.success && parsed.data?.data && parsed.data?.mime) {
                  return `data:${parsed.data.mime};base64,${parsed.data.data}`;
                }
              }
            } catch {
              // fall through to next peer
            }
          }
        } catch (err) {
          console.debug(
            TAG,
            `browser peer ${peerAddr.slice(0, 16)}... failed for full blob ${blobId.slice(0, 8)}...:`,
            err
          );
          continue;
        }
      }
    } catch (err) {
      console.debug(TAG, "browser P2P full blob fetch setup failed:", err);
    }
    return null;
  }

  for (const peerAddr of peerAddrs) {
    try {
      const result = await withPeerTimeout(
        tauriInvoke("p2p_proxy_request", {
          peerAddr,
          method: "GET",
          path: `/api/blobs/${blobId}/data`,
          body: null,
        }),
        30000
      );

      if (result.status !== 200) {
        continue;
      }

      const parsed = JSON.parse(result.body);
      if (!parsed.success || !parsed.data) {
        continue;
      }

      const { data, mime } = parsed.data;
      if (!data || !mime) {
        continue;
      }

      console.log(
        TAG,
        `fetched full blob ${blobId.slice(0, 8)}... from peer ${peerAddr.slice(0, 16)}...`
      );
      return `data:${mime};base64,${data}`;
    } catch (err) {
      console.debug(
        TAG,
        `peer ${peerAddr.slice(0, 16)}... failed for full blob ${blobId.slice(0, 8)}...:`,
        err
      );
      continue;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// blob local path (for asset:// URLs in Tauri video/audio playback)
// ---------------------------------------------------------------------------

/**
 * get the local filesystem path for a blob.
 * used to construct asset:// URLs for video/audio playback in Tauri.
 * returns null if the blob has no local path or isn't available locally.
 */
export async function getBlobLocalPath(blobId: string): Promise<string | null> {
  if (!isTauriMode()) {
    return null;
  }

  try {
    const response = await tauriInvoke("api_call", {
      path: `/api/blobs/${blobId}/path`,
      body: {},
    });

    if (!response.success || !response.data) {
      return null;
    }

    return response.data.path ?? null;
  } catch (err) {
    return null;
  }
}

/**
 * convert a local filesystem path to a Tauri asset:// URL.
 * used for streaming video/audio from local storage without loading
 * the entire file into memory.
 */
export async function convertToAssetUrl(localPath: string): Promise<string> {
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  return convertFileSrc(localPath);
}

// ---------------------------------------------------------------------------
// pickFile
// ---------------------------------------------------------------------------

/**
 * open a file picker dialog.
 * in Tauri mode, uses the native dialog plugin to get a file path.
 * in browser mode, uses a hidden `<input type="file">` to get a File object.
 * returns null if the user cancels.
 */
export async function pickFile(): Promise<PickedFile | null> {
  if (isTauriMode()) {
    return pickFileTauri();
  }
  return pickFileBrowser();
}

/**
 * dynamically load the Tauri dialog plugin.
 * uses a variable module specifier so TypeScript doesn't try to resolve
 * the package at compile time (it's only available in Tauri builds).
 */
async function loadTauriDialog(): Promise<{
  open: (options?: { multiple?: boolean }) => Promise<string | string[] | null>;
}> {
  // @ts-ignore — @tauri-apps/plugin-dialog is only available in Tauri builds
  return import("@tauri-apps/plugin-dialog");
}

/** Tauri-mode file picker — uses @tauri-apps/plugin-dialog */
async function pickFileTauri(): Promise<PickedFile | null> {
  try {
    const { open } = await loadTauriDialog();
    const result = await open({ multiple: false });

    if (result === null) {
      return null;
    }

    // open() returns string | string[] | null — normalize to a single path
    const filePath = Array.isArray(result) ? result[0] : result;
    if (!filePath) {
      return null;
    }

    // extract filename from the full path (handle both / and \ separators)
    const filename = filePath.split(/[\\/]/).pop() ?? filePath;

    return {
      path: filePath,
      filename,
      size: 0, // unknown until the file is uploaded
      file: null,
    };
  } catch (err) {
    console.error(TAG, "native file picker failed:", err);
    return null;
  }
}

/** browser-mode file picker — uses a hidden <input type="file"> */
async function pickFileBrowser(): Promise<PickedFile | null> {
  const input = document.createElement("input");
  input.type = "file";
  input.style.display = "none";

  document.body.appendChild(input);

  try {
    input.click();

    const file = await new Promise<File | null>((resolve) => {
      input.addEventListener("change", () => {
        resolve(input.files?.[0] ?? null);
      });

      // detect cancellation — the input element fires no event on cancel,
      // but a focus event on the window fires shortly after the picker closes.
      const onFocus = () => {
        window.removeEventListener("focus", onFocus);
        // small delay so "change" fires first if a file was picked
        setTimeout(() => resolve(null), 300);
      };
      window.addEventListener("focus", onFocus);
    });

    if (!file) {
      return null;
    }

    return {
      path: null,
      filename: file.name,
      size: file.size,
      file,
    };
  } catch (err) {
    console.error(TAG, "browser file picker failed:", err);
    return null;
  } finally {
    input.remove();
  }
}

// ---------------------------------------------------------------------------
// uploadFile
// ---------------------------------------------------------------------------

/**
 * upload a picked file to grimoire via the ingest pipeline.
 * in Tauri mode, passes the file path directly (no data copy needed).
 * in browser mode, reads the file as base64 and sends the data.
 *
 * NOTE: upload currently requires Tauri mode. browser-only upload will
 * be supported once an HTTP fallback is implemented.
 */
export async function uploadFile(
  picked: PickedFile,
  options?: UploadOptions
): Promise<FileUploadResult> {
  if (!isTauriMode()) {
    if (!picked.file) {
      throw new Error("no File object available in browser mode");
    }

    const { storeBlobFromFile, storeDomainEntity } = await import("../storage/skein-blob-store");

    const record = await storeBlobFromFile(picked.file);

    const entityId = crypto.randomUUID();
    await storeDomainEntity({
      entity_id: entityId,
      blob_id: record.blob_id,
      domain: record.domain,
      title: options?.title || picked.filename,
      description: options?.description || "",
      metadata: {},
      created_at: Date.now(),
    });

    // generate browser-side thumbnail for images
    let thumbnailDataUrl: string | null = null;
    if (picked.file) {
      thumbnailDataUrl = await generateThumbnailDataUrl(picked.file);
    }

    return {
      blobId: record.blob_id,
      domain: record.domain,
      entityId,
      jobId: null,
      sha256: record.sha256,
      blake3: record.blake3 || "",
      size: record.size,
      mime: record.mime,
      existing: false,
      thumbnailDataUrl,
    };
  }

  const body: Record<string, unknown> = {
    filename: picked.filename,
    title: options?.title,
    description: options?.description,
    metadata: options?.metadata,
    wait_for_completion: options?.waitForCompletion ?? true,
  };

  if (picked.path) {
    // Tauri mode — pass the native file path directly
    body.file_path = picked.path;
  } else if (picked.file) {
    // browser File object available — read as base64 for IPC transport
    const base64 = await fileToBase64(picked.file);
    body.data = base64;
  } else {
    throw new Error("picked file has neither a path nor a File object");
  }

  const response = await tauriInvoke("api_call", {
    path: "/api/upload/file",
    body,
  });

  if (!response.success) {
    const detail = response.errors?.[0]?.detail ?? response.message ?? "upload failed";
    throw new Error(`file upload failed: ${detail}`);
  }

  const d = response.data;
  if (!d) {
    throw new Error("file upload returned no data");
  }

  // try to get the generated thumbnail from grimoire (Tauri mode)
  let thumbnailDataUrl: string | null = null;
  try {
    thumbnailDataUrl = await fetchThumbnailLocal(d.blob_id, 200);
  } catch {
    // thumbnail may not be ready yet — that's OK
  }

  return {
    blobId: d.blob_id,
    domain: d.domain,
    entityId: d.entity_id,
    jobId: d.job_id ?? null,
    sha256: d.sha256,
    blake3: d.blake3 ?? null,
    size: d.size,
    mime: d.mime,
    existing: d.existing ?? false,
    thumbnailDataUrl,
  };
}

// ---------------------------------------------------------------------------
// getThumbnailDataUrl
// ---------------------------------------------------------------------------

/**
 * fetch thumbnail image data for a blob and return it as a data URL.
 * walks the blob parent-child chain to find the best available thumbnail.
 *
 * resolution order:
 * 1. in-memory cache (instant, session-scoped)
 * 2. local grimoire via api_call (blob is on this machine)
 * 3. P2P proxy via connected canvas peers (blob is on a peer's machine)
 *
 * returns null if no thumbnail is available from any source.
 */
export async function getThumbnailDataUrl(
  blobId: string,
  options?: ThumbnailOptions | number
): Promise<string | null> {
  // support legacy call signature: getThumbnailDataUrl(blobId, 200)
  const opts: ThumbnailOptions = typeof options === "number" ? { size: options } : (options ?? {});
  const size = opts.size ?? 200;

  // 1. check in-memory cache
  const key = cacheKey(blobId, size);
  const cached = thumbnailCache.get(key);
  if (cached) {
    return cached;
  }

  // 2. try local grimoire (blob exists on this machine)
  const localResult = await fetchThumbnailLocal(blobId, size);
  if (localResult) {
    thumbnailCache.set(key, localResult);
    return localResult;
  }

  // 3. try P2P fallback — proxy the request through connected canvas peers
  const peers = opts.peers;
  if (peers) {
    const peerResult = await fetchThumbnailFromPeers(blobId, size, peers);
    if (peerResult) {
      thumbnailCache.set(key, peerResult);
      return peerResult;
    }
  }

  return null;
}

/**
 * try fetching thumbnail data from the local grimoire instance.
 * returns a data URL on success, null on failure.
 */
async function fetchThumbnailLocal(blobId: string, size: number): Promise<string | null> {
  if (!isTauriMode()) {
    // browser mode: try generating thumbnail from OPFS data.
    // use resolveBlob to handle the case where the automerge doc's blobId
    // was overwritten by a Tauri peer with a server UUID that doesn't match
    // the browser's sha256-based primary key.
    try {
      const { resolveBlob, getBlobData } = await import("../storage/skein-blob-store");
      const record = await resolveBlob(blobId);
      if (!record) return null;

      // only generate thumbnails for images — video/audio need ffmpeg (Tauri only)
      if (!record.mime.startsWith("image/")) return null;

      const data = await getBlobData(record.blob_id);
      if (!data) return null;

      const blob = new Blob([data], { type: record.mime });
      return await generateThumbnailDataUrl(blob, size);
    } catch {
      return null;
    }
  }

  try {
    const response = await tauriInvoke("api_call", {
      path: "/api/blobs/thumbnail_data",
      body: {
        blob_id: blobId,
        size,
      },
    });

    if (!response.success || !response.data) {
      return null;
    }

    const { data, mime } = response.data;
    if (!data || !mime) {
      return null;
    }

    return `data:${mime};base64,${data}`;
  } catch (err) {
    // not an error — just means the blob isn't available locally
    return null;
  }
}

/**
 * try fetching thumbnail data by proxying the request through canvas peers.
 * iterates connected peers and tries each one until one succeeds.
 * uses the same /api/blobs/thumbnail_data endpoint on the remote side
 * via p2p_proxy_request, so the peer does all the thumbnail chain walking.
 */
async function fetchThumbnailFromPeers(
  blobId: string,
  size: number,
  peers: Record<string, { nodeId: string }>
): Promise<string | null> {
  const peerIds = await getPeerNodeIds(peers);

  if (peerIds.length === 0) {
    return null;
  }

  if (!isTauriMode()) {
    try {
      const { getMiddenNode } = await import("../p2p/identity");
      const node = await getMiddenNode();
      const nodeAny = node as any;

      if (typeof nodeAny.proxy_request !== "function") {
        return null;
      }

      const fetchFromBrowserPeer = async (peerAddr: string): Promise<string> => {
        const result = await withPeerTimeout<any>(
          nodeAny.proxy_request(
            peerAddr,
            "POST",
            "/api/blobs/thumbnail_data",
            JSON.stringify({ blob_id: blobId, size })
          )
        );

        if (result.status !== 200) throw new Error("non-200 status");

        const parsed = JSON.parse(result.body);
        if (!parsed.success || !parsed.data) throw new Error("unsuccessful response");

        const { data, mime } = parsed.data;
        if (!data || !mime) throw new Error("missing data or mime");

        console.log(
          TAG,
          `fetched thumbnail for ${blobId.slice(0, 8)}... from browser peer ${peerAddr.slice(0, 16)}...`
        );
        return `data:${mime};base64,${data}`;
      };

      for (let i = 0; i < peerIds.length; i += 2) {
        const batch = peerIds.slice(i, i + 2);
        try {
          return await Promise.any(batch.map((addr) => fetchFromBrowserPeer(addr)));
        } catch {
          continue;
        }
      }
    } catch (err) {
      console.debug(TAG, "browser peer thumbnail fetch setup failed:", err);
    }
    return null;
  }

  const fetchFromTauriPeer = async (peerAddr: string): Promise<string> => {
    const result = await withPeerTimeout(
      tauriInvoke("p2p_proxy_request", {
        peerAddr,
        method: "POST",
        path: "/api/blobs/thumbnail_data",
        body: JSON.stringify({ blob_id: blobId, size }),
      })
    );

    if (result.status !== 200) throw new Error("non-200 status");

    const parsed = JSON.parse(result.body);
    if (!parsed.success || !parsed.data) throw new Error("unsuccessful response");

    const { data, mime } = parsed.data;
    if (!data || !mime) throw new Error("missing data or mime");

    console.log(
      TAG,
      `fetched thumbnail for ${blobId.slice(0, 8)}... from peer ${peerAddr.slice(0, 16)}...`
    );
    return `data:${mime};base64,${data}`;
  };

  for (let i = 0; i < peerIds.length; i += 2) {
    const batch = peerIds.slice(i, i + 2);
    try {
      return await Promise.any(batch.map((addr) => fetchFromTauriPeer(addr)));
    } catch {
      continue;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// generateThumbnailDataUrl
// ---------------------------------------------------------------------------

/**
 * generate a 200px WebP thumbnail data URL from a File object.
 * only works for image files — returns null for non-image types.
 * uses OffscreenCanvas for efficient off-main-thread resizing.
 */
export async function generateThumbnailDataUrl(blob: Blob, maxSize = 200): Promise<string | null> {
  // only generate thumbnails for images
  if (!blob.type.startsWith("image/")) return null;

  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(maxSize / bitmap.width, maxSize / bitmap.height, 1);
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const thumbBlob = await canvas.convertToBlob({ type: "image/webp", quality: 0.75 });
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(thumbBlob);
    });
  } catch (err) {
    console.warn(TAG, "thumbnail generation failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// formatFileSize
// ---------------------------------------------------------------------------

/**
 * format a file size in bytes to a human-readable string.
 * e.g. 1024 -> "1.0 KB", 1048576 -> "1.0 MB"
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  // show decimals only for KB and above
  if (unitIndex === 0) {
    return `${value} ${units[unitIndex]}`;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

// ---------------------------------------------------------------------------
// internal helpers
// ---------------------------------------------------------------------------

/** read a File as a base64-encoded string (without the data URL prefix) */
async function fileToBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // strip "data:<mime>;base64," prefix to get raw base64
      const commaIndex = dataUrl.indexOf(",");
      resolve(commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
