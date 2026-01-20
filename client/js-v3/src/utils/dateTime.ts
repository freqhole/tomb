// date and time utility functions

/**
 * format a date as relative time (e.g., "2 hours ago", "last week")
 * falls back to year-only for dates older than ~1 year
 */
export function formatRelativeTime(date: string | Date | number): string {
  const now = new Date();
  const targetDate =
    typeof date === "string"
      ? new Date(date)
      : typeof date === "number"
        ? new Date(date)
        : date;

  // handle invalid dates
  if (isNaN(targetDate.getTime())) {
    return "invalid date";
  }

  const diffMs = now.getTime() - targetDate.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  // handle future dates (clock skew or timezone issues)
  if (diffMs < 0) {
    return "just now";
  }

  // for dates more than ~1 year old, just show the year
  if (diffYears >= 1) {
    return targetDate.getFullYear().toString();
  }

  // use Intl.RelativeTimeFormat for relative formatting
  const rtf = new Intl.RelativeTimeFormat("en", {
    numeric: "auto", // this gives us "last week" instead of "1 week ago"
    style: "long",
  });

  // recent times (less than 1 minute)
  if (diffSeconds < 60) {
    if (diffSeconds < 10) {
      return "a moment ago";
    }
    return rtf.format(-diffSeconds, "second");
  }

  // minutes
  if (diffMinutes < 60) {
    return rtf.format(-diffMinutes, "minute");
  }

  // hours
  if (diffHours < 24) {
    return rtf.format(-diffHours, "hour");
  }

  // days
  if (diffDays < 7) {
    return rtf.format(-diffDays, "day");
  }

  // weeks
  if (diffWeeks < 5) {
    return rtf.format(-diffWeeks, "week");
  }

  // months - only show if there's at least 1 month AND it's been at least 25 days
  if (diffMonths >= 1 && diffDays >= 25) {
    if (diffMonths < 12) {
      return rtf.format(-diffMonths, "month");
    }
  }

  // fallback for edge cases (recent but not quite a month)
  if (diffDays >= 25) {
    return rtf.format(-Math.floor(diffDays / 7), "week");
  }

  // fallback (shouldn't reach here due to year check above)
  return targetDate.getFullYear().toString();
}
