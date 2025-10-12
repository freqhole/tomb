/**
 * Timeline grouping utilities
 *
 * Groups consecutive feed items from the same user to reduce visual clutter
 * and create a more natural social feed experience.
 */

import type { FeedItem } from "../../../../lib/analytics/analytics-api";

export interface GroupedFeedItem {
  user: {
    id: string;
    username: string;
  };
  timestamp: {
    earliest: string;
    latest: string;
    display: string;
  };
  items: FeedItem[];
  groupType: "single" | "consecutive";
}

/**
 * Groups consecutive feed items from the same user
 */
export function groupConsecutiveFeedItems(
  feedItems: FeedItem[],
  options: {
    maxGroupSize?: number;
    maxTimeGapMinutes?: number;
    groupOnlyIndividualItems?: boolean;
  } = {}
): GroupedFeedItem[] {
  const {
    maxGroupSize = 5,
    maxTimeGapMinutes = 30,
    groupOnlyIndividualItems = true,
  } = options;

  if (feedItems.length === 0) return [];

  const grouped: GroupedFeedItem[] = [];
  let currentGroup: FeedItem[] = [feedItems[0]];
  let currentUserId = feedItems[0].user_id;
  let currentUsername = feedItems[0].username;

  for (let i = 1; i < feedItems.length; i++) {
    const item = feedItems[i];
    const prevItem = feedItems[i - 1];

    const sameUser = item.user_id === currentUserId;
    const withinTimeGap = isWithinTimeGap(
      prevItem.created_at,
      item.created_at,
      maxTimeGapMinutes
    );
    const canGroup = groupOnlyIndividualItems
      ? !isGroupedItem(item) && !isGroupedItem(prevItem)
      : true;
    const underMaxSize = currentGroup.length < maxGroupSize;

    if (sameUser && withinTimeGap && canGroup && underMaxSize) {
      // Add to current group
      currentGroup.push(item);
    } else {
      // Finalize current group and start new one
      grouped.push(
        createGroupedFeedItem(currentGroup, currentUserId!, currentUsername!)
      );
      currentGroup = [item];
      currentUserId = item.user_id;
      currentUsername = item.username;
    }
  }

  // Add the last group
  if (currentGroup.length > 0) {
    grouped.push(
      createGroupedFeedItem(currentGroup, currentUserId!, currentUsername!)
    );
  }

  return grouped;
}

/**
 * Creates a grouped feed item from an array of individual items
 */
function createGroupedFeedItem(
  items: FeedItem[],
  userId: string,
  username: string
): GroupedFeedItem {
  const timestamps = items.map((item) => new Date(item.created_at).getTime());
  const earliest = Math.min(...timestamps);
  const latest = Math.max(...timestamps);

  return {
    user: {
      id: userId,
      username: username || "unknown user",
    },
    timestamp: {
      earliest: new Date(earliest).toISOString(),
      latest: new Date(latest).toISOString(),
      display: formatGroupTimeRange(earliest, latest),
    },
    items,
    groupType: items.length === 1 ? "single" : "consecutive",
  };
}

/**
 * Checks if two timestamps are within the specified time gap
 */
function isWithinTimeGap(
  earlier: string,
  later: string,
  maxGapMinutes: number
): boolean {
  const earlierTime = new Date(earlier).getTime();
  const laterTime = new Date(later).getTime();
  const gapMs = laterTime - earlierTime;
  const maxGapMs = maxGapMinutes * 60 * 1000;

  return gapMs <= maxGapMs;
}

/**
 * Checks if a feed item is already a grouped/session item
 */
function isGroupedItem(item: FeedItem): boolean {
  return (
    item.item_type.includes("session") ||
    item.item_type.includes("activity") ||
    item.item_type.includes("archive")
  );
}

/**
 * Formats a time range for display
 */
function formatGroupTimeRange(earliestMs: number, latestMs: number): string {
  const earliest = new Date(earliestMs);
  const latest = new Date(latestMs);

  const sameDay = earliest.toDateString() === latest.toDateString();
  const diffMinutes = Math.ceil((latestMs - earliestMs) / (1000 * 60));

  if (earliestMs === latestMs) {
    // Single timestamp
    return (
      latest.toLocaleDateString() +
      " at " +
      latest.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })
    );
  }

  if (sameDay && diffMinutes < 60) {
    // Same day, short time span - show just the time span
    return `${diffMinutes}min activity on ${latest.toLocaleDateString()}`;
  }

  if (sameDay) {
    // Same day - show date and time range
    return (
      latest.toLocaleDateString() +
      " from " +
      earliest.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      }) +
      " to " +
      latest.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })
    );
  } else {
    // Different days - show full date range
    return earliest.toLocaleDateString() + " to " + latest.toLocaleDateString();
  }
}

/**
 * Gets summary text for a group of items
 */
export function getGroupSummaryText(group: GroupedFeedItem): string {
  if (group.groupType === "single") {
    return getSingleItemActionText(group.items[0]);
  }

  const itemsByType = groupItemsByType(group.items);
  const summaryParts: string[] = [];

  // Prioritize more interesting actions
  const priorityOrder = ["played", "favorited", "rated", "unfavorited"];

  for (const action of priorityOrder) {
    const items = itemsByType[action];
    if (!items || items.length === 0) continue;

    const domainCounts = countByDomain(items);
    const parts: string[] = [];

    for (const [domain, count] of Object.entries(domainCounts)) {
      if (count === 1) {
        parts.push(`${count} ${domain}`);
      } else {
        parts.push(`${count} ${domain}s`);
      }
    }

    if (parts.length > 0) {
      summaryParts.push(`${action} ${parts.join(", ")}`);
    }
  }

  return summaryParts.join(", ") || "multiple interactions";
}

/**
 * Gets action text for a single item
 */
function getSingleItemActionText(item: FeedItem): string {
  switch (item.item_type) {
    case "user_played_song":
      return "played";
    case "user_played_album":
      return "played album";
    case "user_played_playlist":
      return "played playlist";
    case "user_played_artist":
      return "listened to";
    case "user_played_genre":
      return "explored";
    case "user_favorited_song":
      return "favorited";
    case "user_favorited_album":
      return "favorited album";
    case "user_favorited_playlist":
      return "favorited playlist";
    case "user_unfavorited_song":
      return "unfavorited";
    case "user_rated_song":
      return "rated";
    default:
      return "interacted with";
  }
}

/**
 * Groups items by action type
 */
function groupItemsByType(items: FeedItem[]): Record<string, FeedItem[]> {
  const grouped: Record<string, FeedItem[]> = {};

  for (const item of items) {
    const action = extractActionFromItemType(item.item_type);
    if (!grouped[action]) {
      grouped[action] = [];
    }
    grouped[action].push(item);
  }

  return grouped;
}

/**
 * Extracts action verb from item type
 */
function extractActionFromItemType(itemType: string): string {
  if (itemType.includes("played")) return "played";
  if (itemType.includes("favorited")) return "favorited";
  if (itemType.includes("unfavorited")) return "unfavorited";
  if (itemType.includes("rated")) return "rated";
  return "interacted";
}

/**
 * Counts items by domain type
 */
function countByDomain(items: FeedItem[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const item of items) {
    const domain = item.domain_type || "item";
    counts[domain] = (counts[domain] || 0) + 1;
  }

  return counts;
}
