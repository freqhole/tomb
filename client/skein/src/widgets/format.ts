/**
 * shared formatting utilities for skein widgets.
 */

/**
 * format a timestamp as a relative time string (e.g. "2h ago", "3d ago").
 * accepts a unix timestamp in milliseconds or an ISO date string.
 */
export function formatRelativeTime(timestamp: number | string): string {
  const ts = typeof timestamp === "string" ? new Date(timestamp).getTime() : timestamp;
  if (isNaN(ts)) return "";

  const now = Date.now();
  const diffMs = now - ts;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  const diffWeek = Math.floor(diffDay / 7);
  const diffMonth = Math.floor(diffDay / 30);
  const diffYear = Math.floor(diffDay / 365);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffWeek < 4) return `${diffWeek}w ago`;
  if (diffMonth < 12) return `${diffMonth}mo ago`;
  return `${diffYear}y ago`;
}

/**
 * format a timestamp as a short date string (e.g. "jan 15, 2025").
 * uses lowercase month abbreviation to match the project's prose style.
 */
export function formatShortDate(timestamp: number | string): string {
  const ts = typeof timestamp === "string" ? new Date(timestamp).getTime() : timestamp;
  if (isNaN(ts)) return "";

  const date = new Date(ts);
  const months = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
  ];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/**
 * convert a numeric color (e.g. 0xd946ef) to a CSS hex string (e.g. "#d946ef").
 * returns "transparent" for the transparent sentinel (-1).
 */
export function colorToCss(color: number): string {
  if (color === -1) return "transparent";
  return "#" + color.toString(16).padStart(6, "0");
}
