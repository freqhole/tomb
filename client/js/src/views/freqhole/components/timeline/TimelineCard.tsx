import { JSX, Show, For } from "solid-js";
import type { FeedItem } from "../../../../lib/analytics/analytics-api";
import {
  CollectionCard,
  type CollectionCardData,
} from "../shared/CollectionCard";

interface TimelineCardProps {
  event: FeedItem;
}

export function TimelineCard(props: TimelineCardProps): JSX.Element {
  const getActionText = (event: FeedItem): string => {
    switch (event.item_type) {
      case "user_played_album":
        return "played album";
      case "user_played_playlist":
        return "played playlist";
      case "user_played_artist":
        return "listened to";
      case "user_played_genre":
        return "explored";
      case "user_played_song":
        return "played";
      case "user_favorited_album":
        return "favorited album";
      case "user_favorited_playlist":
        return "favorited playlist";
      case "user_favorited_song":
        return "favorited";
      case "user_unfavorited_song":
        return "unfavorited";
      case "user_rated_song":
        return "rated";
      case "user_listening_session":
        return "had a listening session";
      case "user_daily_activity":
        return "daily music activity";
      case "user_weekly_activity":
        return "weekly music activity";
      case "user_monthly_activity":
        return "monthly music activity";
      case "user_music_archive":
        return "music archive";
      default:
        return "interacted with";
    }
  };

  const getFrequencyText = (event: FeedItem): string => {
    // For session and grouped events, don't show frequency (it's in subtitle)
    if (
      event.item_type.includes("session") ||
      event.item_type.includes("activity")
    )
      return "";

    // For non-play events, don't show frequency
    if (!event.item_type.includes("played")) return "";

    const playCount = event.play_count || 0;
    if (playCount === 1) return "";
    if (playCount < 5) return ` ${playCount} times`;
    if (playCount < 20) return ` ${playCount} times`;
    return ` ${playCount} times recently`;
  };

  const isGroupedItem = (event: FeedItem): boolean => {
    return (
      event.item_type.includes("session") ||
      event.item_type.includes("activity")
    );
  };

  const getCollectionGrid = (event: FeedItem) => {
    const grid = event.metadata?.collection_grid;
    if (!grid || !grid.collections) return null;

    const collections = grid.collections.split(", ");
    return {
      collections,
      totalCollections: grid.total_collections || collections.length,
      groupingLevel: grid.grouping_level || "unknown",
    };
  };

  const createCollectionCardData = (
    collectionName: string,
    index: number
  ): CollectionCardData => {
    return {
      id: `collection-${index}`,
      title: collectionName,
      domain_type: "song", // Most collections in sessions are songs
      // We don't have individual collection metadata in the grid
      // but CollectionCard will show a nice placeholder
    };
  };

  const getCardBorderColor = () => {
    if (isGroupedItem(props.event)) {
      switch (props.event.metadata?.social_context?.grouping_level) {
        case "session":
          return "border-l-magenta-500";
        case "daily":
          return "border-l-blue-500";
        case "weekly":
          return "border-l-green-500";
        case "monthly":
          return "border-l-yellow-500";
        default:
          return "border-l-purple-500";
      }
    }
    return "border-l-transparent";
  };

  return (
    <div
      class={`timeline-card bg-black border-b border-white/10 border-l-4 ${getCardBorderColor()} p-4 hover:bg-white/5 transition-colors`}
    >
      {/* User Action Header */}
      <div class="timeline-header mb-3">
        <div class="user-action text-sm text-white/70">
          <span class="username text-magenta font-medium">
            {props.event.username || "unknown user"}
          </span>
          <span class="action text-white/50 mx-2">
            {getActionText(props.event)}
          </span>
          <span class="frequency text-white/40">
            {getFrequencyText(props.event)}
          </span>
        </div>
        <div class="timestamp text-xs text-white/40 mt-1">
          {new Date(props.event.created_at).toLocaleDateString()} at{" "}
          {new Date(props.event.created_at).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>

      {/* Target Content */}
      <div class="timeline-content">
        <div
          class={`collection-preview ${isGroupedItem(props.event) ? "bg-white/10" : "bg-white/5"} rounded-none border border-white/10 p-3`}
        >
          <div class="collection-info">
            <h3
              class={`collection-title font-medium text-base mb-1 ${isGroupedItem(props.event) ? "text-magenta-200" : "text-white"}`}
            >
              {props.event.title}
            </h3>

            {props.event.subtitle && (
              <p class="collection-subtitle text-white/60 text-sm mb-2">
                {props.event.subtitle}
              </p>
            )}

            {/* Show rating for rating events */}
            {props.event.item_type === "user_rated_song" &&
              props.event.metadata?.social_context && (
                <div class="rating-display flex items-center gap-1 mb-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <span
                      class={
                        star <=
                        (props.event.metadata?.social_context?.rating || 0)
                          ? "text-magenta"
                          : "text-white/20"
                      }
                    >
                      ★
                    </span>
                  ))}
                </div>
              )}

            <div class="collection-meta flex items-center gap-4 text-xs text-white/50">
              <span class="domain-type">{props.event.domain_type}</span>

              {props.event.metadata?.user_activity?.total_play_count && (
                <span class="total-plays">
                  {props.event.metadata.user_activity.total_play_count} total
                  plays
                </span>
              )}

              {props.event.metadata?.social_context?.is_trending && (
                <span class="trending text-magenta">trending</span>
              )}

              {props.event.item_type.includes("favorited") && (
                <span class="favorited text-magenta">♥ favorited</span>
              )}
            </div>
          </div>

          {/* Collection Grid for Sessions */}
          <Show
            when={isGroupedItem(props.event) && getCollectionGrid(props.event)}
          >
            {(grid) => (
              <div class="collection-grid mt-3 pt-3 border-t border-magenta-500/30">
                <div class="grid-header mb-3 flex items-center justify-between">
                  <span class="text-xs text-magenta-300 font-medium">
                    {grid().totalCollections} collections •{" "}
                    {grid().groupingLevel}
                  </span>
                  <span class="text-xs text-white/40">
                    {props.event.metadata?.user_activity?.session_duration &&
                      `${Math.round(props.event.metadata.user_activity.session_duration / 60)}min`}
                  </span>
                </div>
                <div class="collections-grid grid grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
                  <For each={grid().collections.slice(0, 12)}>
                    {(collection, index) => (
                      <CollectionCard
                        collection={createCollectionCardData(
                          collection,
                          index()
                        )}
                        size="small"
                        enableNavigation={false}
                        enableContextMenu={false}
                        class="opacity-80 hover:opacity-100 transition-all duration-200 hover:scale-[1.01] text-xs"
                      />
                    )}
                  </For>
                </div>
                <Show when={grid().totalCollections > 12}>
                  <div class="more-collections text-xs text-white/50 mt-2 text-center">
                    +{grid().totalCollections - 12} more collections
                  </div>
                </Show>
              </div>
            )}
          </Show>

          {/* Action Buttons */}
          <div class="timeline-actions mt-3 flex gap-2">
            <button
              class="action-btn bg-magenta text-black px-3 py-1 text-xs hover:bg-magenta/80 transition-colors"
              onClick={() => {
                // TODO: implement play action
                console.log("play collection", props.event.domain_ids);
              }}
            >
              play
            </button>

            <button
              class="action-btn bg-white/10 text-white px-3 py-1 text-xs hover:bg-white/20 transition-colors"
              onClick={() => {
                // TODO: implement view collection action
                console.log("view collection", props.event.domain_ids);
              }}
            >
              view
            </button>
          </div>
        </div>
      </div>

      {/* Enhanced Social Context */}
      {props.event.metadata?.social_context && (
        <div class="social-context mt-2 text-xs text-white/40">
          {props.event.metadata.social_context.frequency > 10 && (
            <span class="heavy-listener">heavy listener • </span>
          )}
          {props.event.metadata.social_context.is_trending && (
            <span class="trending-item text-magenta font-medium">
              trending •{" "}
            </span>
          )}
          <span class="activity-type">
            {props.event.metadata.social_context.action_type} activity
          </span>
          {isGroupedItem(props.event) && (
            <span class="grouping-indicator text-magenta-400">
              {" "}
              • {props.event.metadata.social_context.grouping_level} grouping
            </span>
          )}
          {props.event.metadata.social_context.age_category && (
            <span class="age-category">
              {" "}
              • {props.event.metadata.social_context.age_category}
            </span>
          )}
          {isGroupedItem(props.event) &&
            props.event.metadata.user_activity?.session_duration && (
              <span class="session-duration">
                {" "}
                •{" "}
                {Math.round(
                  props.event.metadata.user_activity.session_duration / 60
                )}
                min session
              </span>
            )}
        </div>
      )}
    </div>
  );
}
