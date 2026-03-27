import { For, Show } from "solid-js";
import type { GossipChannel } from "../../gossip/gossipTypes";

export interface ChannelSidebarProps {
  channels: GossipChannel[];
  activeTopicId?: string;
  unreadTopicIds?: Set<string>;
  onSelectChannel: (topicId: string) => void;
}

function relativeTime(ts: number | null): string {
  if (!ts) return "";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export function ChannelSidebar(props: ChannelSidebarProps) {
  const isActive = (topicId: string) => props.activeTopicId === topicId;
  const isUnread = (topicId: string) => props.unreadTopicIds?.has(topicId) ?? false;

  return (
    <div class="flex flex-col h-full bg-[var(--color-bg-primary)]">
      {/* header */}
      <div class="flex items-center justify-between px-3 py-3">
        <span class="text-sm font-semibold text-[var(--color-text-primary)]">
          channel<span class="text-[var(--color-accent-500)]">z</span>
        </span>
      </div>

      {/* channel list */}
      <div class="flex-1 overflow-y-auto py-1">
        <For each={props.channels}>
          {(channel) => (
            <button
              class="w-full flex items-center gap-2.5 px-3 py-2 min-h-[44px] text-left transition-colors"
              classList={{
                "bg-[var(--color-bg-secondary)]": isActive(channel.topic_id),
                "hover:bg-[var(--color-bg-secondary)]/50": !isActive(channel.topic_id),
              }}
              onClick={() => props.onSelectChannel(channel.topic_id)}
            >
              {/* unread dot */}
              <div class="w-2 flex-shrink-0">
                <Show when={isUnread(channel.topic_id)}>
                  <div class="w-2 h-2 rounded-full bg-[var(--color-accent-500)]" />
                </Show>
              </div>

              {/* channel info */}
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5">
                  <span
                    class="text-sm truncate"
                    classList={{
                      "text-[var(--color-text-primary)] font-medium":
                        isActive(channel.topic_id) || isUnread(channel.topic_id),
                      "text-[var(--color-text-secondary)]":
                        !isActive(channel.topic_id) && !isUnread(channel.topic_id),
                    }}
                  >
                    #{channel.name}
                  </span>
                </div>
                <Show when={channel.description}>
                  <p class="text-[11px] text-[var(--color-text-tertiary)] truncate mt-0.5">
                    {channel.description}
                  </p>
                </Show>
              </div>

              {/* last activity */}
              <Show when={channel.last_message_at}>
                <span class="text-[10px] text-[var(--color-text-tertiary)] flex-shrink-0">
                  {relativeTime(channel.last_message_at)}
                </span>
              </Show>
            </button>
          )}
        </For>
      </div>

      {/* empty state */}
      <Show when={props.channels.length === 0}>
        <div class="flex-1 flex items-center justify-center px-4">
          <p class="text-sm text-[var(--color-text-tertiary)] text-center">
            no channelz yet — create one or join via invite
          </p>
        </div>
      </Show>
    </div>
  );
}
