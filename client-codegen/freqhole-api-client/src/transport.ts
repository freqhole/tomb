// transport abstraction for HTTP and P2P
//
// transports handle the low-level request/response mechanics.
// FreqholeClient uses a transport to make requests, then handles
// Zod validation on top.

import type {
  AssociationHint,
  CloseReason,
  EventFilter,
  JobEvent,
  JobStateSnapshot,
  RadioQueueEvent,
  RadioQueueEventFilter,
  RadioQueuedRequestInfo,
} from "./codegen/schema.js";

/**
 * typed metadata for an upload, passed as `Transport.upload()`'s 4th
 * argument. P2P/IPC transports (CharnelLocalTransport, CharnelTransport,
 * WasmTransport) consume this object directly - no FormData string
 * parsing involved. `HttpTransport` is the only implementation that has
 * to fold it back into real multipart form fields, since that's what its
 * wire format actually is. see docs/add-media-review-refactor-plan.md §6
 * for why this replaced the previous FormData-only design.
 */
export interface UploadMetadata {
  /** associate the uploaded blob with an existing entity (album/song/etc). */
  associate_with?: AssociationHint;
  /** "review before send" annotation - see grimoire's
   * import_session_send_targetz - tags the resulting session as destined
   * for this remote once reviewed. */
  target_remote_id?: string;
  target_remote_name?: string;
}

/**
 * response from a transport request
 */
export interface TransportResponse {
  status: number;
  body: string;
}

/**
 * blob data with metadata
 */
export interface BlobData {
  data: Uint8Array;
  contentType: string;
}

/**
 * cache policy for a blob fetch.
 *
 * transports that back their blob fetches with the Cache API write every blob
 * they fetch by default. callers that are about to store the bytes somewhere
 * permanent instead (the sync-to-local path writing to OPFS / the grimoire
 * library) must pass `cache: "skip"`, or the same audio ends up stored twice.
 *
 * "skip" suppresses the *write* only — an existing cache entry is still read,
 * since the bytes are already there and are blake3-verified.
 */
export interface BlobFetchOptions {
  cache?: "write" | "skip";
}

/**
 * transport interface - implemented by HttpTransport, AppTransport, WasmTransport
 */
export interface Transport {
  /**
   * make an API request
   * @param method - HTTP method (GET, POST, etc)
   * @param path - API path (e.g., /api/songs/query)
   * @param body - optional JSON body string
   * @returns response with status code and body string
   */
  request(method: string, path: string, body?: string): Promise<TransportResponse>;

  /**
   * upload a file via FormData
   * @param path - API path (e.g., /api/upload/music)
   * @param formData - FormData with file and metadata
   * @param onProgress - optional callback with (loaded, total) bytes sent so
   *   far. only HttpTransport can report real values (via XHR's upload
   *   progress event - plain fetch has no cross-browser upload progress
   *   API); P2P/tauri transports accept but ignore it since their upload
   *   path doesn't stream raw bytes over a trackable request body.
   * @param metadata - typed upload metadata (association hint, review-before-
   *   send target). non-HTTP transports use this directly; HttpTransport
   *   folds it into real form fields internally.
   * @returns response with status code and body string
   */
  upload(
    path: string,
    formData: FormData,
    onProgress?: (loaded: number, total: number) => void,
    metadata?: UploadMetadata,
  ): Promise<TransportResponse>;

  /**
   * fetch a blob by ID
   * @param blobId - the blob ID to fetch
   * @param blake3 - optional blake3 hash for verified streaming via iroh-blobs
   * @param opts - optional cache policy
   * @returns blob data with content type
   */
  fetchBlob(blobId: string, blake3?: string, opts?: BlobFetchOptions): Promise<BlobData>;

  /**
   * get a URL for a blob (for <audio>/<img> src)
   * HTTP transport returns direct URL, P2P transports may need caching
   * @param blobId - the blob ID to fetch
   * @param blake3 - optional blake3 hash for verified streaming via iroh-blobs
   * @param opts - optional cache policy
   */
  getBlobUrl(blobId: string, blake3?: string, opts?: BlobFetchOptions): string | Promise<string>;

  /**
   * get a URL for a blob with progress callback (optional).
   * only implemented by transports that support streaming progress (WasmTransport).
   * @param blobId - the blob ID to fetch
   * @param onProgress - callback with (received, total) bytes
   * @param blake3 - optional blake3 hash for verified streaming via iroh-blobs
   * @param totalBytes - optional known total size of the blob in bytes; used so
   *   the progress callback reports a correct received/total ratio even when
   *   the underlying iroh-blobs stream doesn't supply size up front
   * @param mimeType - optional content type for the assembled blob (e.g.
   *   the song's media_blob.mime). midden's streaming path doesn't surface
   *   the source mime, so callers should pass it when known.
   * @param opts - optional cache policy
   */
  getBlobUrlWithProgress?(
    blobId: string,
    onProgress: (received: number, total: number) => void,
    blake3?: string,
    totalBytes?: number,
    mimeType?: string,
    opts?: BlobFetchOptions,
  ): Promise<string>;

  /**
   * stream a blob's bytes to a caller-supplied sink, chunk by chunk,
   * instead of assembling the whole blob in memory first (optional).
   * only implemented by WasmTransport - HTTP callers should stream
   * directly from `fetch()`'s own `response.body` reader instead (see
   * `streamVideoToOPFSWithResume`), and CharnelLocalTransport's sync-to-
   * local path never goes through JS at all (grimoire's own disk-backed
   * pull). intended for a caller writing straight to OPFS (or anywhere
   * else) without ever holding the full blob in one buffer - see
   * docs/blob-transfer-opfs-and-sha256-refactor-plan.md phase 2.
   * @param blobId - the blob ID to fetch
   * @param onChunk - called with each chunk as it arrives, in order
   * @param onProgress - callback with (received, total) bytes
   * @param blake3 - optional blake3 hash for verified streaming via iroh-blobs
   * @param totalBytes - optional known total size in bytes
   * @param mimeType - optional content type (midden's streaming path doesn't
   *   surface the source mime)
   * @returns the content type and total bytes actually streamed
   */
  streamBlobToSink?(
    blobId: string,
    onChunk: (chunk: Uint8Array, offset: number) => void | Promise<void>,
    onProgress: (received: number, total: number) => void,
    blake3?: string,
    totalBytes?: number,
    mimeType?: string,
  ): Promise<{ contentType: string; totalBytes: number }>;

  /**
   * fetch server image (public, no auth required)
   * used during "add remote" flow before user is authenticated
   * only implemented by P2P transports (WasmTransport)
   */
  fetchHelloImage?(): Promise<BlobData | null>;

  /**
   * upload a file by filesystem path (optional).
   * only implemented by transports with direct filesystem access (CharnelLocalTransport).
   * skips base64 encoding by passing the path to the backend.
   * @param path - API path (e.g., /api/upload/image)
   * @param filePath - local filesystem path to the file
   * @param metadata - optional metadata to include (e.g., associate_with)
   */
  uploadByPath?(
    path: string,
    filePath: string,
    metadata?: Record<string, unknown>,
  ): Promise<TransportResponse>;

  /**
   * one-shot snapshot of currently-active jobs the caller is allowed to
   * see. used to rehydrate after a page reload / fresh mount. transports
   * that don't override fall back to the default `request()` based impl
   * (POST /api/jobs/events/snapshot).
   */
  snapshotJobEvents?(filter?: EventFilter): Promise<JobStateSnapshot[]>;

  /**
   * live subscription to job events. each iterator value is one event in
   * snake_case-tagged form. consumers should treat termination as a
   * normal stream end (transport-specific reason surfaced via the
   * optional `return()` path on the iterator). transports that don't
   * override use the default polling fallback (see `pollingJobEvents`).
   */
  subscribeJobEvents?(filter?: EventFilter, signal?: AbortSignal): AsyncIterable<JobEvent>;

  /**
   * live subscription to one station's request-queue events
   * (`Submitted`/`Removed`/`Reordered`/`Cleared` - PascalCase `kind`
   * tags, see `RadioQueueEvent`'s doc comment for why). transports that
   * don't override use the default polling-diff fallback (see
   * `pollingRadioQueueEvents`) - same precedent as `subscribeJobEvents`.
   */
  subscribeRadioQueueEvents?(
    filter: RadioQueueEventFilter,
    signal?: AbortSignal,
  ): AsyncIterable<RadioQueueEvent>;
}

/**
 * HTTP transport - uses fetch API
 */
export class HttpTransport implements Transport {
  constructor(
    public readonly baseUrl: string,
    private readonly apiKey?: string,
  ) {}

  async request(method: string, path: string, body?: string): Promise<TransportResponse> {
    const url = this.baseUrl + path;
    const headers: Record<string, string> = {};

    if (body) {
      headers["Content-Type"] = "application/json";
    }

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const options: RequestInit = {
      method,
      headers,
      credentials: this.apiKey ? "omit" : "include",
    };

    // disable cache for blob metadata routes
    if (path.includes("/api/blobs/") && path.includes("/metadata")) {
      options.cache = "no-store";
    }

    if (body) {
      options.body = body;
    }

    const response = await fetch(url, options);
    const responseBody = await response.text();

    return {
      status: response.status,
      body: responseBody,
    };
  }

  async upload(
    path: string,
    formData: FormData,
    onProgress?: (loaded: number, total: number) => void,
    metadata?: UploadMetadata,
  ): Promise<TransportResponse> {
    // this is the one transport whose wire format actually is multipart
    // form fields - fold the typed metadata back into FormData here so
    // every other transport (and every caller) can deal with a plain
    // object instead.
    if (metadata?.associate_with) {
      formData.append("associate_with", JSON.stringify(metadata.associate_with));
    }
    if (metadata?.target_remote_id) formData.append("target_remote_id", metadata.target_remote_id);
    if (metadata?.target_remote_name) {
      formData.append("target_remote_name", metadata.target_remote_name);
    }

    const url = this.baseUrl + path;

    // plain fetch has no cross-browser upload-progress event, so only
    // reach for XHR when a caller actually wants progress reported.
    if (!onProgress) {
      const headers: Record<string, string> = {};
      // don't set Content-Type - browser sets it with boundary for FormData
      if (this.apiKey) {
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      }
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: formData,
        credentials: this.apiKey ? "omit" : "include",
      });
      const responseBody = await response.text();
      return { status: response.status, body: responseBody };
    }

    return new Promise<TransportResponse>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      if (this.apiKey) {
        xhr.setRequestHeader("Authorization", `Bearer ${this.apiKey}`);
      }
      xhr.withCredentials = !this.apiKey;
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      });
      xhr.addEventListener("load", () => {
        resolve({ status: xhr.status, body: xhr.responseText });
      });
      xhr.addEventListener("error", () => reject(new Error("upload failed: network error")));
      xhr.addEventListener("abort", () => reject(new Error("upload failed: aborted")));
      xhr.send(formData);
    });
  }

  async fetchBlob(blobId: string, _blake3?: string): Promise<BlobData> {
    const url = `${this.baseUrl}/api/blobs/${blobId}`;
    const headers: Record<string, string> = {};

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, {
      headers,
      credentials: this.apiKey ? "omit" : "include",
    });

    if (!response.ok) {
      throw new Error(`failed to fetch blob: ${response.status}`);
    }

    const data = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get("Content-Type") || "application/octet-stream";

    return { data, contentType };
  }

  getBlobUrl(blobId: string, _blake3?: string): string {
    return `${this.baseUrl}/api/blobs/${blobId}`;
  }

  // -----------------------------------------------------------------
  // job events (http impl: plain POST snapshot + polling fallback for
  // subscribe. real bi-directional streaming over http would need sse
  // or websockets; that's deferred. polling diffs by `job_id`/status
  // and synthesizes `StatusChanged` events so consumers can use the
  // same handler as the iroh/ipc transports.)
  // -----------------------------------------------------------------

  async snapshotJobEvents(filter?: EventFilter): Promise<JobStateSnapshot[]> {
    return snapshotJobEventsViaRequest(this, filter);
  }

  subscribeJobEvents(filter?: EventFilter, signal?: AbortSignal): AsyncIterable<JobEvent> {
    return pollingJobEvents(this, filter, signal);
  }
}

// ---------------------------------------------------------------------
// shared http-style helpers (used by HttpTransport directly, and by any
// transport that wants the same polling fallback shape)
// ---------------------------------------------------------------------

/**
 * default snapshot impl: POST /api/jobs/events/snapshot. relies only on
 * the transport's `request()`, so it works for any http-backed transport.
 */
export async function snapshotJobEventsViaRequest(
  transport: Transport,
  filter?: EventFilter,
): Promise<JobStateSnapshot[]> {
  const body = JSON.stringify(filter ?? {});
  const resp = await transport.request("POST", "/api/jobs/events/snapshot", body);
  if (resp.status >= 400 || resp.status === 0) {
    throw new Error(`snapshotJobEvents failed: status ${resp.status}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(resp.body);
  } catch {
    throw new Error("snapshotJobEvents: non-json response");
  }
  // unwrap GrimoireResponse { success, data, ... }
  const root = parsed as { data?: unknown; success?: boolean };
  const data = root && "data" in root ? root.data : parsed;
  if (!Array.isArray(data)) {
    throw new Error("snapshotJobEvents: response data not an array");
  }
  return data as JobStateSnapshot[];
}

/** poll interval used by the http subscribe-fallback. */
export const POLL_INTERVAL_FALLBACK_MS = 3_000;

/**
 * polling fallback iterator. snapshots every `POLL_INTERVAL_FALLBACK_MS`
 * and yields synthetic `StatusChanged` / `Stage` events for any
 * differences from the previous snapshot. event shape matches the
 * `JobEvent` schema so callers can use the same reducer regardless of
 * transport.
 *
 * the first tick yields nothing (it just seeds the baseline). subsequent
 * ticks diff against the previous snapshot:
 *   - new `job_id` -> StatusChanged with `from: null, to: status`
 *   - status change -> StatusChanged with `from: prev, to: next`
 *   - stage/message change -> Stage with the new values
 *   - disappearing `job_id` -> ignored (terminal status already emitted
 *     when first seen as Completed/Failed/Cancelled)
 */
export async function* pollingJobEvents(
  transport: Transport,
  filter?: EventFilter,
  signal?: AbortSignal,
): AsyncGenerator<JobEvent, void, void> {
  let prev = new Map<string, JobStateSnapshot>();
  let first = true;
  while (true) {
    if (signal?.aborted) return;
    let snaps: JobStateSnapshot[];
    try {
      snaps = await snapshotJobEventsViaRequest(transport, filter);
    } catch {
      // a transient fetch failure must not wipe `prev` - doing so would
      // make every still-active job look "new" again on the next
      // successful tick (a spurious `from: null` status_changed for
      // jobs that never actually changed). skip this tick's diff
      // entirely and retry with the same baseline next time. callers
      // can fail-fast by observing snapshot errors separately via
      // snapshotJobEvents.
      await sleepOrAbort(POLL_INTERVAL_FALLBACK_MS, signal);
      continue;
    }
    if (!first) {
      const next = new Map<string, JobStateSnapshot>();
      for (const s of snaps) next.set(s.job_id, s);
      for (const [job_id, cur] of next) {
        const before = prev.get(job_id);
        if (!before) {
          yield {
            kind: "status_changed",
            session_id: cur.session_id ?? "",
            job_id,
            from: null,
            to: cur.status,
            topic: cur.job_type,
            entity_ref: cur.entity_ref ?? null,
            created_by: cur.created_by ?? null,
          } as JobEvent;
        } else if (before.status !== cur.status) {
          yield {
            kind: "status_changed",
            session_id: cur.session_id ?? "",
            job_id,
            from: before.status,
            to: cur.status,
            topic: cur.job_type,
            entity_ref: cur.entity_ref ?? null,
            created_by: cur.created_by ?? null,
          } as JobEvent;
        }
        if (
          (before?.last_stage ?? null) !== (cur.last_stage ?? null) ||
          (before?.last_message ?? null) !== (cur.last_message ?? null)
        ) {
          if (cur.last_stage) {
            yield {
              kind: "stage",
              session_id: cur.session_id ?? null,
              job_id,
              stage: cur.last_stage,
              message: cur.last_message ?? null,
              topic: cur.job_type,
              entity_ref: cur.entity_ref ?? null,
              created_by: cur.created_by ?? null,
            } as JobEvent;
          }
        }
      }
      prev = next;
    } else {
      first = false;
      prev = new Map(snaps.map((s) => [s.job_id, s] as const));
    }
    await sleepOrAbort(POLL_INTERVAL_FALLBACK_MS, signal);
  }
}

// ---------------------------------------------------------------------
// radio-queue events (http impl: plain POST list + polling-diff
// fallback for subscribe - same precedent as job events above, reusing
// the already-existing `radio_list_requests` route rather than a
// dedicated snapshot endpoint, since that route already works
// transparently against local or remote stations through any transport.)
// ---------------------------------------------------------------------

/**
 * one-shot snapshot of a station's current request queue via the plain
 * `radio_list_requests` route. works for any http-backed transport
 * (relies only on `transport.request()`).
 */
export async function snapshotRadioQueueEventsViaRequest(
  transport: Transport,
  filter: RadioQueueEventFilter,
): Promise<RadioQueuedRequestInfo[]> {
  const body = JSON.stringify({ station_id: filter.station_id });
  const resp = await transport.request("POST", "/api/radio/requests/list", body);
  if (resp.status >= 400 || resp.status === 0) {
    throw new Error(`snapshotRadioQueueEvents failed: status ${resp.status}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(resp.body);
  } catch {
    throw new Error("snapshotRadioQueueEvents: non-json response");
  }
  // unwrap GrimoireResponse { success, data, ... }
  const root = parsed as { data?: { requests?: unknown } };
  const requests = root?.data?.requests;
  if (!Array.isArray(requests)) {
    throw new Error("snapshotRadioQueueEvents: response data not an array");
  }
  return requests as RadioQueuedRequestInfo[];
}

/**
 * polling-diff fallback iterator for transports that don't implement
 * `subscribeRadioQueueEvents`. polls every `POLL_INTERVAL_FALLBACK_MS`
 * and diffs the station's request list (which is already in queue
 * order) against the previous tick to synthesize `RadioQueueEvent`s in
 * the exact same shape a true push subscription would yield - so
 * `useRadioRequestQueue`'s consumption code stays identical regardless
 * of transport, matching `pollingJobEvents`'s precedent.
 *
 * the first tick only seeds the baseline (no synthetic events). on
 * later ticks: ids missing from the new list -> `Removed`; ids new to
 * the list -> `Submitted` (full metadata, straight from the list
 * response); ids present in both but at a different index -> `Reordered`.
 *
 * NOTE: `kind` values are PascalCase ("Submitted"/"Removed"/etc.), not
 * snake_case - `RadioQueueEvent` deliberately has no `rename_all` on
 * its `#[serde(tag = "kind")]` (see `grimoire::radio::queue_events`'s
 * doc comment), since the zod codegen doesn't honor `rename_all` and
 * we'd rather match serde's real wire output than paper over the gap
 * with a codegen rewrite.
 */
export async function* pollingRadioQueueEvents(
  transport: Transport,
  filter: RadioQueueEventFilter,
  signal?: AbortSignal,
): AsyncGenerator<RadioQueueEvent, void, void> {
  let prev: RadioQueuedRequestInfo[] = [];
  let first = true;
  while (true) {
    if (signal?.aborted) return;
    let items: RadioQueuedRequestInfo[];
    try {
      items = await snapshotRadioQueueEventsViaRequest(transport, filter);
    } catch {
      // same reasoning as pollingJobEvents: a transient failure must not
      // wipe `prev`, or every still-queued request looks "new" again
      // next tick.
      await sleepOrAbort(POLL_INTERVAL_FALLBACK_MS, signal);
      continue;
    }
    if (!first) {
      const prevIndex = new Map(prev.map((r, i) => [r.id, i] as const));
      const nextIndex = new Map(items.map((r, i) => [r.id, i] as const));
      for (const r of prev) {
        if (!nextIndex.has(r.id)) {
          yield { kind: "Removed", station_id: filter.station_id, request_id: r.id };
        }
      }
      for (const [i, r] of items.entries()) {
        const before = prevIndex.get(r.id);
        if (before === undefined) {
          yield { kind: "Submitted", station_id: filter.station_id, request: r };
        } else if (before !== i) {
          yield {
            kind: "Reordered",
            station_id: filter.station_id,
            request_id: r.id,
            new_index: i,
          };
        }
      }
    }
    prev = items;
    first = false;
    await sleepOrAbort(POLL_INTERVAL_FALLBACK_MS, signal);
  }
}

function sleepOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * re-export close-reason helpers and the polling constant so consumers
 * can import a single "streaming utilities" surface from transport.ts.
 */
export type { CloseReason };
