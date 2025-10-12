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
      default:
        return "interacted with";
    }
  };

  const getPlayFrequencyText = (playCount: number): string => {
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
          {props.event.play_count && props.event.play_count > 1 && (
            <span class="frequency text-white/40">
              {getPlayFrequencyText(props.event.play_count)}
            </span>
          )}
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
