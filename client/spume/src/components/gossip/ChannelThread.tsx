import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
  untrack,
} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { createVirtualizer } from "@tanstack/solid-virtual";
import type { VirtualItem } from "@tanstack/virtual-core";
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
  onLoadMore?: () => void;
  lastReadTimestamp?: number;
  onDismissUnread?: () => void;
  resolveAvatar?: (name: string | null) => string | null;
  savedScrollTop?: number;
  onScrollChange?: (scrollTop: number) => void;
  onBack?: () => void;
}

const ESTIMATE_ROW_HEIGHT = 120;
const OVERSCAN = 5;

export function ChannelThread(props: ChannelThreadProps) {
  let scrollRef: HTMLDivElement | undefined;
  const t0 = performance.now();
  const ts = () => `+${(performance.now() - t0).toFixed(0)}ms`;

  // -- virtualizer --
  const count = createMemo(() => props.messages.length);

  const virtualizer = createVirtualizer({
    get count() {
      return count();
    },
    getScrollElement: () => scrollRef ?? null,
    estimateSize: () => ESTIMATE_ROW_HEIGHT,
    overscan: OVERSCAN,
    getItemKey: (index) => untrack(() => props.messages[index]?.message_id ?? index),
  });

  // patch measure() — the adapter calls it on every reactive change, which
  // wipes ALL cached sizes. we replace it with notify-only (preserves cache,
  // still triggers recomputation for new count). for channel switch we call
  // origMeasure directly to do a real cache clear.
  const origMeasure = (virtualizer as any).measure.bind(virtualizer);
  const origNotify = (virtualizer as any).notify.bind(virtualizer);
  (virtualizer as any).measure = function () {
    const sizeCache = (this as any).itemSizeCache;
    const cached = sizeCache instanceof Map ? sizeCache.size : "?";
    console.log(`[ct ${ts()}] measure() intercepted — notify only (cached=${cached})`);
    origNotify(false);
  };

  // trap resizeItem() to see when ResizeObserver fires real measurements
  const origResizeItem = (virtualizer as any).resizeItem;
  (virtualizer as any).resizeItem = function (index: number, size: number) {
    const sizeCache = (this as any).itemSizeCache;
    const oldSize =
      sizeCache instanceof Map ? sizeCache.get((this as any).measurementsCache?.[index]?.key) : "?";
    console.log(`[ct ${ts()}] resizeItem idx=${index} ${oldSize} -> ${size}`);
    return origResizeItem.call(this, index, size);
  };

  // reconcile virtual items into a store so <For> can diff by key
  // and reuse DOM nodes — prevents the measureElement cascade
  const [vItems, setVItems] = createStore<VirtualItem[]>([]);
  createEffect(() => {
    const items = virtualizer.getVirtualItems();
    const range = items.length > 0 ? `[${items[0].index}..${items[items.length - 1].index}]` : "[]";
    const sizeCache = (virtualizer as any).itemSizeCache;
    const cached = sizeCache instanceof Map ? sizeCache.size : "?";
    console.log(
      `[ct ${ts()}] reconcile: ${items.length} items ${range}, totalSize=${virtualizer.getTotalSize()}, cached=${cached}`
    );
    setVItems(reconcile(items, { key: "key", merge: false }));
  });

  // -- timestamps --
  const [tick, setTick] = createSignal(0);
  const tickInterval = setInterval(() => setTick((t) => t + 1), 30_000);
  onCleanup(() => clearInterval(tickInterval));

  // -- unread divider --
  const firstUnreadIndex = createMemo(() => {
    if (props.lastReadTimestamp == null) return -1;
    return props.messages.findIndex((m) => m.timestamp > props.lastReadTimestamp!);
  });

  let dismissTimer: ReturnType<typeof setTimeout> | null = null;
  onCleanup(() => {
    if (dismissTimer) clearTimeout(dismissTimer);
  });

  // -- scroll helpers --
  const isAtBottom = () => {
    if (!scrollRef) return false;
    return scrollRef.scrollHeight - scrollRef.scrollTop - scrollRef.clientHeight < 100;
  };

  // auto-scroll when new messages arrive
  // eslint-disable-next-line solid/reactivity -- initial snapshot, updated inside effect
  let prevCount = props.messages.length;
  createEffect(
    on(count, (len) => {
      const prev = prevCount;
      prevCount = len;
      const atBottom = isAtBottom();
      console.log(
        `[ct ${ts()}] count: ${prev} -> ${len}, atBottom=${atBottom}, totalSize=${virtualizer.getTotalSize()}`
      );
      if (len > prev && (atBottom || len - prev === 1)) {
        console.log(`[ct ${ts()}] auto-scroll to idx ${len - 1}`);
        requestAnimationFrame(() => {
          virtualizer.scrollToIndex(len - 1, { align: "end" });
        });
        props.onDismissUnread?.();
      }
    })
  );

  // scroll to unread or bottom on channel switch
  // use createMemo for topicId — has equality check, prevents spurious fires
  const topicId = createMemo(() => props.channel.topic_id);
  createEffect(
    on(topicId, (id) => {
      console.log(`[ct ${ts()}] channel switch: ${id}, msgs=${props.messages.length}`);
      prevCount = props.messages.length;
      // real cache clear — different channel = different content
      console.log(`[ct ${ts()}] origMeasure() — real cache clear for channel switch`);
      origMeasure();
      requestAnimationFrame(() => {
        const scroll = scrollRef
          ? `scrollH=${scrollRef.scrollHeight} scrollT=${scrollRef.scrollTop} clientH=${scrollRef.clientHeight}`
          : "no-ref";
        if (props.savedScrollTop !== undefined && scrollRef) {
          console.log(`[ct ${ts()}] restore scroll: ${props.savedScrollTop} (${scroll})`);
          scrollRef.scrollTo({ top: props.savedScrollTop });
        } else {
          const unreadIdx = firstUnreadIndex();
          if (unreadIdx > 0) {
            console.log(`[ct ${ts()}] scroll to unread idx ${unreadIdx} (${scroll})`);
            virtualizer.scrollToIndex(unreadIdx, { align: "start" });
            // second pass after measurements settle — estimated sizes shift positions
            requestAnimationFrame(() => {
              virtualizer.scrollToIndex(unreadIdx, { align: "start" });
            });
          } else if (props.messages.length > 0) {
            console.log(
              `[ct ${ts()}] scroll to bottom idx ${props.messages.length - 1} (${scroll})`
            );
            virtualizer.scrollToIndex(props.messages.length - 1, { align: "end" });
            // second pass after measurements settle
            requestAnimationFrame(() => {
              virtualizer.scrollToIndex(props.messages.length - 1, { align: "end" });
            });
          }
        }
      });
    })
  );

  const handleScroll = () => {
    if (!scrollRef) return;
    props.onScrollChange?.(scrollRef.scrollTop);

    // load more on scroll near top
    if (props.onLoadMore && scrollRef.scrollTop < 100) {
      const prevHeight = scrollRef.scrollHeight;
      props.onLoadMore();
      requestAnimationFrame(() => {
        if (scrollRef) {
          scrollRef.scrollTop += scrollRef.scrollHeight - prevHeight;
        }
      });
    }

    // auto-dismiss unread divider after 5s at bottom
    if (firstUnreadIndex() > 0 && props.onDismissUnread) {
      if (isAtBottom()) {
        if (!dismissTimer) {
          dismissTimer = setTimeout(() => {
            props.onDismissUnread?.();
            dismissTimer = null;
          }, 5000);
        }
      } else if (dismissTimer) {
        clearTimeout(dismissTimer);
        dismissTimer = null;
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
            <For each={vItems}>
              {(vRow) => {
                const msg = () => props.messages[vRow.index];
                return (
                  <div
                    ref={(el) => {
                      if (!el) return;
                      el.setAttribute("data-index", String(vRow.index));
                      requestAnimationFrame(() => {
                        if (!el.isConnected) return;
                        const h = el.getBoundingClientRect().height;
                        console.log(
                          `[ct ${ts()}] ref idx=${vRow.index} key=${vRow.key} h=${h.toFixed(0)}`
                        );
                        virtualizer.measureElement(el);
                      });
                    }}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${vRow.start}px)`,
                    }}
                  >
                    {/* always-present divider slot — collapses to 0 when not the unread row */}
                    <div
                      class="flex items-center gap-3 px-3 py-1 my-1 transition-opacity"
                      style={{
                        opacity:
                          firstUnreadIndex() > 0 && vRow.index === firstUnreadIndex() ? 1 : 0,
                        height:
                          firstUnreadIndex() > 0 && vRow.index === firstUnreadIndex()
                            ? undefined
                            : "0px",
                        overflow: "hidden",
                      }}
                    >
                      <div class="flex-1 h-px bg-[var(--color-accent-500)]/40" />
                      <span class="text-[10px] font-medium text-[var(--color-accent-500)] uppercase tracking-wider">
                        new
                      </span>
                      <div class="flex-1 h-px bg-[var(--color-accent-500)]/40" />
                    </div>
                    <Show when={msg()}>
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
