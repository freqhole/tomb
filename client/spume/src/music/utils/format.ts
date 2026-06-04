// format utilities for display strings

// turn a raw taxon/genre label into a display-friendly form. swaps
// underscores for spaces; trims edges. used everywhere we render
// taxon labels so values like `post_punk` show as `post punk`.
export function formatTaxonLabel(label: string | null | undefined): string {
  if (!label) return "";
  return label.replace(/_/g, " ").trim();
}

// format bytes to human-readable size
export function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

// format number with thousands separator
export function formatNumber(num: number): string {
  return num.toLocaleString();
}

// format relative time (e.g. "2 hours ago", "3 days ago")
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
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

// create artist abbreviation (up to 3 letters from first words)
// - only uses alphanumeric characters
// - if name is a single all-caps word (like "AFI"), use first 3 chars
export function getArtistAbbreviation(name: string): string {
  const trimmed = name.trim();
  
  // check if it's a single all-caps word (like "AFI", "REM", "KMFDM")
  if (/^[A-Z0-9]+$/.test(trimmed) && !trimmed.includes(" ")) {
    return trimmed.slice(0, 3);
  }
  
  const words = trimmed.split(" ").filter(w => w.length > 0);
  const letters = words
    .slice(0, 3)
    .map(w => {
      // find first alphanumeric character
      const match = w.match(/[A-Za-z0-9]/);
      return match ? match[0].toUpperCase() : "";
    })
    .filter(l => l.length > 0);
  return letters.join("");
}
