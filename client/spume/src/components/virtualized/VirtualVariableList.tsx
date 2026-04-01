// generic variable-height virtualized list
// direct copy of ChannelThread with gossip-specific rendering replaced by children prop.
// all virtualizer mechanics are identical — do not simplify or rearrange.

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
  untrack,
  type JSX,
} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { createVirtualizer } from "@tanstack/solid-virtual";
import type { VirtualItem } from "@tanstack/virtual-core";
import { LoadingMoreIndicator } from "../feedback/LoadingMoreIndicator";

export interface VirtualVariableListProps<T> {
  items: T[];
  getItemKey: (item: T, index: number) => string | number;
  children: (item: T, index: number) => JSX.Element;
  /** identity token — when this changes, virtualizer clears cache + re-settles
   *  (same role as ChannelThread's channel.topic_id) */
  listId: string;
  onLoadMore?: () => void;
  savedScrollTop?: number;
  onScrollChange?: (scrollTop: number) => void;
  /** show loading skeleton while data arrives */
  loading?: boolean;
  /** show "loading more" indicator at top while fetching older items */
  loadingMore?: boolean;
}

const ESTIMATE_ROW_HEIGHT = 120;
const OVERSCAN = 5;

export function VirtualVariableList<T>(props: VirtualVariableListProps<T>) {
  let scrollRef: HTMLDivElement | undefined;

  // -- virtualizer --
  const count = createMemo(() => props.items.length);

  const virtualizer = createVirtualizer({
    get count() {
      return count();
    },
    getScrollElement: () => scrollRef ?? null,
    estimateSize: () => ESTIMATE_ROW_HEIGHT,
    overscan: OVERSCAN,
    getItemKey: (index) => untrack(() => props.getItemKey(props.items[index], index)),
  });

  // patch measure() — the adapter calls it on every reactive change, which
  // wipes ALL cached sizes. we replace it with notify-only (preserves cache,
  // still triggers recomputation for new count). for list switch we call
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
    setVItems(reconcile(items, { key: "key", merge: false }));
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

  // auto-scroll when new items arrive
  // eslint-disable-next-line solid/reactivity -- initial snapshot, updated inside effect
  let prevCount = props.items.length;
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
      }
    })
  );

  // use createMemo for listId — has equality check, prevents spurious fires
  const listId = createMemo(() => props.listId);

  // scroll to saved position or bottom
  function scrollToTarget() {
    if (!scrollRef) return;
    if (props.savedScrollTop !== undefined) {
      scrollRef.scrollTo({ top: props.savedScrollTop });
    } else if (props.items.length > 0) {
      virtualizer.scrollToIndex(props.items.length - 1, { align: "end" });
    }
  }

  // settle timer: 300ms without a measurement → scroll is stable
  function resetSettleTimer() {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settling = false;
      loadMoreCooldown = false;
    }, 300);
  }

  // begin scroll settlement: one initial scroll, then resizeItem re-scrolls on each measurement
  function beginSettle() {
    settling = true;
    loadMoreCooldown = true;
    measureCount = 0;
    requestAnimationFrame(() => {
      scrollToTarget();
      resetSettleTimer();
    });
  }

  createEffect(
    on(listId, (id) => {
      console.log(`[vvl] switch to ${id?.slice(0, 8)}, items=${props.items.length}`);
      prevCount = props.items.length;
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
      loadMorePending = true;
      // snapshot scroll position relative to content before load
      const prevScrollHeight = scrollRef.scrollHeight;
      const prevScrollTop = scrollRef.scrollTop;
      // defer the actual load so we don't trigger re-renders mid-scroll
      setTimeout(() => {
        props.onLoadMore?.();
        loadMorePending = false;
        // after items prepend, restore scroll position so user doesn't lose their place
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
  };

  return (
    <div class="flex flex-col flex-1 min-h-0 bg-[var(--color-bg-primary)]">
      {/* virtualized list — virtualizer always mounted, skeleton overlays on top */}
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
            when={props.items.length > 0}
            fallback={
              <div class="flex items-center justify-center h-full">
                <p class="text-sm text-[var(--color-text-tertiary)]">nothing here yet</p>
              </div>
            }
          >
            {/* loading-more indicator at top — debounced 1s to avoid flash */}
            <LoadingMoreIndicator
              isLoading={props.loadingMore ?? false}
              debounceMs={1000}
              text="loading more..."
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
                  const item = () => props.items[vRow.index];
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
                      <Show when={item()}>{props.children(item(), vRow.index)}</Show>
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
            if (props.items.length > 0) {
              virtualizer.scrollToIndex(props.items.length - 1, { align: "end" });
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
    </div>
  );
}
