// format seconds to MM:SS (for song durations)
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds) || seconds < 0) return "0:00";
  const totalSeconds = Math.round(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// format seconds to HH:MM:SS or MM:SS (for album/playlist durations)
export function formatLongDuration(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds) || seconds < 0) return "0:00";
  const totalSeconds = Math.round(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  
  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// format seconds to human readable (e.g., "2h 30m", "3d 5h", "2w 1d")
// scales up to larger units only when needed
export function formatHumanDuration(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds) || seconds < 0) return "0m";
  const totalSeconds = Math.round(seconds);
  
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const days = Math.floor(totalSeconds / 86400) % 7;
  const weeks = Math.floor(totalSeconds / 604800);
  
  // show weeks + days for very large durations (1+ weeks)
  if (weeks > 0) {
    if (days > 0) return `${weeks}w ${days}d`;
    return `${weeks}w`;
  }
  
  // show days + hours for large durations (1+ days)
  if (days > 0) {
    if (hours > 0) return `${days}d ${hours}h`;
    return `${days}d`;
  }
  
  // show hours + minutes for medium durations
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  
  return `${minutes}m`;
}
