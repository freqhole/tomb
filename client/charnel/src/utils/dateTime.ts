export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const dateStr = date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const timeStr = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dateStr} at ${timeStr}`;
}

export function formatRelativeTime(date: string | Date | number, now = new Date()): string {
  const targetDate = date instanceof Date ? date : new Date(date);
  if (isNaN(targetDate.getTime())) return "invalid date";

  const diffMs = now.getTime() - targetDate.getTime();
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (diffMs < 0) return "just now";
  if (years >= 1) return targetDate.getFullYear().toString();

  const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "long" });
  if (seconds < 10) return "a moment ago";
  if (seconds < 60) return relative.format(-seconds, "second");
  if (minutes < 60) return relative.format(-minutes, "minute");
  if (hours < 24) return relative.format(-hours, "hour");
  if (days < 7) return relative.format(-days, "day");
  if (weeks < 5 && months === 0) return relative.format(-weeks, "week");
  if (months >= 1 && days >= 25 && months < 12) return relative.format(-months, "month");
  if (days >= 25) return relative.format(-weeks, "week");
  return targetDate.getFullYear().toString();
}
