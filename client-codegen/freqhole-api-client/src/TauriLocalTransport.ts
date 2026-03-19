// TauriLocalTransport - local grimoire dispatch via Tauri IPC
//
// bypasses HTTP entirely for local server access in Tauri apps.
// calls grimoire::api::dispatch directly via the api_call IPC command.
// uses Tauri's asset protocol for blob/audio file access (no HTTP streaming).

import type { Transport, TransportResponse, BlobData } from "./transport.js";

// tauri invoke function type
type InvokeFn = (cmd: string, args?: unknown) => Promise<unknown>;

// tauri invoke is dynamically imported to avoid bundling in browser builds
let invoke: InvokeFn | null = null;
let convertFileSrc: ((path: string) => string) | null = null;

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
 * TauriLocalTransport - local dispatch via Tauri IPC
 *
 * implements Transport interface for use with FreqholeClient.
 * routes requests through grimoire::api::dispatch via the api_call command.
 * uses Tauri's asset protocol for blob/audio file access.
 */
export class TauriLocalTransport implements Transport {
  // cache blob paths to avoid repeated IPC calls
  private blobPathCache = new Map<string, { path: string; mime?: string }>();
  // cache object URLs for db-stored blobs (no local path)
  private blobObjectUrlCache = new Map<string, string>();

  constructor(_baseUrl: string) {
    // baseUrl no longer needed - all requests go through IPC
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
        console.error(`[TauriLocalTransport] route not found: ${path}`);
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
   * get blob URL - returns Tauri asset:// URL for direct <audio>/<img> src usage
   * for db-stored blobs, returns object URL from cached data
   */
  getBlobUrl(blobId: string, _blake3?: string): string | Promise<string> {
    // check object URL cache first (db-stored blobs)
    const cachedObjectUrl = this.blobObjectUrlCache.get(blobId);
    if (cachedObjectUrl) {
      return cachedObjectUrl;
    }
    
    // check path cache (filesystem blobs)
    const cached = this.blobPathCache.get(blobId);
    if (cached && convertFileSrc) {
      return convertFileSrc(cached.path);
    }

    // need to fetch path (or data) first
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
        // cache it
        this.blobPathCache.set(blobId, { path: parsed.data.path, mime: parsed.data.mime });

        if (!convertFileSrc) {
          throw new Error("convertFileSrc not available");
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
 * create a TauriLocalTransport instance
 * @param baseUrl - ignored (kept for API compatibility)
 */
export function createTauriLocalTransport(baseUrl: string): TauriLocalTransport {
  return new TauriLocalTransport(baseUrl);
}
