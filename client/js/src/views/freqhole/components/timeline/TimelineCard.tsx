import { JSX } from "solid-js";
import type { FeedItem } from "../../../../lib/analytics/analytics-api";

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
      default:
        return "interacted with";
    }
  };

  const getFrequencyText = (event: FeedItem): string => {
    // For non-play events, don't show frequency
    if (!event.item_type.includes("played")) return "";

    const playCount = event.play_count || 0;
    if (playCount === 1) return "";
    if (playCount < 5) return ` ${playCount} times`;
    if (playCount < 20) return ` ${playCount} times`;
    return ` ${playCount} times recently`;
  };

  return (
    <div class="timeline-card bg-black border-b border-white/10 p-4 hover:bg-white/5 transition-colors">
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
        <div class="collection-preview bg-white/5 rounded-none border border-white/10 p-3">
          <div class="collection-info">
            <h3 class="collection-title text-white font-medium text-base mb-1">
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

      {/* Social Context */}
      {props.event.metadata?.social_context && (
        <div class="social-context mt-2 text-xs text-white/40">
          {props.event.metadata.social_context.frequency > 10 && (
            <span class="heavy-listener">heavy listener • </span>
          )}
          {props.event.metadata.social_context.is_trending && (
            <span class="trending-item">trending item • </span>
          )}
          <span class="activity-type">
            {props.event.metadata.social_context.action_type} activity
          </span>
        </div>
      )}
    </div>
  );
}
