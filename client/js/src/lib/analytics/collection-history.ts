/**
 * Collection history formatting utilities
 *
 * Provides formatting and display utilities for collection-level analytics
 * events (albums, playlists, artists, genres) in user history.
 */

import type { CollectionHistoryItemSchema } from "./analytics-api";
import { z } from "zod";

export type CollectionHistoryItem = z.infer<typeof CollectionHistoryItemSchema>;

/**
 * Format collection play event for display in history
 */
export function formatCollectionHistoryItem(item: CollectionHistoryItem): {
  displayText: string;
  subtitle: string;
  icon: string;
} {
  // Extract collection name from event_data if available
  const collectionName =
    item.event_data?.collection_name || item.collection_name || "unknown";
  const totalSongs = item.event_data?.total_songs || item.total_songs || 0;
  const shuffled =
    item.event_data?.shuffle_enabled || item.shuffle_enabled || false;

  let displayText: string;
  let subtitle: string;
  let icon: string;

  switch (item.domain_type) {
    case "album":
      displayText = `played album: ${collectionName}`;
      subtitle = `${totalSongs} song${totalSongs !== 1 ? "s" : ""}${shuffled ? ", shuffled" : ""}`;
      icon = "♪";
      break;

    case "artist":
      displayText = `played artist: ${collectionName}`;
      subtitle = `${totalSongs} song${totalSongs !== 1 ? "s" : ""}${shuffled ? ", shuffled" : ""}`;
      icon = "♫";
      break;

    case "genre":
      displayText = `${shuffled ? "shuffled" : "played"} genre: ${collectionName}`;
      subtitle = `${totalSongs} song${totalSongs !== 1 ? "s" : ""}`;
      icon = "♬";
      break;

    case "playlist":
      displayText = `played playlist: ${collectionName}`;
      subtitle = `${totalSongs} song${totalSongs !== 1 ? "s" : ""}${shuffled ? ", shuffled" : ""}`;
      icon = "♭";
      break;

    default:
      displayText = `played ${item.domain_type}: ${collectionName}`;
      subtitle = `${totalSongs} song${totalSongs !== 1 ? "s" : ""}`;
      icon = "♪";
  }

  return { displayText, subtitle, icon };
}

/**
 * Check if a history item is a collection play event
 */
export function isCollectionHistoryItem(
  item: any
): item is CollectionHistoryItem {
  return (
    item &&
    typeof item.domain_type === "string" &&
    ["album", "playlist", "artist", "genre"].includes(item.domain_type) &&
    item.event_type === "play"
  );
}

/**
 * Sort function for mixed song and collection history
 */
export function sortHistoryByDate(a: any, b: any): number {
  const dateA = new Date(a.created_at);
  const dateB = new Date(b.created_at);
  return dateB.getTime() - dateA.getTime(); // most recent first
}

/**
 * Deduplicate consecutive collection plays (same collection, same session)
 */
export function deduplicateCollectionHistory(
  history: CollectionHistoryItem[]
): CollectionHistoryItem[] {
  const deduplicated = [];
  let lastItem: CollectionHistoryItem | null = null;

  for (const item of history) {
    const isDuplicate =
      lastItem &&
      lastItem.domain_type === item.domain_type &&
      lastItem.domain_id === item.domain_id &&
      lastItem.session_id === item.session_id &&
      // within 30 seconds of each other
      Math.abs(
        new Date(item.created_at).getTime() -
          new Date(lastItem.created_at).getTime()
      ) < 30000;

    if (!isDuplicate) {
      deduplicated.push(item);
      lastItem = item;
    }
  }

  return deduplicated;
}

/**
 * Get collection icon for display (text-based for dark theme compatibility)
 */
export function getCollectionIcon(domainType: string): string {
  switch (domainType) {
    case "album":
      return "♪";
    case "artist":
      return "♫";
    case "genre":
      return "♬";
    case "playlist":
      return "♭";
    default:
      return "♪";
  }
}

/**
 * Get CSS classes for collection history item styling
 */
export function getCollectionHistoryClasses(): {
  containerClass: string;
  iconClass: string;
  textClass: string;
} {
  const baseContainer =
    "flex items-center py-2 px-3 bg-black hover:bg-magenta-600/20 transition-colors";
  const baseIcon =
    "w-10 h-10 flex-shrink-0 mr-3 flex items-center justify-center text-gray-400";
  const baseText = "flex-1 min-w-0";

  return {
    containerClass: baseContainer,
    iconClass: baseIcon,
    textClass: baseText,
  };
}

/**
 * Format collection event data for analytics display
 */
export function formatCollectionEventData(eventData: any): {
  totalSongs: number;
  shuffleEnabled: boolean;
  playSource: string;
  firstSongId?: string;
} {
  return {
    totalSongs: eventData?.total_songs || 0,
    shuffleEnabled: eventData?.shuffle_enabled || false,
    playSource: eventData?.play_source || "play_all",
    firstSongId: eventData?.first_song_id,
  };
}
