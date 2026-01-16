/**
 * Relative time formatting utilities using native JavaScript APIs
 */

/**
 * Format a date as relative time (e.g., "2 hours ago", "last week")
 * Falls back to year-only for dates older than ~1 year
 */
export function formatRelativeTime(date: string | Date): string {
  const now = new Date();
  const targetDate = typeof date === "string" ? new Date(date) : date;

  // Handle invalid dates
  if (isNaN(targetDate.getTime())) {
    return "Invalid date";
  }

  const diffMs = now.getTime() - targetDate.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  // Handle future dates (clock skew or timezone issues)
  if (diffMs < 0) {
    return "just now";
  }

  // For dates more than ~1 year old, just show the year
  if (diffYears >= 1) {
    return targetDate.getFullYear().toString();
  }

  // Use Intl.RelativeTimeFormat for relative formatting
  const rtf = new Intl.RelativeTimeFormat("en", {
    numeric: "auto", // This gives us "last week" instead of "1 week ago"
    style: "long",
  });

  // Recent times (less than 1 minute)
  if (diffSeconds < 60) {
    if (diffSeconds < 10) {
      return "a moment ago";
    }
    return rtf.format(-diffSeconds, "second");
  }

  // Minutes
  if (diffMinutes < 60) {
    return rtf.format(-diffMinutes, "minute");
  }

  // Hours
  if (diffHours < 24) {
    return rtf.format(-diffHours, "hour");
  }

  // Days
  if (diffDays < 7) {
    return rtf.format(-diffDays, "day");
  }

  // Weeks
  if (diffWeeks < 5) {
    return rtf.format(-diffWeeks, "week");
  }

  // Months - only show if there's at least 1 month AND it's been at least 25 days
  if (diffMonths >= 1 && diffDays >= 25) {
    if (diffMonths < 12) {
      return rtf.format(-diffMonths, "month");
    }
  }

  // Fallback for edge cases (recent but not quite a month)
  if (diffDays >= 25) {
    return rtf.format(-Math.floor(diffDays / 7), "week");
  }

  // Fallback (shouldn't reach here due to year check above)
  return targetDate.getFullYear().toString();
}

/**
 * Format a date as a full readable string for tooltips
 */
export function formatFullDateTime(date: string | Date): string {
  const targetDate = typeof date === "string" ? new Date(date) : date;

  // Handle invalid dates
  if (isNaN(targetDate.getTime())) {
    return "Invalid date";
  }

  // Use Intl.DateTimeFormat for locale-aware formatting
  const formatter = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });

  return formatter.format(targetDate);
}

/**
 * Combined function that returns both relative and full formats
 */
export function formatDateWithTooltip(date: string | Date): {
  relative: string;
  full: string;
} {
  return {
    relative: formatRelativeTime(date),
    full: formatFullDateTime(date),
  };
}
