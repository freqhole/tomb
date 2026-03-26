import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { createVirtualizer } from "@tanstack/solid-virtual";
import type {
  GossipChannel,
  GossipChannelMember,
  GossipMessage,
  MusicReference,
} from "../../../stories/gossip/mockGossipData";
import { GossipMessageCard } from "./GossipMessageCard";
import { ComposeBar } from "./ComposeBar";
import { Badge } from "../badges/Badge";

export interface ChannelThreadProps {
  channel: GossipChannel;
  messages: GossipMessage[];
  members?: GossipChannelMember[];
  currentNodeId: string;
  /** stubbed music search results for compose bar */
  searchResults?: MusicReference[];
  onSend?: (text: string, attachments: MusicReference[]) => void;
  onReact?: (messageId: string, emoji: string) => void;
  onOpenReactionPicker?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
  onPlay?: (item: MusicReference) => void;
  onFavorite?: (item: MusicReference) => void;
  onAddToQueue?: (item: MusicReference) => void;
  onAddToPlaylist?: (item: MusicReference) => void;
  onSearchMusic?: (query: string) => void;
  /** callback to load older messages (infinite scroll) */
  onLoadMore?: () => void;
  /** unix seconds — messages after this timestamp are "unread" */
  lastReadTimestamp?: number;
  /** callback to dismiss the unread divider (mark as read) */
  onDismissUnread?: () => void;
  /** resolve avatar url for a sender name */
  resolveAvatar?: (name: string | null) => string | null;
  /** saved scroll position to restore */
  savedScrollTop?: number;
  /** fires when scroll position changes (for persistence) */
  onScrollChange?: (scrollTop: number) => void;
  /** callback to navigate back to sidebar (narrow layout) */
  onBack?: () => void;
}

const MSG_ESTIMATE_HEIGHT = 100;
const OVERSCAN = 5;

export function ChannelThread(props: ChannelThreadProps) {
  let scrollRef: HTMLDivElement | undefined;
  // eslint-disable-next-line solid/reactivity -- initial value, tracked via effect below
  const [prevMsgCount, setPrevMsgCount] = createSignal(props.messages.length);

  // track message count in a dedicated signal so the virtualizer's count getter
  // doesn't create a reactive dependency on props.messages (which would trigger
  // the solid-virtual adapter's createComputed → measure() → invalidate ALL
  // cached sizes every time any message content changes)
  // eslint-disable-next-line solid/reactivity -- initial value, tracked via effect below
  const [msgCount, setMsgCount] = createSignal(props.messages.length);
  createEffect(() => setMsgCount(props.messages.length));

  // single timer for all relative timestamps — ticks every 30s
  const [tick, setTick] = createSignal(0);
  const tickInterval = setInterval(() => setTick((t) => t + 1), 30_000);
  onCleanup(() => clearInterval(tickInterval));

  // auto-dismiss unread divider after 5s at bottom
  let dismissTimer: ReturnType<typeof setTimeout> | null = null;
  onCleanup(() => {
    if (dismissTimer) clearTimeout(dismissTimer);
  });

  // first unread message index (for divider)
  const firstUnreadIndex = () => {
    if (props.lastReadTimestamp == null) return -1;
    return props.messages.findIndex((m) => m.timestamp > props.lastReadTimestamp!);
  };

  const virtualizer = createVirtualizer({
    get count() {
      return msgCount();
    },
    getScrollElement: () => scrollRef ?? null,
    estimateSize: () => MSG_ESTIMATE_HEIGHT,
    overscan: OVERSCAN,
  });

  const isAtBottom = () => {
    if (!scrollRef) return false;
    return scrollRef.scrollHeight - scrollRef.scrollTop - scrollRef.clientHeight < 100;
  };

  // auto-scroll to bottom when new messages arrive (user sent or received)
  createEffect(
    on(
      () => props.messages.length,
      (len) => {
        const prev = prevMsgCount();
        setPrevMsgCount(len);
        // only auto-scroll if messages were appended (not prepended via load-more)
        if (len > prev) {
          if (isAtBottom() || len - prev === 1) {
            virtualizer.scrollToIndex(len - 1, { align: "end", behavior: "smooth" });
          }
        }
      }
    )
  );

  // scroll to bottom (or unread divider) when switching channels
  createEffect(
    on(
      () => props.channel.topic_id,
      () => {
        requestAnimationFrame(() => {
          if (props.savedScrollTop !== undefined && scrollRef) {
            scrollRef.scrollTo({ top: props.savedScrollTop });
          } else {
            const unreadIdx = firstUnreadIndex();
            if (unreadIdx > 0) {
              virtualizer.scrollToIndex(unreadIdx, { align: "start" });
            } else if (props.messages.length > 0) {
              virtualizer.scrollToIndex(props.messages.length - 1, { align: "end" });
            }
          }
        });
      }
    )
  );

  // re-measure row(s) when unread divider appears/moves/disappears
  createEffect(
    on(firstUnreadIndex, (idx, prevIdx) => {
      requestAnimationFrame(() => {
        if (!scrollRef) return;
        for (const i of [idx, prevIdx]) {
          if (i != null && i >= 0) {
            const el = scrollRef.querySelector(`[data-index="${i}"]`);
            if (el) {
              virtualizer.measureElement(el as HTMLElement);
            }
          }
        }
      });
    })
  );

  // infinite scroll: load more when scrolled near top
  const handleScroll = () => {
    if (!scrollRef) return;
    props.onScrollChange?.(scrollRef.scrollTop);

    // load more on scroll near top
    if (props.onLoadMore && scrollRef.scrollTop < 100) {
      const prevHeight = scrollRef.scrollHeight;
      props.onLoadMore();
      requestAnimationFrame(() => {
        if (scrollRef) {
          const newHeight = scrollRef.scrollHeight;
          scrollRef.scrollTop += newHeight - prevHeight;
        }
      });
    }

    // auto-dismiss unread divider after staying at bottom for 5s
    if (firstUnreadIndex() > 0 && props.onDismissUnread) {
      if (isAtBottom()) {
        if (!dismissTimer) {
          dismissTimer = setTimeout(() => {
            props.onDismissUnread?.();
            dismissTimer = null;
          }, 5000);
        }
      } else {
        if (dismissTimer) {
          clearTimeout(dismissTimer);
          dismissTimer = null;
        }
      }
    }
  };

  const allowText = () => props.channel.allow_text !== false;

  return (
    <div class="flex flex-col h-full bg-[var(--color-bg-primary)]">
      {/* channel header */}
      <div class="flex items-center gap-3 px-4 py-3 flex-shrink-0">
        <Show when={props.onBack}>
          <button
            class="wide:hidden flex-shrink-0 text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors -ml-1 mr--1"
            onClick={() => props.onBack?.()}
            title="back to channels"
          >
            &larr;
          </button>
        </Show>
        <div class="flex-1 min-w-0">
          <h2 class="text-sm font-semibold text-[var(--color-text-primary)] truncate">
            #{props.channel.name}
          </h2>
          <Show when={props.channel.description}>
            <p class="text-xs text-[var(--color-text-tertiary)] truncate">
              {props.channel.description}
            </p>
          </Show>
        </div>
        <div class="flex flex-col items-end gap-1 flex-shrink-0">
          <Show when={props.members}>
            <span class="text-xs text-[var(--color-text-tertiary)]">
              {props.members!.length} {props.members!.length === 1 ? "member" : "members"}
            </span>
          </Show>
          <Badge variant="default" size="sm">
            {allowText() ? "text" : "music only"}
          </Badge>
        </div>
      </div>

      {/* virtualized message list */}
      <div ref={scrollRef} class="flex-1 overflow-y-auto px-1 py-2" onScroll={handleScroll}>
        <Show
          when={props.messages.length > 0}
          fallback={
            <div class="flex items-center justify-center h-full">
              <p class="text-sm text-[var(--color-text-tertiary)]">
                no messages yet — be the first to share something
              </p>
            </div>
          }
        >
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            <For each={virtualizer.getVirtualItems()}>
              {(virtualItem) => {
                const msg = () => props.messages[virtualItem.index];
                return (
                  <div
                    data-index={virtualItem.index}
                    ref={(el) => {
                      requestAnimationFrame(() => {
                        if (el.isConnected) {
                          virtualizer.measureElement(el);
                        }
                      });
                    }}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualItem.start}px)`,
                      display: "flex",
                      "flex-direction": "column",
                    }}
                  >
                    <Show when={msg()}>
                      {/* unread divider */}
                      <Show
                        when={firstUnreadIndex() > 0 && virtualItem.index === firstUnreadIndex()}
                      >
                        <div class="flex items-center gap-3 px-3 py-1 my-1">
                          <div class="flex-1 h-px bg-[var(--color-accent-500)]/40" />
                          <span class="text-[10px] font-medium text-[var(--color-accent-500)] uppercase tracking-wider">
                            new
                          </span>
                          <div class="flex-1 h-px bg-[var(--color-accent-500)]/40" />
                        </div>
                      </Show>
                      <GossipMessageCard
                        message={msg()!}
                        currentNodeId={props.currentNodeId}
                        avatarUrl={
                          props.resolveAvatar?.(msg()!.sender_name) ?? msg()!.sender_avatar_url
                        }
                        tick={tick()}
                        onReact={props.onReact}
                        onOpenReactionPicker={props.onOpenReactionPicker}
                        onDelete={props.onDelete}
                        onPlay={props.onPlay}
                        onFavorite={props.onFavorite}
                        onAddToQueue={props.onAddToQueue}
                        onAddToPlaylist={props.onAddToPlaylist}
                      />
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </div>

      {/* compose bar */}
      <ComposeBar
        onSend={(text, attachments) => props.onSend?.(text, attachments)}
        onSearchMusic={props.onSearchMusic}
        searchResults={props.searchResults}
        placeholder={
          allowText()
            ? `share in ${props.channel.name}...`
            : `share music in ${props.channel.name}...`
        }
        allowText={allowText()}
      />
    </div>
  );
}
