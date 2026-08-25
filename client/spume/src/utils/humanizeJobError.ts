// shared "turn a raw server job failure into a short, human-readable line"
// logic for music and video import (client/spume/src/{music,video}/import/
// remoteImport.ts). the full detail always stays available via `full` for
// a tooltip - this only picks a short label for the job list row.
//
// error_type -> message text is sourced from @freqhole/api-client's
// ERROR_TYPE_MESSAGES (the canonical, transport-agnostic registry - see
// docs/error-handling.md). this file only adds job-polling-specific
// concerns on top: un-tagged legacy message string matching (for job
// failures recorded before an error_type existed), and short-label
// truncation for the job list row.
import { ERROR_TYPE_MESSAGES } from "@freqhole/api-client";

export interface FriendlyError {
  short: string;
  full: string;
}

export function humanizeJobError(
  message: string | undefined,
  errorType: string | undefined,
  formatLabel: "audio" | "video" = "audio"
): FriendlyError {
  const full = message?.trim() || errorType || "failed";
  if (errorType && ERROR_TYPE_MESSAGES[errorType]) {
    return { short: ERROR_TYPE_MESSAGES[errorType], full };
  }
  const m = (message ?? "").toLowerCase();
  if (m.startsWith("file does not exist") || m.includes("downloaded file"))
    return { short: "downloaded file vanished before processing", full };
  if (m.includes("no files were downloaded") || m.includes("nothing downloaded"))
    return { short: "source returned no files", full };
  // fallback for older/un-tagged messages - error_type above is preferred,
  // but stays in sync with grimoire's UNRECOVERABLE_PATTERNS so a message
  // that arrives without (or with a stale) error_type is still specific.
  if (m.includes("not configured") || m.includes("is not enabled"))
    return { short: "downloading from urls isn't set up on this server", full };
  if (m.includes("http error 403"))
    return { short: "source blocked the request (403) — may need login/cookies", full };
  if (m.includes("http error 404"))
    return { short: "video not found (404) — may have been deleted", full };
  if (m.includes("video unavailable")) return { short: "video is unavailable", full };
  if (m.includes("private video")) return { short: "video is private", full };
  if (m.includes("no longer available")) return { short: "video is no longer available", full };
  if (m.includes("content isn't available"))
    return { short: "content isn't available (region-locked?)", full };
  if (m.includes("sign in to confirm"))
    return {
      short: "site requires sign-in verification — can't fetch without cookies",
      full,
    };
  if (m.includes("invalid url") || m.includes("unsupported url"))
    return { short: "unsupported or invalid URL", full };
  if (m.includes("connection") || m.includes("network") || m.includes("dns"))
    return { short: "network error", full };
  if (m.includes("permission denied") || m.includes("forbidden"))
    return { short: "permission denied", full };
  if (m.includes("timeout") || m.includes("timed out")) return { short: "timed out", full };
  if (m.includes("unsupported format") || m.includes("unknown format"))
    return { short: `unsupported ${formatLabel} format`, full };
  // short message: keep as-is. long message: truncate.
  const cleaned = full.replace(/\s+/g, " ");
  const short = cleaned.length > 80 ? cleaned.slice(0, 77) + "\u2026" : cleaned;
  return { short, full };
}
