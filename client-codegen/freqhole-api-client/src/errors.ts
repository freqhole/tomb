// shared "turn a raw failed-request body into a typed, human-readable
// error" logic, used by every transport/domain method that has to parse a
// non-2xx response (FreqholeClient's json route caller, domains/upload.ts's
// multipart uploads, etc). this is the ONE place that understands both
// server-side failure shapes:
//
//   - the axum `ApiError` shape: `{ error, code, error_type? }` (see
//     server/src/error.rs) - used for request-level failures (bad request,
//     unauthorized, or a `GrimoireError` surfaced via `?`).
//   - the `GrimoireResponse` failure shape: `{ success: false, message,
//     errors: ErrorDetail[] }` (see grimoire/src/response.rs) - used by
//     offal-dispatched routes that fail after starting a "success" response.
//
// both carry the same underlying idea: a stable snake_case `error_type`
// code plus a human `detail`/`message`. everything downstream (isAuthError,
// job-error checks, UI error banners) should key off `error_type`, never
// off substring-matching a message - see docs/error-handling.md.

import { z } from "zod";

/** sentinel path segment marking a 401/session-expired failure. */
export const AUTH_ERROR_PATH = "__auth_expired__";

export interface ParsedApiError {
  /** best available human-readable message - never empty. */
  message: string;
  /** stable error_type code, when the server provided one. */
  errorType?: string;
}

// curated overrides for error_type codes whose server-provided detail
// reads badly to an end user (too technical, or missing entirely for
// codes that only ever carry a generic `detail`). this is NOT meant to
// cover every error_type - anything absent here just falls back to the
// server's own `detail`/`message`, which is normally fine on its own.
// exported so callers with extra context (e.g. spume's humanizeJobError,
// which also handles un-tagged legacy message strings) can extend this
// same table instead of maintaining a separate, drifting copy.
export const ERROR_TYPE_MESSAGES: Record<string, string> = {
  unauthorized: "your session has expired - please sign in again",
  forbidden: "you don't have permission to do that",
  route_not_found: "that server doesn't support this feature (server may need an update)",
  duplicate_song: "this song already exists in the library",
  duplicate_video: "this video already exists in the library",
  fetch_not_configured: "downloading from urls isn't set up on this server",
  fetch_forbidden: "source blocked the request (403) - it may require login/cookies",
  fetch_not_found: "source returned 404 - the video may have been deleted, or the url is wrong",
  fetch_video_unavailable: "video is unavailable",
  fetch_private_video: "video is private",
  fetch_video_removed: "video is no longer available",
  fetch_content_unavailable: "content isn't available (may be region-locked)",
  fetch_login_required:
    "site requires sign-in verification - can't fetch without cookies configured",
};

function bodyFallbackMessage(status: number): string {
  return status === 0 ? "connection error" : `request failed (HTTP ${status})`;
}

/** parse a raw HTTP/IPC response body into a best-effort {@link ParsedApiError}. */
export function parseErrorResponseBody(body: string, status: number): ParsedApiError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { message: bodyFallbackMessage(status) };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { message: bodyFallbackMessage(status) };
  }
  const obj = parsed as Record<string, unknown>;

  // GrimoireResponse failure shape: {success:false, message, errors:[{error_type,title,detail}]}
  if (obj.success === false) {
    const firstError =
      Array.isArray(obj.errors) && obj.errors.length > 0
        ? (obj.errors[0] as Record<string, unknown>)
        : undefined;
    const errorType =
      typeof firstError?.error_type === "string" ? firstError.error_type : undefined;
    const message =
      (typeof firstError?.detail === "string" && firstError.detail) ||
      (typeof obj.message === "string" && obj.message) ||
      bodyFallbackMessage(status);
    return { message, errorType };
  }

  // axum ApiError shape: {error, code, error_type?}
  if (
    typeof obj.error === "string" ||
    typeof obj.code === "string" ||
    typeof obj.error_type === "string"
  ) {
    const errorType =
      (typeof obj.error_type === "string" && obj.error_type) ||
      (typeof obj.code === "string" && obj.code) ||
      undefined;
    const message =
      (typeof obj.error === "string" && obj.error) ||
      (typeof obj.message === "string" && obj.message) ||
      bodyFallbackMessage(status);
    return { message, errorType };
  }

  return { message: bodyFallbackMessage(status) };
}

/** apply the friendly-message registry on top of a {@link ParsedApiError}. */
export function friendlyMessage(parsed: ParsedApiError): string {
  if (parsed.errorType && ERROR_TYPE_MESSAGES[parsed.errorType]) {
    return ERROR_TYPE_MESSAGES[parsed.errorType];
  }
  return parsed.message;
}

/**
 * build the zod issue used by every transport's error branch: `path`
 * carries the error_type (and the auth sentinel on 401) so existing
 * `isAuthError`/`errors?.some(e => path.includes(...))`-style checks keep
 * working, `message` is the friendliest text available.
 */
export function buildErrorIssue(
  parsed: ParsedApiError,
  status: number,
): { code: "custom"; path: (string | number)[]; message: string } {
  const path: (string | number)[] = [];
  if (status === 401 || parsed.errorType === "unauthorized") path.push(AUTH_ERROR_PATH);
  if (parsed.errorType) path.push(parsed.errorType);
  return { code: "custom", path, message: friendlyMessage(parsed) };
}

/** parse + wrap a failed response body straight into a `z.ZodError`. */
export function toZodError(body: string, status: number): z.ZodError {
  return new z.ZodError([buildErrorIssue(parseErrorResponseBody(body, status), status)]);
}
