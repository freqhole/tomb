// instance-based freqhole client
//
// provides typed methods for all API routes, using a Transport for the
// underlying request/response handling. Zod validation happens here.

import { z } from "zod";
import type { Transport, BlobData } from "./transport.js";
import { HttpTransport } from "./transport.js";
import { createAdminMethods } from "./domains/admin.js";
import { createAppMethods } from "./domains/app.js";
import { createAuthMethods } from "./domains/auth.js";
import { createMusicMethods } from "./domains/music.js";
import { createUploadMethods } from "./domains/upload.js";
import type { CallFn, SafeParseResult } from "./domains/types.js";

// re-export types for consumers
export type { SafeParseResult } from "./domains/types.js";

// sentinel for 401 detection
const AUTH_ERROR_PATH = "__auth_expired__";

// ============================================================================
// FreqholeClient
// ============================================================================

export class FreqholeClient {
  public readonly admin: ReturnType<typeof createAdminMethods>;
  public readonly app: ReturnType<typeof createAppMethods>;
  public readonly auth: ReturnType<typeof createAuthMethods>;
  public readonly music: ReturnType<typeof createMusicMethods>;
  public readonly upload: ReturnType<typeof createUploadMethods>;

  constructor(public readonly transport: Transport) {
    const call = this.createCallFn();
    this.admin = createAdminMethods(call);
    this.app = createAppMethods(call);
    this.auth = createAuthMethods(call);
    this.music = createMusicMethods(call);
    this.upload = createUploadMethods(transport);
  }

  // -------------------------------------------------------------------------
  // internal call helper factory
  // -------------------------------------------------------------------------

  private createCallFn(): CallFn {
    return async <Resp>(
      domain: string,
      routeName: string,
      respSchema: z.ZodType<Resp> | null,
      reqSchema: z.ZodTypeAny | null,
      method: string,
      path: string,
      params?: any,
    ): Promise<SafeParseResult<Resp>> => {
      // validate request body for POST/PUT/PATCH
      const isFormData = params instanceof FormData;
      if (method !== "GET" && method !== "DELETE" && method !== "HEAD" && reqSchema && params && !isFormData) {
        const validated = reqSchema.safeParse(params);
        if (!validated.success) {
          return { success: false, error: validated.error };
        }
        params = validated.data;
      }

      // interpolate path params
      let finalPath = path;
      if (params && finalPath.includes("{")) {
        finalPath = finalPath.replace(/\{(\w+)\}/g, (_, key) => {
          return params[key] !== undefined ? encodeURIComponent(params[key]) : `{${key}}`;
        });
      }

      // prepare body
      const body = method !== "GET" && method !== "DELETE" && method !== "HEAD" && params && !isFormData
        ? JSON.stringify(params)
        : undefined;

      try {
        const response = await this.transport.request(method, finalPath, body);

        if (response.status >= 400) {
          // try to extract error details
          let errorMessage = `HTTP ${response.status}`;
          let errorCode: string | undefined;
          try {
            const errorBody = JSON.parse(response.body);
            if (errorBody?.error) {
              errorMessage = `HTTP ${response.status}: ${errorBody.error}`;
            }
            if (errorBody?.code) {
              errorCode = errorBody.code;
            }
          } catch {
            // body wasn't JSON
          }

          const issuePath: (string | number)[] = [];
          if (response.status === 401) {
            issuePath.push(AUTH_ERROR_PATH);
          }
          if (errorCode) {
            issuePath.push(errorCode);
          }

          return {
            success: false,
            error: new z.ZodError([
              { code: "custom", path: issuePath, message: errorMessage },
            ]),
          };
        }

        // no response schema (e.g., blob streaming)
        if (!respSchema) {
          return { success: true, data: null as any };
        }

        // parse and validate response
        const json = JSON.parse(response.body);
        const data = json.data ?? json;

        const result = respSchema.safeParse(data);
        if (result.success) {
          return { success: true, data: result.data };
        } else {
          console.warn(`[API] Zod validation failed for ${domain}.${routeName}:`, result.error);
          return { success: false, error: result.error };
        }
      } catch (err) {
        return {
          success: false,
          error: new z.ZodError([
            { code: "custom", path: [], message: err instanceof Error ? err.message : "network error" },
          ]),
        };
      }
    };
  }

  // -------------------------------------------------------------------------
  // blob helpers
  // -------------------------------------------------------------------------

  /**
   * get a URL for a blob (audio/image)
   * for HTTP, returns direct URL. for P2P, may involve caching.
   */
  getBlobUrl(blobId: string): string | Promise<string> {
    return this.transport.getBlobUrl(blobId);
  }

  /**
   * fetch blob data directly
   */
  fetchBlob(blobId: string): Promise<BlobData> {
    return this.transport.fetchBlob(blobId);
  }
}

// ============================================================================
// factory functions
// ============================================================================

/**
 * create a FreqholeClient with the given transport
 */
export function createClient(transport: Transport): FreqholeClient {
  return new FreqholeClient(transport);
}

/**
 * create a FreqholeClient for HTTP
 * convenience function - equivalent to createClient(new HttpTransport(baseUrl, apiKey))
 */
export function createHttpClient(baseUrl: string, apiKey?: string): FreqholeClient {
  return new FreqholeClient(new HttpTransport(baseUrl, apiKey));
}

// ============================================================================
// error helpers
// ============================================================================

export function isAuthError<T>(result: SafeParseResult<T>): boolean {
  if (result.success) return false;
  return result.error.issues.some(
    (issue) => issue.code === "custom" && issue.path.includes(AUTH_ERROR_PATH),
  );
}

export function isNetworkError<T>(result: SafeParseResult<T>): boolean {
  if (result.success) return false;
  return result.error.issues.some(
    (issue) => {
      if (issue.code !== "custom") return false;
      const msg = issue.message.toLowerCase();
      
      // HTTP fetch errors
      if (msg === "failed to fetch" || msg === "network error") return true;
      
      // P2P/iroh connection errors - be generous with matching
      if (msg.includes("connection")) return true; // connection failed, closed, refused, etc
      if (msg.includes("timeout") || msg.includes("unreachable")) return true;
      if (msg.includes("closed")) return true; // ClosedPath, stream closed, etc
      if (msg.includes("no route") || msg.includes("endpoint")) return true;
      if (msg.includes("stream") && (msg.includes("error") || msg.includes("failed"))) return true;
      if (msg.includes("read") && msg.includes("error")) return true;
      
      return false;
    }
  );
}
