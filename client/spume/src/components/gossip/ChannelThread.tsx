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
import type { GossipChannel, GossipMessage, MusicReference } from "../../gossip/gossipTypes";
import type { ReadReceiptMap } from "../../gossip/store/messages";
import { GossipMessageCard } from "./GossipMessageCard";
import { MemberAvatarStack } from "./MemberAvatarStack";
import { LoadingMoreIndicator } from "../feedback/LoadingMoreIndicator";
import { MessageReactionOverlay, createMessageReaction } from "./MessageReactionOverlay";

export interface ChannelThreadProps {
  channel: GossipChannel;
  messages: GossipMessage[];
  currentNodeId: string;
  onReact?: (messageId: string, emoji: string) => void;
  onOpenReactionPicker?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
  onPlay?: (item: MusicReference) => void;
  onKnock?: (item: MusicReference) => void;
  onFavorite?: (item: MusicReference) => void;
  onAddToQueue?: (item: MusicReference) => void;
  onAddToPlaylist?: (item: MusicReference) => void;
  /** check whether current user has access to a remote by node_id */
  checkAccess?: (sourceNodeId: string) => boolean;
  onLoadMore?: () => void;
  lastReadTimestamp?: number;
  onDismissUnread?: () => void;
  resolveAvatar?: (name: string | null) => string | null;
  savedScrollTop?: number;
  onScrollChange?: (scrollTop: number) => void;
  /** set of friend node_ids for friend status checks */
  friendNodeIds?: Set<string>;
  /** set of pending friend request node_ids */
  pendingFriendNodeIds?: Set<string>;
  onAddFriend?: (nodeId: string) => void;
  /** show loading skeleton while messages arrive */
  loading?: boolean;
  /** show "loading more" indicator at top while fetching older messages */
  loadingMore?: boolean;
  /** per-message read receipt positions (message_id → readers) */
  readReceipts?: ReadReceiptMap;
  /** number of other members (excluding self) — used for "everyone" tooltip */
  otherMemberCount?: number;
}

const ESTIMATE_ROW_HEIGHT = 120;
const OVERSCAN = 5;

export function ChannelThread(props: ChannelThreadProps) {
  let scrollRef: HTMLDivElement | undefined;

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
    origNotify(false);
  };

  // trap resizeItem() — re-scroll during settlement so positions converge
  const origResizeItem = (virtualizer as any).resizeItem;
  let measureCount = 0;
  let settling = false;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let loadMoreCooldown = false;
  (virtualizer as any).resizeItem = function (index: number, size: number) {
    measureCount++;
    // if (measureCount <= 20 || measureCount % 50 === 0) {
    //   console.log(
    //     `[virt] resizeItem #${measureCount} idx=${index} size=${size} total=${virtualizer.getTotalSize()}`
    //   );
    // }
    const result = origResizeItem.call(this, index, size);
    if (settling) {
      scrollToTarget();
      resetSettleTimer();
    }
    return result;
  };

  // reconcile virtual items into a store so <For> can diff by key
  // and reuse DOM nodes — prevents the measureElement cascade
  const [vItems, setVItems] = createStore<VirtualItem[]>([]);
  createEffect(() => {
    const items = virtualizer.getVirtualItems();
    if (items.length > 0 && settling) {
      const range = `[${items[0].index}..${items[items.length - 1].index}]`;
      console.log(`[virt] reconcile: ${items.length} items ${range}`);
    }
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
    if (settleTimer) clearTimeout(settleTimer);
  });

  // -- scroll helpers --
  const isAtBottom = () => {
    if (!scrollRef) return false;
    return scrollRef.scrollHeight - scrollRef.scrollTop - scrollRef.clientHeight < 100;
  };

  // "back to current" button — show when scrolled >2x viewport from bottom
  const [showBackToCurrent, setShowBackToCurrent] = createSignal(false);

  // auto-scroll when new messages arrive
  // eslint-disable-next-line solid/reactivity -- initial snapshot, updated inside effect
  let prevCount = props.messages.length;
  createEffect(
    on(count, (len) => {
      const prev = prevCount;
      prevCount = len;
      const atBottom = isAtBottom();
      if (len > prev && (atBottom || len - prev === 1)) {
        requestAnimationFrame(() => {
          if (!scrollRef) return;
          virtualizer.scrollToIndex(len - 1, { align: "end" });
        });
        props.onDismissUnread?.();
      }
    })
  );

  // scroll to unread or bottom on channel switch
  // use createMemo for topicId — has equality check, prevents spurious fires
  const topicId = createMemo(() => props.channel.topic_id);

  // scroll to unread divider, saved position, or bottom
  function scrollToTarget() {
    if (!scrollRef) return;
    if (props.savedScrollTop !== undefined) {
      scrollRef.scrollTo({ top: props.savedScrollTop });
    } else {
      const unreadIdx = firstUnreadIndex();
      if (unreadIdx > 0) {
        virtualizer.scrollToIndex(unreadIdx, { align: "start" });
      } else if (props.messages.length > 0) {
        virtualizer.scrollToIndex(props.messages.length - 1, { align: "end" });
      }
    }
  }

  // settle timer: 300ms without a measurement → scroll is stable
  function resetSettleTimer() {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settling = false;
      loadMoreCooldown = false;
      // console.log(`[scroll] settle complete`, {
      //   scrollTop: scrollRef?.scrollTop,
      //   scrollH: scrollRef?.scrollHeight,
      //   totalSize: virtualizer.getTotalSize(),
      // });
    }, 300);
  }

  // begin scroll settlement: one initial scroll, then resizeItem re-scrolls on each measurement
  function beginSettle() {
    settling = true;
    loadMoreCooldown = true;
    measureCount = 0;
    // console.log(`[scroll] beginSettle`, {
    //   msgs: props.messages.length,
    //   totalSize: virtualizer.getTotalSize(),
    // });
    requestAnimationFrame(() => {
      scrollToTarget();
      resetSettleTimer();
    });
  }

  createEffect(
    on(topicId, (id) => {
      console.log(`[channel] switch to ${id?.slice(0, 8)}, msgs=${props.messages.length}`);
      prevCount = props.messages.length;
      origMeasure();
      beginSettle();
    })
  );

  // load-more: debounce and defer to avoid blocking scroll momentum
  let loadMorePending = false;

  const handleScroll = () => {
    if (!scrollRef) return;
    // don't save scroll position during loading — skeleton gives scrollTop=0
    // which contaminates savedScrollTop and breaks scroll restoration
    if (!props.loading) {
      props.onScrollChange?.(scrollRef.scrollTop);
    }

    // show/hide "back to current" based on distance from bottom
    const distFromBottom = scrollRef.scrollHeight - scrollRef.scrollTop - scrollRef.clientHeight;
    setShowBackToCurrent(distFromBottom > scrollRef.clientHeight * 2);

    // load more on scroll near top — deferred to not block scroll momentum
    // loadMoreCooldown prevents false triggers right after initial scroll-to-bottom
    if (
      props.onLoadMore &&
      !props.loadingMore &&
      !loadMorePending &&
      !loadMoreCooldown &&
      scrollRef.scrollTop < 100
    ) {
      // console.log(`[scroll] loadMore triggered`, {
      //   scrollTop: scrollRef.scrollTop,
      //   scrollH: scrollRef.scrollHeight,
      //   clientH: scrollRef.clientHeight,
      //   totalSize: virtualizer.getTotalSize(),
      // });
      loadMorePending = true;
      // snapshot scroll position relative to content before load
      const prevScrollHeight = scrollRef.scrollHeight;
      const prevScrollTop = scrollRef.scrollTop;
      // defer the actual load so we don't trigger re-renders mid-scroll
      setTimeout(() => {
        props.onLoadMore?.();
        loadMorePending = false;
        // after messages prepend, restore scroll position so user doesn't lose their place
        const checkAndRestore = () => {
          if (!scrollRef) return;
          const delta = scrollRef.scrollHeight - prevScrollHeight;
          if (delta > 0) {
            scrollRef.scrollTop = prevScrollTop + delta;
          } else {
            // data hasn't arrived yet, retry
            requestAnimationFrame(checkAndRestore);
          }
        };
        requestAnimationFrame(checkAndRestore);
      }, 0);
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

  // reaction overlay — single instance shared across all messages
  const reactions = createMessageReaction();

  return (
    <div class="flex flex-col flex-1 min-h-0 bg-[var(--color-bg-primary)]">
      {/* virtualized message list — virtualizer always mounted, skeleton overlays on top */}
      <div class="flex-1 relative overflow-hidden">
        {/* loading skeleton overlay */}
        <Show when={props.loading}>
          <div class="absolute inset-0 z-10 bg-[var(--color-bg-primary)] overflow-hidden">
            <div class="flex flex-col gap-4 p-4 animate-pulse">
              <For each={[1, 2, 3, 4]}>
                {() => (
                  <div class="flex gap-2.5">
                    <div class="w-8 h-8 rounded-full bg-[var(--color-bg-tertiary)]" />
                    <div class="flex-1 space-y-2">
                      <div class="flex gap-2 items-center">
                        <div class="h-3 w-16 rounded bg-[var(--color-bg-tertiary)]" />
                        <div class="h-2 w-10 rounded bg-[var(--color-bg-tertiary)]" />
                      </div>
                      <div class="h-3 w-3/4 rounded bg-[var(--color-bg-tertiary)]" />
                      <div class="h-3 w-1/2 rounded bg-[var(--color-bg-tertiary)]" />
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
        {/* scrollable virtualizer — always mounted, never destroyed */}
        <div ref={scrollRef} class="h-full overflow-y-auto px-1 py-2" onScroll={handleScroll}>
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
            {/* loading-more indicator at top — debounced 1s to avoid flash */}
            <LoadingMoreIndicator
              isLoading={props.loadingMore ?? false}
              debounceMs={1000}
              text="loading older messages..."
              position="top"
            />
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
                        {(() => {
                          let rowEl!: HTMLDivElement;
                          const h = reactions.handlers(msg()!.message_id, rowEl);
                          return (
                            <div
                              ref={rowEl}
                              onTouchStart={h.onTouchStart}
                              onTouchMove={h.onTouchMove}
                              onTouchEnd={h.onTouchEnd}
                              onContextMenu={h.onContextMenu}
                            >
                              <GossipMessageCard
                                message={msg()!}
                                currentNodeId={props.currentNodeId}
                                avatarUrl={
                                  props.resolveAvatar?.(msg()!.sender_name) ??
                                  msg()!.sender_avatar_url
                                }
                                isCreator={msg()!.sender_node_id === props.channel.creator_node_id}
                                tick={tick()}
                                onReact={props.onReact}
                                onOpenReactionPicker={(msgId) => {
                                  reactions.open(msgId, rowEl);
                                }}
                                onDelete={props.onDelete}
                                onPlay={props.onPlay}
                                onKnock={props.onKnock}
                                onFavorite={props.onFavorite}
                                onAddToQueue={props.onAddToQueue}
                                onAddToPlaylist={props.onAddToPlaylist}
                                checkAccess={props.checkAccess}
                                checkFriendship={(nodeId) => {
                                  if (nodeId === props.currentNodeId) return "self";
                                  if (props.pendingFriendNodeIds?.has(nodeId)) return "pending";
                                  if (props.friendNodeIds?.has(nodeId)) return "friend";
                                  return "not-friend";
                                }}
                                onAddFriend={props.onAddFriend}
                              />
                              {/* read receipt avatars */}
                              <Show when={props.readReceipts?.[msg()!.message_id]?.length}>
                                {(() => {
                                  const readers = () => props.readReceipts![msg()!.message_id];
                                  const label = () => {
                                    const r = readers();
                                    if (!r?.length) return "";
                                    const otherCount = props.otherMemberCount ?? 0;
                                    if (otherCount > 0 && r.length >= otherCount)
                                      return "read by everyone";
                                    const names = r.map((m) => m.display_name ?? "someone");
                                    return `read by ${names.join(", ")}`;
                                  };
                                  return (
                                    <div
                                      class="flex items-center justify-end gap-1.5 px-3 -mt-0.5 mb-0.5"
                                      title={label()}
                                    >
                                      <span class="text-[10px] text-[var(--color-text-tertiary)]/60">
                                        {label()}
                                      </span>
                                      <MemberAvatarStack
                                        members={readers()}
                                        size="5"
                                        max={5}
                                        ring={false}
                                        resolveAvatar={props.resolveAvatar}
                                      />
                                    </div>
                                  );
                                })()}
                              </Show>
                            </div>
                          );
                        })()}
                      </Show>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
      </div>

      {/* back to current button — fades in when scrolled far from bottom */}
      <div
        class="flex justify-center transition-all duration-300 overflow-hidden pointer-events-none"
        style={{
          "max-height": showBackToCurrent() ? "52px" : "0px",
          opacity: showBackToCurrent() ? 1 : 0,
        }}
      >
        <button
          class="pointer-events-auto flex items-center gap-1.5 px-4 min-h-[44px] text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] rounded-full transition-colors cursor-pointer"
          onClick={() => {
            if (props.messages.length > 0) {
              virtualizer.scrollToIndex(props.messages.length - 1, { align: "end" });
            }
          }}
          title="back to current"
        >
          <span>back to current</span>
          <svg width="14" height="14" viewBox="0 0 12 12" fill="none" class="opacity-70">
            <path
              d="M6 3L6 9M6 9L3 6.5M6 9L9 6.5"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* reaction overlay — rendered outside virtualizer, fixed positioning */}
      <Show when={reactions.activeMessageId() && reactions.anchorEl()}>
        <MessageReactionOverlay
          messageId={reactions.activeMessageId()!}
          anchorRef={reactions.anchorEl()!}
          onReact={(msgId, emoji) => props.onReact?.(msgId, emoji)}
          onClose={reactions.close}
        />
      </Show>
    </div>
  );
}
