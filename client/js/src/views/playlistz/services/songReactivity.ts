import { createSignal } from "solid-js";

/**
 * Global Song Reactivity System
 *
 * This module provides a reactive signal system that notifies all interested
 * components when songs are updated in the database. This solves the issue
 * where SongRow components don't immediately reflect changes after editing.
 *
 * Usage:
 * - Import `songUpdateTrigger` in components that need to react to song changes
 * - Import `triggerSongUpdate` in services that modify songs
 * - Call `triggerSongUpdate()` after any song database operation
 */

// Global signal that increments whenever any song is updated
const [songUpdateTrigger, setSongUpdateTrigger] = createSignal(0);

// Map to track which songs have been updated (for debugging and optimization)
const updatedSongs = new Map<string, number>();

/**
 * Reactive signal that triggers whenever any song is updated.
 * Components can access this signal to know when to refetch song data.
 */
export { songUpdateTrigger };

/**
 * Trigger a global song update notification.
 * Call this after any song modification operation.
 *
 * @param songId - Optional song ID for tracking specific song updates
 */
export function triggerSongUpdate(songId?: string): void {
  setSongUpdateTrigger((prev) => prev + 1);

  if (songId) {
    updatedSongs.set(songId, Date.now());
  }
}

/**
 * Get the current update trigger value.
 * Useful for creating reactive dependencies.
 */
export function getSongUpdateTrigger(): number {
  return songUpdateTrigger();
}

/**
 * Check when a specific song was last updated.
 * Returns timestamp or undefined if song hasn't been tracked.
 */
export function getLastUpdateTime(songId: string): number | undefined {
  return updatedSongs.get(songId);
}

/**
 * Clear the update history (useful for cleanup or testing).
 */
export function clearUpdateHistory(): void {
  updatedSongs.clear();
}

/**
 * Get update statistics for debugging.
 */
export function getUpdateStats() {
  return {
    totalUpdates: songUpdateTrigger(),
    trackedSongs: updatedSongs.size,
    recentUpdates: Array.from(updatedSongs.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10), // Last 10 updates
  };
}

/**
 * Enhanced trigger function with metadata for complex scenarios.
 *
 * @param options - Update options
 */
export function triggerSongUpdateWithOptions(options: {
  songId?: string;
  type?: "edit" | "create" | "delete" | "reorder";
  metadata?: Record<string, any>;
}): void {
  const { songId } = options;

  triggerSongUpdate(songId);
}

// Development helpers
if (import.meta.env.DEV) {
  // Expose debugging functions to window in development
  (globalThis as any).__songReactivity = {
    getSongUpdateTrigger,
    getUpdateStats,
    clearUpdateHistory,
    triggerSongUpdate,
  };

  // Song reactivity debugging available at window.__songReactivity
}
