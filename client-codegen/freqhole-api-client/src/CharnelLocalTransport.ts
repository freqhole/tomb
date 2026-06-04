// CharnelLocalTransport - local grimoire dispatch via Tauri IPC
//
// bypasses HTTP entirely for local server access in Tauri apps.
// calls grimoire::api::dispatch directly via the api_call IPC command.
// uses Tauri's asset protocol for blob/audio file access (no HTTP streaming).

import type { Transport, TransportResponse, BlobData } from "./transport.js";
import type {
  CloseReason,
  EventFilter,
  JobEvent,
  JobStateSnapshot,
} from "./codegen/schema.js";

// tauri invoke function type
type InvokeFn = (cmd: string, args?: unknown) => Promise<unknown>;

// tauri invoke is dynamically imported to avoid bundling in browser builds
let invoke: InvokeFn | null = null;
let convertFileSrc: ((path: string) => string) | null = null;

// webkitgtk (linux) can't play asset:// URLs in <audio> elements.
// detect once at module level so we can use blob: URLs as a workaround.
//
// historically there was a second workaround here — an embedded http
// loopback server (`media_server_info` ipc + `server::media_server`)
// that served blobs via plain http. it has been removed in favor of
// the rodio backend (see `client/spume/src/music/services/audio/`),
// which bypasses the html `<audio>` element entirely on linux. when
// rodio is *not* enabled and we're on linux, we fall back to the
// blob: object url path below.
const isLinuxWebKit = typeof navigator !== "undefined" && navigator.userAgent.includes("Linux");

/**
 * initialize tauri invoke function
 */
async function ensureInvoke(): Promise<InvokeFn> {
  if (invoke) return invoke;
  try {
    const tauri = await import("@tauri-apps/api/core");
    invoke = tauri.invoke as InvokeFn;
    // also grab convertFileSrc for blob URLs
    convertFileSrc = tauri.convertFileSrc;
    return invoke;
  } catch {
    throw new Error("@tauri-apps/api not available - not running in Tauri");
  }
}

/**
 * response shape from api_call command (matches GrimoireResponse)
 */
interface ApiResponse {
  success: boolean;
  message: string;
  data?: unknown;
  errors?: Array<{ error_type: string; title: string; detail: string }>;
}

/**
 * CharnelLocalTransport - local dispatch via Tauri IPC
 *
 * implements Transport interface for use with FreqholeClient.
 * routes requests through grimoire::api::dispatch via the api_call command.
 * uses Tauri's asset protocol for blob/audio file access.
 */
export class CharnelLocalTransport implements Transport {
  // cache blob paths to avoid repeated IPC calls
  private blobPathCache = new Map<string, { path: string; mime?: string }>();
  // cache object URLs for db-stored blobs (no local path)
  private blobObjectUrlCache = new Map<string, string>();
  // single audio blob URL for linux workaround (revoke-on-replace to avoid memory leak)
  private audioBlobUrl: { blobId: string; url: string } | null = null;

  constructor(_baseUrl: string) {
    // baseUrl no longer needed - all requests go through IPC.
    // (used to also kick off an embedded http loopback server probe
    // here; that server has been removed in favor of the rodio backend.)
  }

  /**
   * make an API request via dispatch
   */
  async request(_method: string, path: string, body?: string): Promise<TransportResponse> {
    const inv = await ensureInvoke();

    // parse body string to JSON value (or null for no body)
    let jsonBody: unknown = null;
    if (body) {
      try {
        jsonBody = JSON.parse(body);
      } catch {
        jsonBody = {};
      }
    }

    try {
      // call dispatch via IPC
      const response = (await inv("api_call", {
        path,
        body: jsonBody,
      })) as ApiResponse;

      // check for route_not_found - this is now a real error
      const errorType = response.errors?.[0]?.error_type;
      if (!response.success && errorType === "route_not_found") {
        console.error(`[CharnelLocalTransport] route not found: ${path}`);
        return {
          status: 404,
          body: JSON.stringify(response),
        };
      }

      // return the full GrimoireResponse - same format as HTTP
      // FreqholeClient expects { data: ... } wrapper and extracts .data
      if (response.success) {
        return {
          status: 200,
          body: JSON.stringify(response),
        };
      } else {
        // map error to HTTP-like status
        const status = errorTypeToStatus(errorType ?? "internal_error");
        return {
          status,
          body: JSON.stringify(response),
        };
      }
    } catch (err) {
      // IPC error - treat as network error
      return {
        status: 0,
        body: JSON.stringify({
          error: err instanceof Error ? err.message : "IPC error",
        }),
      };
    }
  }

  /**
   * upload - converts FormData to base64 JSON and calls dispatch
   * 
   * for tauri-local, we use wait_for_completion to block until the job
   * finishes, avoiding the need for polling from the client side.
   */
  async upload(path: string, formData: FormData): Promise<TransportResponse> {
    // extract file and other fields from FormData
    const file = formData.get("file") as File | null;
    if (!file) {
      return {
        status: 400,
        body: JSON.stringify({
          success: false,
          message: "no file provided",
          errors: [{ error_type: "bad_request", title: "bad request", detail: "no file provided" }],
        }),
      };
    }

    // read file as base64
    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
    );

    // build JSON body for dispatch
    const body: Record<string, unknown> = {
      data: base64,
      filename: file.name,
      // tauri-local optimization: wait for job to complete instead of returning job_id
      // this eliminates the need for client-side polling
      wait_for_completion: true,
    };

    // include associate_with if present
    const associationStr = formData.get("associate_with");
    if (associationStr && typeof associationStr === "string") {
      try {
        body.associate_with = JSON.parse(associationStr);
      } catch {
        // ignore parse errors
      }
    }

    // call through normal request path
    return this.request("POST", path, JSON.stringify(body));
  }

  /**
   * upload by filesystem path - skips base64 encoding
   * uses tauri dialog plugin to get paths, passes directly to backend
   */
  async uploadByPath(
    path: string,
    filePath: string,
    metadata?: Record<string, unknown>,
  ): Promise<TransportResponse> {
    const body: Record<string, unknown> = {
      file_path: filePath,
      wait_for_completion: true,
      ...metadata,
    };

    return this.request("POST", path, JSON.stringify(body));
  }

  /**
   * fetch blob - get file path via IPC, convert to asset URL, fetch via browser
   * falls back to /api/blobs/{id}/data for db-stored blobs without local paths
   *
   * `blobId` MUST be a `media_blobz.id` short pk (7-16 hex chars).
   * sha256 / blake3 hashes are NOT valid here - they will hit the
   * `id = ?` lookup, miss, and return "blob not found". if the
   * caller only has a sha256, they need to resolve it to a
   * media_blob_id first (e.g. via the song record) before calling.
   */
  async fetchBlob(blobId: string, _blake3?: string): Promise<BlobData> {
    await ensureInvoke();

    // check if we have a cached object URL (db-stored blob)
    const cachedObjectUrl = this.blobObjectUrlCache.get(blobId);
    if (cachedObjectUrl) {
      const fetchResponse = await fetch(cachedObjectUrl);
      const arrayBuffer = await fetchResponse.arrayBuffer();
      return {
        data: new Uint8Array(arrayBuffer),
        contentType: fetchResponse.headers.get("content-type") ?? "application/octet-stream",
      };
    }

    // try to get path from cache or IPC
    let pathInfo = this.blobPathCache.get(blobId);
    if (!pathInfo) {
      const response = await this.request("GET", `/api/blobs/${blobId}/path`, undefined);
      if (response.status === 200) {
        const parsed = JSON.parse(response.body);
        if (parsed.data?.path) {
          pathInfo = { path: parsed.data.path, mime: parsed.data.mime };
          this.blobPathCache.set(blobId, pathInfo);
        }
      }
      
      // check for no_local_path error - fall back to /data endpoint
      if (!pathInfo) {
        const parsed = JSON.parse(response.body);
        const isNoLocalPath = parsed.errors?.some((e: { error_type: string }) => e.error_type === "no_local_path");
        if (isNoLocalPath || response.status !== 200) {
          return this.fetchBlobData(blobId);
        }
        throw new Error(`failed to get blob path: ${response.body}`);
      }
    }

    if (!convertFileSrc) {
      throw new Error("convertFileSrc not available");
    }

    // convert to asset URL and fetch via browser
    const assetUrl = convertFileSrc(pathInfo.path);
    const fetchResponse = await fetch(assetUrl);
    const arrayBuffer = await fetchResponse.arrayBuffer();

    return {
      data: new Uint8Array(arrayBuffer),
      contentType: pathInfo.mime ?? "application/octet-stream",
    };
  }

  /**
   * fetch blob data via /api/blobs/{id}/data - for db-stored blobs
   * returns base64-decoded data and creates/caches object URL
   */
  private async fetchBlobData(blobId: string): Promise<BlobData> {
    const response = await this.request("GET", `/api/blobs/${blobId}/data`, undefined);
    if (response.status !== 200) {
      throw new Error(`failed to get blob data: ${response.body}`);
    }
    
    const parsed = JSON.parse(response.body);
    if (!parsed.data?.data) {
      throw new Error(`blob data not found: ${blobId}`);
    }
    
    // decode base64 to Uint8Array
    const binaryString = atob(parsed.data.data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    const mime = parsed.data.mime ?? "application/octet-stream";
    
    // create and cache object URL for future use
    const blob = new Blob([bytes], { type: mime });
    const objectUrl = URL.createObjectURL(blob);
    this.blobObjectUrlCache.set(blobId, objectUrl);
    
    return {
      data: bytes,
      contentType: mime,
    };
  }

  /**
   * get blob URL — preference order:
   * 1. cached object URL (db-stored blobs)
   * 2. tauri asset:// (via `convertFileSrc`) on macos/windows
   * 3. linux fallback: fetch via asset:// and wrap in a blob: object URL
   *    (webkitgtk can't stream asset:// into `<audio>`)
   *
   * note: when the rodio audio backend is enabled (charnel + opt-in)
   * playback bypasses html `<audio>` entirely and reads files via
   * filesystem path — this method is unused for that path.
   */
  getBlobUrl(blobId: string, _blake3?: string): string | Promise<string> {
    // check object URL cache first (db-stored blobs)
    const cachedObjectUrl = this.blobObjectUrlCache.get(blobId);
    if (cachedObjectUrl) {
      console.debug(`[CharnelLocalTransport] blob ${blobId}: object-url cache`);
      return cachedObjectUrl;
    }

    // on linux without rodio, we MUST go async to wrap in a blob:
    // url (asset:// can't stream into <audio> on webkitgtk).
    if (isLinuxWebKit) {
      console.debug(`[CharnelLocalTransport] blob ${blobId}: linux fallback (async)`);
      return this.getBlobUrlAsync(blobId);
    }

    // check path cache (filesystem blobs) — direct asset:// url
    const cached = this.blobPathCache.get(blobId);
    if (cached && convertFileSrc) {
      const url = convertFileSrc(cached.path);
      console.debug(`[CharnelLocalTransport] blob ${blobId}: asset:// (cached) -> ${url}`);
      return url;
    }

    // need to fetch path (or data) first
    // console.debug(`[CharnelLocalTransport] blob ${blobId}: async path lookup`);
    return this.getBlobUrlAsync(blobId);
  }

  /**
   * async version of getBlobUrl for uncached blobs
   * tries path first, falls back to /data for db-stored blobs
   */
  private async getBlobUrlAsync(blobId: string): Promise<string> {
    await ensureInvoke(); // ensure convertFileSrc is loaded

    const response = await this.request("GET", `/api/blobs/${blobId}/path`, undefined);
    
    if (response.status === 200) {
      const parsed = JSON.parse(response.body);
      if (parsed.data?.path) {
        // cache path for future use
        this.blobPathCache.set(blobId, { path: parsed.data.path, mime: parsed.data.mime });

        if (!convertFileSrc) {
          throw new Error("convertFileSrc not available");
        }

        // on linux without media server: fall back to blob: workaround.
        // routes audio + image differently:
        //   - audio: single-slot cache (revoke-on-replace) since audio
        //     blobs are large and we only play one at a time
        //   - other (images / waveforms / cover art): per-blob cache so
        //     multiple `<img>` and css `background-image` urls coexist
        //     across the playerbar, queue sidebar, etc.
        if (isLinuxWebKit) {
          return this.createBlobObjectUrl(blobId, parsed.data.path, parsed.data.mime);
        }

        return convertFileSrc(parsed.data.path);
      }
    }
    
    // check for no_local_path - fall back to /data endpoint
    const parsed = JSON.parse(response.body);
    const isNoLocalPath = parsed.errors?.some((e: { error_type: string }) => e.error_type === "no_local_path");
    
    if (isNoLocalPath) {
      // fetch blob data and create object URL
      await this.fetchBlobData(blobId);
      const objectUrl = this.blobObjectUrlCache.get(blobId);
      if (objectUrl) {
        return objectUrl;
      }
    }
    
    throw new Error(`failed to get blob path: ${response.body}`);
  }

  /**
   * create a blob: object URL by fetching via asset:// protocol.
   * used on linux where webkitgtk can't play asset:// in `<audio>`
   * elements (and historically also where the embedded http loopback
   * server stood in for the same workaround).
   *
   * mime-aware caching:
   *   - `audio/*`: single-slot cache, revoke-on-replace. audio blobs
   *     are large (often tens of MB) and only one ever plays at a
   *     time, so leaking the rest is wasteful.
   *   - everything else (images, waveforms, cover art): stored in
   *     `blobObjectUrlCache` keyed by blob id so multiple `<img>` /
   *     css `background-image` references coexist without one
   *     revoking another.
   */
  private async createBlobObjectUrl(blobId: string, localPath: string, mime?: string): Promise<string> {
    if (!convertFileSrc) {
      throw new Error("convertFileSrc not available");
    }

    const isAudio = (mime ?? "").startsWith("audio/");
    const effectiveMime = mime ?? (isAudio ? "audio/mpeg" : "application/octet-stream");

    const assetUrl = convertFileSrc(localPath);
    const resp = await fetch(assetUrl);
    const arrayBuffer = await resp.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: effectiveMime });
    const objectUrl = URL.createObjectURL(blob);

    if (isAudio) {
      // revoke previous single-slot audio url (if any) so we don't
      // leak large buffers as the user moves between tracks.
      if (this.audioBlobUrl) {
        URL.revokeObjectURL(this.audioBlobUrl.url);
      }
      this.audioBlobUrl = { blobId, url: objectUrl };
    } else {
      // per-blob cache so e.g. the playerbar's waveform and the queue
      // sidebar's matching waveform share a single object url.
      this.blobObjectUrlCache.set(blobId, objectUrl);
    }
    return objectUrl;
  }

  // -----------------------------------------------------------------
  // job events (local ipc shortcut)
  //
  // skips the iroh `freqhole-events/1` hop entirely when charnel is
  // talking to the in-process grimoire server. uses the
  // `jobs_events_snapshot` / `jobs_events_subscribe` /
  // `jobs_events_unsubscribe` tauri commands.
  //
  // remote-targeting (open EVENTS_ALPN bistream against a peer) is
  // deferred — when it lands, charnel will pick local-vs-remote based
  // on the "currently-targeted remote peer" config.
  // -----------------------------------------------------------------

  async snapshotJobEvents(filter?: EventFilter): Promise<JobStateSnapshot[]> {
    const inv = await ensureInvoke();
    const out = (await inv("jobs_events_snapshot", {
      filter: filter ?? null,
    })) as JobStateSnapshot[];
    return out;
  }

  subscribeJobEvents(
    filter?: EventFilter,
    signal?: AbortSignal,
  ): AsyncIterable<JobEvent> {
    return charnelJobEventsIterable(filter, signal);
  }
}

/**
 * map error_type to HTTP status code
 */
function errorTypeToStatus(errorType: string): number {
  switch (errorType) {
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
    case "route_not_found":
      return 404;
    case "bad_request":
      return 400;
    default:
      return 500;
  }
}

/**
 * create a CharnelLocalTransport instance
 * @param baseUrl - ignored (kept for API compatibility)
 */
export function createCharnelLocalTransport(baseUrl: string): CharnelLocalTransport {
  return new CharnelLocalTransport(baseUrl);
}

// =====================================================================
// job events iterator (tauri channel -> async iterable adapter)
// =====================================================================

/**
 * frame shape emitted by the rust-side `JobsEventsFrame`. mirrors
 * `EventsServerMsg` from `events_protocol.rs` but flattened — no
 * per-bistream correlation id (per-channel on tauri makes it unneeded).
 */
type JobsEventsFrame =
  | { kind: "event"; evt: JobEvent }
  | { kind: "closed"; reason: CloseReason };

async function* charnelJobEventsIterable(
  filter: EventFilter | undefined,
  signal: AbortSignal | undefined,
): AsyncGenerator<JobEvent, void, void> {
  const inv = await ensureInvoke();
  // tauri `Channel` is constructed dynamically — same `@tauri-apps/api/core`
  // module that exports `invoke`. dynamic import here mirrors the pattern
  // above (the transport may also run in a non-tauri browser context where
  // the module is absent).
  const { Channel } = await import("@tauri-apps/api/core");

  // bounded queue of frames the rust side has pushed but js hasn't
  // consumed yet. wakers signal new arrivals.
  const queue: JobsEventsFrame[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  const waitForFrame = () =>
    new Promise<void>((resolve) => {
      wake = () => {
        wake = null;
        resolve();
      };
    });

  const channel = new Channel<JobsEventsFrame>();
  channel.onmessage = (frame: JobsEventsFrame) => {
    queue.push(frame);
    if (frame.kind === "closed") closed = true;
    wake?.();
  };

  let sessionId: string;
  try {
    sessionId = (await inv("jobs_events_subscribe", {
      filter: filter ?? null,
      events: channel,
    })) as string;
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }

  const onAbort = () => {
    closed = true;
    inv("jobs_events_unsubscribe", { sessionId }).catch(() => {});
    wake?.();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      if (queue.length === 0) {
        if (closed) return;
        if (signal?.aborted) return;
        await waitForFrame();
        continue;
      }
      const frame = queue.shift()!;
      if (frame.kind === "closed") {
        // surface the close reason as a typed error so consumers can
        // distinguish `Lagged` (re-snapshot + reconnect) from other
        // terminal conditions.
        const reasonKind =
          (frame.reason as { kind: string }).kind ?? "internal";
        if (reasonKind === "client_unsubscribed") return;
        throw new JobEventsStreamClosed(frame.reason);
      }
      yield frame.evt;
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (!closed) {
      try {
        await inv("jobs_events_unsubscribe", { sessionId });
      } catch {
        // session may have already been torn down server-side; nothing
        // to do.
      }
    }
  }
}

/**
 * thrown by the subscribe iterator on any non-`client_unsubscribed`
 * `CloseReason`. exported so consumers can `instanceof`-check before
 * deciding to reconnect.
 */
export class JobEventsStreamClosed extends Error {
  constructor(public readonly reason: CloseReason) {
    const kind = (reason as { kind: string }).kind ?? "internal";
    super(`job events stream closed: ${kind}`);
    this.name = "JobEventsStreamClosed";
  }
}
