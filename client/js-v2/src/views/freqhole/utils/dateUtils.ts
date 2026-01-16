/**
 * Date utility functions for the freqhole music app
 */

/**
 * Converts server date format to ISO format that JavaScript can parse
 * Server format: "2025-07-12 18:25:59.061688 +00:00:00" or "2025-07-12 5:51:01.865844 +00:00:00"
 * ISO format: "2025-07-12T18:25:59.061688Z"
 */
export function normalizeServerDate(dateStr: string): string {
  if (!dateStr) return dateStr;

  // Handle the server's date format
  if (dateStr.includes("+00:00:00")) {
    let normalized = dateStr.replace(" +00:00:00", "Z").replace(" ", "T");

    // Fix single-digit hours by padding with zero
    // Pattern: "2025-07-12T5:51:01" should become "2025-07-12T05:51:01"
    normalized = normalized.replace(/T(\d):/, "T0$1:");

    return normalized;
  }

  return dateStr;
}

/**
 * Formats a date string as a relative time (e.g., "2 hours ago", "yesterday")
 * For use in detailed views like playlist headers
 */
export function formatRelativeDate(dateStr: string): string {
  if (!dateStr) return "Unknown";

  const isoDateStr = normalizeServerDate(dateStr);
  const date = new Date(isoDateStr);

  if (isNaN(date.getTime())) {
    return "Unknown";
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffSecs < 60) {
    return "created just now";
  } else if (diffMins < 60) {
    return `created ${diffMins} minute${diffMins === 1 ? "" : "s"} ago`;
  } else if (diffHours < 24) {
    return `created ${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  } else if (diffDays === 1) {
    return "created yesterday";
  } else if (diffDays < 7) {
    return `created ${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  } else if (diffWeeks === 1) {
    return "created last week";
  } else if (diffWeeks < 4) {
    return `created ${diffWeeks} week${diffWeeks === 1 ? "" : "s"} ago`;
  } else if (diffMonths === 1) {
    return "created last month";
  } else if (diffMonths < 12) {
    return `created ${diffMonths} month${diffMonths === 1 ? "" : "s"} ago`;
  } else if (diffYears === 1) {
    return "created last year";
  } else {
    return `created ${date.toLocaleDateString()}`;
  }
}

/**
 * Formats a date string as a compact relative time (e.g., "2h ago", "yesterday")
 * For use in compact views like navigation lists
 */
export function formatCompactRelativeDate(dateStr: string): string {
  if (!dateStr) return "";

  const isoDateStr = normalizeServerDate(dateStr);
  const date = new Date(isoDateStr);

  if (isNaN(date.getTime())) return "";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffSecs < 60) {
    return "just now";
  } else if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays === 1) {
    return "yesterday";
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else if (diffWeeks === 1) {
    return "last week";
  } else if (diffWeeks < 4) {
    return `${diffWeeks}w ago`;
  } else if (diffMonths === 1) {
    return "last month";
  } else if (diffMonths < 12) {
    return `${diffMonths}mo ago`;
  } else {
    return date.toLocaleDateString();
  }
}

/**
 * Formats a date string as an absolute date (fallback for very old dates)
 */
export function formatAbsoluteDate(dateStr: string): string {
  if (!dateStr) return "Unknown";

  const isoDateStr = normalizeServerDate(dateStr);
  const date = new Date(isoDateStr);

  if (isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleDateString();
}
