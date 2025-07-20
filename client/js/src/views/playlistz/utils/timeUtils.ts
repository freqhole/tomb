// Time Utilities with Global Polling System
// Enhanced relative time function with broader time windows and efficient updates

import { createSignal } from "solid-js";

// Global time updater for managing all relative time signals
const timeSignals = new Set<() => void>();
let globalInterval: number | null = null;

// Start global time updater
function startGlobalTimeUpdater(): void {
  if (globalInterval) return;

  globalInterval = window.setInterval(() => {
    timeSignals.forEach((update) => update());
  }, 60000); // Update every minute
}

// Stop global time updater
function stopGlobalTimeUpdater(): void {
  if (globalInterval) {
    window.clearInterval(globalInterval);
    globalInterval = null;
  }
}

// Create a relative time signal that updates automatically
export function createRelativeTimeSignal(timestamp: number) {
  const [signal, setSignal] = createSignal("");

  function update() {
    const now = Date.now();
    const diff = now - timestamp;
    let label;

    if (diff < 60000) {
      label = "just now";
    } else if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000);
      label = `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
    } else if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      label = `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
    } else if (diff < 604800000) {
      // 7 days
      const days = Math.floor(diff / 86400000);
      label = `${days} ${days === 1 ? "day" : "days"} ago`;
    } else if (diff < 2629746000) {
      // ~30.44 days (average month)
      const weeks = Math.floor(diff / 604800000);
      label = `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
    } else if (diff < 31556952000) {
      // ~365.25 days (average year)
      const months = Math.floor(diff / 2629746000);
      label = `${months} ${months === 1 ? "month" : "months"} ago`;
    } else {
      const years = Math.floor(diff / 31556952000);
      label = `${years} ${years === 1 ? "year" : "years"} ago`;
    }

    setSignal(label);
  }

  // Initial update
  update();

  // Register with global updater
  timeSignals.add(update);

  // Start global updater if not already started
  if (timeSignals.size === 1) {
    startGlobalTimeUpdater();
  }

  // Cleanup function
  const destroy = () => {
    timeSignals.delete(update);

    // Stop global updater if no more signals
    if (timeSignals.size === 0) {
      stopGlobalTimeUpdater();
    }
  };

  return {
    signal,
    destroy,
    update, // Allow manual updates
  };
}

// Format duration in seconds to human readable format
export function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "0:00";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  } else {
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  }
}

// Format total playlist duration
export function formatPlaylistDuration(totalSeconds: number): string {
  if (isNaN(totalSeconds) || totalSeconds < 0) return "0 minutes";

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) {
    const hourText = hours === 1 ? "hour" : "hours";
    if (minutes > 0) {
      const minuteText = minutes === 1 ? "minute" : "minutes";
      return `${hours} ${hourText}, ${minutes} ${minuteText}`;
    } else {
      return `${hours} ${hourText}`;
    }
  } else {
    const minuteText = minutes === 1 ? "minute" : "minutes";
    return `${minutes} ${minuteText}`;
  }
}

// Format absolute timestamp to readable date
export function formatAbsoluteDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - timestamp;

  // If today, show time only
  if (diff < 86400000 && date.getDate() === now.getDate()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // If this year, show month and day
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  // Otherwise show full date
  return date.toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Get time of day greeting
export function getTimeGreeting(): string {
  const hour = new Date().getHours();

  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

// Global cleanup function
export function cleanupTimeUtils(): void {
  timeSignals.clear();
  stopGlobalTimeUpdater();
}
