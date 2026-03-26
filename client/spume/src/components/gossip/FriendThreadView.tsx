import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import type {
  GossipChannel,
  GossipFriend,
  GossipMessage,
  MusicReference,
} from "../../../stories/gossip/mockGossipData";
import { GossipMessageCard } from "./GossipMessageCard";

export interface FriendThreadViewProps {
  friend: GossipFriend;
  /** all messages from this friend across every channel */
  messages: GossipMessage[];
  /** lookup channel by topic_id for labeling */
  channelsByTopic: Record<string, GossipChannel>;
  currentNodeId: string;
  onReact?: (messageId: string, emoji: string) => void;
  onOpenReactionPicker?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
  onPlay?: (item: MusicReference) => void;
  onFavorite?: (item: MusicReference) => void;
  onAddToQueue?: (item: MusicReference) => void;
  onAddToPlaylist?: (item: MusicReference) => void;
  onBack?: () => void;
  onUnfriend?: (nodeId: string) => void;
  resolveAvatar?: (name: string | null) => string | null;
  /** how many messages to show initially (load more on scroll up) */
  initialPageSize?: number;
}

export function FriendThreadView(props: FriendThreadViewProps) {
  let scrollRef: HTMLDivElement | undefined;
  const pageSize = () => props.initialPageSize ?? 20;

  // sort messages oldest-first (newest at bottom, like a chat), exclude system messages
  const sorted = createMemo(() =>
    [...props.messages]
      .filter((m) => m.msg_type !== "System")
      .sort((a, b) => a.timestamp - b.timestamp)
  );

  // pagination — show last N messages, load more on scroll up
  const [visibleCount, setVisibleCount] = createSignal(pageSize());
  const visibleMessages = createMemo(() => {
    const all = sorted();
    const start = Math.max(0, all.length - visibleCount());
    return all.slice(start);
  });
  const hasMore = () => visibleCount() < sorted().length;

  // scroll to bottom on initial load and friend switch
  const friendId = createMemo(() => props.friend.node_id);
  createEffect(
    on(friendId, () => {
      setVisibleCount(pageSize());
      requestAnimationFrame(() => {
        if (scrollRef) {
          scrollRef.scrollTop = scrollRef.scrollHeight;
        }
      });
    })
  );

  // load more on scroll near top
  const handleScroll = () => {
    if (!scrollRef) return;
    if (scrollRef.scrollTop < 80 && hasMore()) {
      const prevHeight = scrollRef.scrollHeight;
      setVisibleCount((v) => Math.min(v + pageSize(), sorted().length));
      requestAnimationFrame(() => {
        if (scrollRef) {
          scrollRef.scrollTop += scrollRef.scrollHeight - prevHeight;
        }
      });
    }
  };

  return (
    <div class="flex flex-col h-full bg-[var(--color-bg-primary)]">
      {/* header */}
      <div class="flex items-center gap-3 px-4 py-3 flex-shrink-0">
        <Show when={props.onBack}>
          <button
            class="flex-shrink-0 text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors -ml-1 min-w-[44px] min-h-[44px] flex items-center justify-center"
            onClick={() => props.onBack?.()}
            title="back"
          >
            &larr;
          </button>
        </Show>
        <div class="relative flex-shrink-0">
          <div class="w-7 h-7 rounded-full overflow-hidden bg-[var(--color-bg-tertiary)]">
            <Show
              when={props.friend.avatar_url}
              fallback={
                <div class="w-full h-full flex items-center justify-center text-xs font-semibold text-[var(--color-text-tertiary)]">
                  {props.friend.display_name[0].toUpperCase()}
                </div>
              }
            >
              <img
                src={props.friend.avatar_url!}
                alt={props.friend.display_name}
                class="w-full h-full object-cover"
                loading="lazy"
              />
            </Show>
          </div>
          <Show when={props.friend.online}>
            <div class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-[var(--color-bg-primary)]" />
          </Show>
        </div>
        <div class="flex-1 min-w-0">
          <h2 class="text-sm font-semibold text-[var(--color-text-primary)] truncate">
            {props.friend.display_name}
          </h2>
          <p class="text-xs text-[var(--color-text-tertiary)]">
            {sorted().length} {sorted().length === 1 ? "message" : "messages"} across channels
          </p>
        </div>
        <Show when={props.onUnfriend}>
          <button
            class="flex-shrink-0 text-[11px] text-[var(--color-text-tertiary)] hover:text-red-400 transition-colors min-h-[44px] flex items-center"
            onClick={() => props.onUnfriend?.(props.friend.node_id)}
            title={`unfriend ${props.friend.display_name}`}
          >
            unfriend
          </button>
        </Show>
      </div>

      {/* message list — newest at bottom */}
      <div ref={scrollRef} class="flex-1 overflow-y-auto px-1 py-2" onScroll={handleScroll}>
        <Show
          when={sorted().length > 0}
          fallback={
            <div class="flex items-center justify-center h-full">
              <p class="text-sm text-[var(--color-text-tertiary)]">
                no messages from {props.friend.display_name} yet
              </p>
            </div>
          }
        >
          <Show when={hasMore()}>
            <div class="flex justify-center py-2">
              <span class="text-[10px] text-[var(--color-text-tertiary)]">
                scroll up for older messages
              </span>
            </div>
          </Show>
          <For each={visibleMessages()}>
            {(msg) => {
              const channel = () => props.channelsByTopic[msg.topic_id];
              return (
                <div class="mb-1">
                  {/* channel label */}
                  <Show when={channel()}>
                    <div class="px-3 py-0.5">
                      <span class="text-[10px] text-[var(--color-accent-500)]/70">
                        #{channel()!.name}
                      </span>
                    </div>
                  </Show>
                  <GossipMessageCard
                    message={msg}
                    currentNodeId={props.currentNodeId}
                    avatarUrl={props.resolveAvatar?.(msg.sender_name) ?? msg.sender_avatar_url}
                    tick={0}
                    onReact={props.onReact}
                    onOpenReactionPicker={props.onOpenReactionPicker}
                    onDelete={props.onDelete}
                    onPlay={props.onPlay}
                    onFavorite={props.onFavorite}
                    onAddToQueue={props.onAddToQueue}
                    onAddToPlaylist={props.onAddToPlaylist}
                  />
                </div>
              );
            }}
          </For>
        </Show>
      </div>
    </div>
  );
}
