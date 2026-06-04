// transport abstraction for HTTP and P2P
//
// transports handle the low-level request/response mechanics.
// FreqholeClient uses a transport to make requests, then handles
// Zod validation on top.

import type {
  CloseReason,
  EventFilter,
  JobEvent,
  JobStateSnapshot,
} from "./codegen/schema.js";

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
   * @returns response with status code and body string
   */
  upload(path: string, formData: FormData): Promise<TransportResponse>;

  /**
   * fetch a blob by ID
   * @param blobId - the blob ID to fetch
   * @param blake3 - optional blake3 hash for verified streaming via iroh-blobs
   * @returns blob data with content type
   */
  fetchBlob(blobId: string, blake3?: string): Promise<BlobData>;

  /**
   * get a URL for a blob (for <audio>/<img> src)
   * HTTP transport returns direct URL, P2P transports may need caching
   * @param blobId - the blob ID to fetch
   * @param blake3 - optional blake3 hash for verified streaming via iroh-blobs
   */
  getBlobUrl(blobId: string, blake3?: string): string | Promise<string>;

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
   */
  getBlobUrlWithProgress?(
    blobId: string,
    onProgress: (received: number, total: number) => void,
    blake3?: string,
    totalBytes?: number,
    mimeType?: string,
  ): Promise<string>;

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
  subscribeJobEvents?(
    filter?: EventFilter,
    signal?: AbortSignal,
  ): AsyncIterable<JobEvent>;
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

  async upload(path: string, formData: FormData): Promise<TransportResponse> {
    const url = this.baseUrl + path;
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

    return {
      status: response.status,
      body: responseBody,
    };
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

  subscribeJobEvents(
    filter?: EventFilter,
    signal?: AbortSignal,
  ): AsyncIterable<JobEvent> {
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
  const resp = await transport.request(
    "POST",
    "/api/jobs/events/snapshot",
    body,
  );
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
    let snaps: JobStateSnapshot[] = [];
    try {
      snaps = await snapshotJobEventsViaRequest(transport, filter);
    } catch {
      // swallow; try again next tick. callers can fail-fast by
      // observing snapshot errors separately via snapshotJobEvents.
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
