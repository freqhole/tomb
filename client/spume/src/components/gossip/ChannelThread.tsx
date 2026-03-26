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
  onLeaveChannel?: () => void;
  onDestroyChannel?: () => void;
  onAddMember?: () => void;
  /** set of friend node_ids for friend status checks */
  friendNodeIds?: Set<string>;
  /** set of pending friend request node_ids */
  pendingFriendNodeIds?: Set<string>;
  onAddFriend?: (nodeId: string) => void;
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
      setShowMembersFlyout(false);
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

    // show/hide "back to current" based on distance from bottom
    const distFromBottom = scrollRef.scrollHeight - scrollRef.scrollTop - scrollRef.clientHeight;
    setShowBackToCurrent(distFromBottom > scrollRef.clientHeight * 2);

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
  const [showMembersFlyout, setShowMembersFlyout] = createSignal(false);
  const isCreator = () => props.channel.creator_node_id === props.currentNodeId;

  // sorted members: creator first, then alphabetical
  const sortedMembers = () => {
    const m = props.members ?? [];
    return [...m].sort((a, b) => {
      if (a.role === "creator") return -1;
      if (b.role === "creator") return 1;
      return a.display_name.localeCompare(b.display_name);
    });
  };

  // short list: up to 3 recent members (for inline display where there's room)
  const shortMembers = () => sortedMembers().slice(0, 3);

  return (
    <div class="flex flex-col h-full bg-[var(--color-bg-primary)]">
      {/* channel header */}
      <div class="flex items-center gap-3 px-4 py-3 flex-shrink-0">
        <Show when={props.onBack}>
          <button
            class="wide:hidden flex-shrink-0 text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors -ml-1 mr--1 cursor-pointer"
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
        <div class="flex items-center gap-2 flex-shrink-0">
          {/* inline member avatars (wide only) */}
          <Show when={props.members && props.members.length > 0}>
            <div class="hidden wide:flex items-center -space-x-1.5">
              <For each={shortMembers()}>
                {(member) => (
                  <div
                    class="w-5 h-5 rounded-full overflow-hidden ring-2 ring-[var(--color-bg-primary)] bg-[var(--color-bg-tertiary)]"
                    title={member.display_name}
                  >
                    <Show
                      when={props.resolveAvatar?.(member.display_name)}
                      fallback={
                        <div class="w-full h-full flex items-center justify-center text-[8px] font-semibold text-[var(--color-text-tertiary)]">
                          {member.display_name[0].toUpperCase()}
                        </div>
                      }
                    >
                      <img
                        src={props.resolveAvatar!(member.display_name)!}
                        alt={member.display_name}
                        class="w-full h-full object-cover"
                      />
                    </Show>
                  </div>
                )}
              </For>
              <Show when={props.members!.length > 3}>
                <div class="w-5 h-5 rounded-full ring-2 ring-[var(--color-bg-primary)] bg-[var(--color-bg-tertiary)] flex items-center justify-center">
                  <span class="text-[8px] text-[var(--color-text-tertiary)]">
                    +{props.members!.length - 3}
                  </span>
                </div>
              </Show>
            </div>
          </Show>

          {/* members count button — opens flyout */}
          <div class="relative">
            <button
              class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors cursor-pointer"
              onClick={() => setShowMembersFlyout((v) => !v)}
              title="show members"
            >
              {props.members?.length ?? 0}{" "}
              {(props.members?.length ?? 0) === 1 ? "member" : "members"}
            </button>

            {/* members flyout */}
            <Show when={showMembersFlyout()}>
              <div class="absolute right-0 top-full mt-1 w-64 bg-[var(--color-bg-elevated)] rounded-lg shadow-xl border border-[var(--color-border-primary)]/20 z-50 overflow-hidden">
                {/* flyout header */}
                <div class="px-3 py-2 border-b border-[var(--color-border-primary)]/10">
                  <span class="text-xs font-medium text-[var(--color-text-secondary)]">
                    members ({props.members?.length ?? 0})
                  </span>
                </div>

                {/* member list */}
                <div class="max-h-72 overflow-y-auto py-1">
                  <For each={sortedMembers()}>
                    {(member) => (
                      <div class="flex items-center gap-2 px-3 py-1.5">
                        <div class="w-6 h-6 rounded-full overflow-hidden flex-shrink-0 bg-[var(--color-bg-tertiary)]">
                          <Show
                            when={props.resolveAvatar?.(member.display_name)}
                            fallback={
                              <div class="w-full h-full flex items-center justify-center text-[10px] font-semibold text-[var(--color-text-tertiary)]">
                                {member.display_name[0].toUpperCase()}
                              </div>
                            }
                          >
                            <img
                              src={props.resolveAvatar!(member.display_name)!}
                              alt={member.display_name}
                              class="w-full h-full object-cover"
                            />
                          </Show>
                        </div>
                        <span class="text-sm text-[var(--color-text-primary)] truncate flex-1">
                          {member.display_name}
                        </span>
                        <Show when={member.role === "creator"}>
                          <span class="text-[10px] text-[var(--color-accent-500)] flex-shrink-0">
                            creator
                          </span>
                        </Show>
                        <Show
                          when={member.node_id === props.currentNodeId && member.role !== "creator"}
                        >
                          <span class="text-[10px] text-[var(--color-text-tertiary)] flex-shrink-0">
                            you
                          </span>
                        </Show>
                        <Show when={member.node_id !== props.currentNodeId && props.friendNodeIds}>
                          <Show
                            when={props.friendNodeIds!.has(member.node_id)}
                            fallback={
                              <button
                                class="text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-accent-500)] transition-colors flex-shrink-0 cursor-pointer"
                                onClick={() => props.onAddFriend?.(member.node_id)}
                              >
                                + add
                              </button>
                            }
                          >
                            <span class="text-[10px] text-[var(--color-text-tertiary)]/60 flex-shrink-0">
                              friend
                            </span>
                          </Show>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>

                {/* flyout actions */}
                <div class="border-t border-[var(--color-border-primary)]/10 px-3 py-2 flex flex-col gap-1">
                  <Show when={props.onAddMember}>
                    <button
                      class="w-full text-left text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-accent-500)] transition-colors py-0.5 cursor-pointer"
                      onClick={() => {
                        setShowMembersFlyout(false);
                        props.onAddMember?.();
                      }}
                    >
                      + add member
                    </button>
                  </Show>
                  <Show when={isCreator() && props.onDestroyChannel}>
                    <button
                      class="w-full text-left text-xs text-red-400 hover:text-red-300 transition-colors py-0.5 cursor-pointer"
                      onClick={() => {
                        setShowMembersFlyout(false);
                        props.onDestroyChannel?.();
                      }}
                    >
                      destroy channel
                    </button>
                  </Show>
                  <Show when={!isCreator() && props.onLeaveChannel}>
                    <button
                      class="w-full text-left text-xs text-red-400 hover:text-red-300 transition-colors py-0.5 cursor-pointer"
                      onClick={() => {
                        setShowMembersFlyout(false);
                        props.onLeaveChannel?.();
                      }}
                    >
                      leave channel
                    </button>
                  </Show>
                </div>
              </div>

              {/* click-away backdrop */}
              <div class="fixed inset-0 z-40" onClick={() => setShowMembersFlyout(false)} />
            </Show>
          </div>

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
                        isCreator={msg()!.sender_node_id === props.channel.creator_node_id}
                        tick={tick()}
                        onReact={props.onReact}
                        onOpenReactionPicker={props.onOpenReactionPicker}
                        onDelete={props.onDelete}
                        onPlay={props.onPlay}
                        onFavorite={props.onFavorite}
                        onAddToQueue={props.onAddToQueue}
                        onAddToPlaylist={props.onAddToPlaylist}
                        checkFriendship={(nodeId) => {
                          if (nodeId === props.currentNodeId) return "self";
                          if (props.pendingFriendNodeIds?.has(nodeId)) return "pending";
                          if (props.friendNodeIds?.has(nodeId)) return "friend";
                          return "not-friend";
                        }}
                        onAddFriend={props.onAddFriend}
                      />
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </div>

      {/* back to current button — fades in when scrolled far from bottom */}
      <div
        class="flex justify-center transition-all duration-300 overflow-hidden"
        style={{
          "max-height": showBackToCurrent() ? "40px" : "0px",
          opacity: showBackToCurrent() ? 1 : 0,
        }}
      >
        <button
          class="flex items-center gap-1 px-3 py-1 mb-1 text-xs text-[var(--color-text-secondary)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-tertiary)] rounded-full shadow-md transition-colors cursor-pointer"
          onClick={() => {
            if (props.messages.length > 0) {
              virtualizer.scrollToIndex(props.messages.length - 1, { align: "end" });
            }
          }}
          title="back to current"
        >
          <span>back to current</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" class="opacity-70">
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
