// virtualized feed list — infinite scrolling list of feed events
// uses the same virtualizer patterns as ChannelThread (measure patch,
// resizeItem trap, reconciled store, settlement)

import { createVirtualizer } from "@tanstack/solid-virtual";
import type { VirtualItem } from "@tanstack/virtual-core";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { entityColors } from "../../design-system/colors";
import { getCurrentUser } from "../../music/data";
import type { FeedItem, FeedItemType } from "../../music/data/types";
import type { FavoriteTarget } from "../../music/queries/favorites";
import { FavoriteToggle } from "../../utils/FavoriteToggle";
import { formatLongDuration } from "../../utils/formatDuration";
import { isTouchDevice } from "../../utils/isMobile";
import { Icon, type IconName } from "../icons/registry";
import { EntityLinks } from "../media/EntityLinks";
import { ImageCollageGrid } from "../media/ImageCollageGrid";
import { MediaThumbnail } from "../media/MediaThumbnail";
import { ContextMenu, type MenuAction } from "../overlays/ContextMenu";
import { MarqueeText } from "../text/MarqueeText";
import { RelativeTime } from "../text/RelativeTime";

const ESTIMATE_ROW_HEIGHT = 120;
const IMAGE_SIZE = 88;
const OVERSCAN = 8;

// scroll position cache
const scrollCache = new Map<string, number>();

// feed type display info
function feedTypeInfo(type: FeedItemType): { color: string; icon: IconName } {
  switch (type) {
    case "recent_listen":
      return { color: entityColors.song, icon: "play" };
    case "recent_favorite":
      return { color: entityColors.favorite, icon: "favorite" };
    case "recent_album":
      return { color: entityColors.album, icon: "album" };
    case "recent_rating":
      return { color: entityColors.rating, icon: "star" };
    case "recent_playlist":
      return { color: entityColors.playlist, icon: "playlist" };
    case "listen_session":
      return { color: entityColors.session, icon: "headphones" };
    case "new_image":
      return { color: entityColors.image, icon: "image" };
    default:
      return { color: "var(--color-text-muted)", icon: "music" };
  }
}

// entity type label for action text
function entityLabel(item: FeedItem): string {
  if (item.playlist_id) return "a playlist";
  if (item.album_id && !item.song_id) return "an album";
  if (item.artist_id && !item.song_id && !item.album_id) return "an artist";
  if (item.song_id) return "a song";
  if (item.target_type === "artist") return "an artist";
  if (item.target_type === "album") return "an album";
  if (item.target_type === "song") return "a song";
  return "";
}

export interface VirtualFeedListProps {
  items: FeedItem[];
  height: number;
  scrollPaddingTop?: number;
  onItemClick?: (item: FeedItem) => void;
  onImageClick?: (item: FeedItem) => void;
  onAddToQueue?: (item: FeedItem) => void;
  getContextMenuActions?: (item: FeedItem) => MenuAction[];
  onNearEnd?: () => void;
  onGenreClick?: (genreId: string) => void;
  scrollKey?: string;
  onScroll?: (scrollTop: number) => void;
}

export function VirtualFeedList(props: VirtualFeedListProps) {
  let scrollRef: HTMLDivElement | undefined;

  const count = createMemo(() => props.items.length);

  const virtualizer = createVirtualizer({
    get count() {
      return count();
    },
    getScrollElement: () => scrollRef ?? null,
    estimateSize: () => ESTIMATE_ROW_HEIGHT,
    overscan: OVERSCAN,
    getItemKey: (index) => untrack(() => props.items[index]?.id ?? index),
  });

  // patch measure() — the solid adapter calls it on every reactive change,
  // wiping ALL cached sizes. replace with notify-only to preserve cache.
  const origNotify = (virtualizer as any).notify.bind(virtualizer);
  (virtualizer as any).measure = function () {
    origNotify(false);
  };

  // trap resizeItem() — during settlement, re-scroll so positions converge
  const origResizeItem = (virtualizer as any).resizeItem;
  let settling = false;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  (virtualizer as any).resizeItem = function (index: number, size: number) {
    const result = origResizeItem.call(this, index, size);
    if (settling) {
      scrollToSaved();
      resetSettleTimer();
    }
    return result;
  };

  // reconcile virtual items into a store so <For> can diff by key
  // and reuse DOM nodes — prevents the measureElement cascade.
  const [vItems, setVItems] = createStore<VirtualItem[]>([]);
  createEffect(() => {
    void count();
    const items = virtualizer.getVirtualItems();
    // the solid adapter updates its internal store via reconcile (which reads
    // under untrack), so this effect has no reactive dependency on individual
    // item properties by default. without these explicit reads, the effect
    // never re-runs when the adapter shifts the visible window on scroll —
    // it only re-runs on count changes. touching the first and last item's
    // index forces SolidJS to track those store paths, making the effect
    // re-fire whenever the visible range shifts.
    if (items.length > 0) {
      void (items[0] as any)?.index;
      void (items[items.length - 1] as any)?.index;
    }
    setVItems(reconcile(items, { key: "key", merge: false }));
  });

  onCleanup(() => {
    if (settleTimer) clearTimeout(settleTimer);
    // save scroll position
    if (props.scrollKey && scrollRef) {
      scrollCache.set(props.scrollKey, scrollRef.scrollTop);
    }
  });

  // settle timer: 300ms without a measurement → scroll is stable
  function resetSettleTimer() {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settling = false;
    }, 300);
  }

  function scrollToSaved() {
    if (!scrollRef) return;
    if (props.scrollKey) {
      const saved = scrollCache.get(props.scrollKey);
      if (saved !== undefined && saved > 0) {
        scrollRef.scrollTo({ top: saved });
        return;
      }
    }
    // default: stay at top
  }

  // begin settlement: one initial scroll, then resizeItem re-scrolls on each measurement
  function beginSettle() {
    settling = true;
    requestAnimationFrame(() => {
      scrollToSaved();
      resetSettleTimer();
    });
  }

  // restore scroll position on mount
  onMount(() => {
    beginSettle();
  });

  // when item count changes, force virtualizer to recalculate visible window.
  // the measure() patch (origNotify) doesn't do a full recalc, so new items
  // appended beyond the current window won't appear without this.
  let prevCount = props.items.length;
  createEffect(
    on(count, (len) => {
      const prev = prevCount;
      prevCount = len;
      if (len !== prev) {
        // force recalc by scrolling to current position
        requestAnimationFrame(() => {
          if (!scrollRef) return;
          virtualizer.scrollToOffset(scrollRef.scrollTop, { align: "start" });
        });
      }
    })
  );

  // near-end detection for infinite scroll
  let loadMorePending = false;
  const checkNearEnd = () => {
    if (!props.onNearEnd || loadMorePending) return;
    const items = virtualizer.getVirtualItems();
    if (items.length === 0) return;
    const lastItem = items[items.length - 1];
    if (lastItem && lastItem.index >= count() - 20) {
      loadMorePending = true;
      setTimeout(() => {
        props.onNearEnd?.();
        loadMorePending = false;
      }, 0);
    }
  };

  // only apply scroll padding on wide viewports (narrow has its own fixed nav)
  const scrollPad = () =>
    props.scrollPaddingTop && window.matchMedia("(min-width: 768px)").matches
      ? props.scrollPaddingTop
      : 0;

  const handleScroll = () => {
    if (!scrollRef) return;
    checkNearEnd();
    props.onScroll?.(scrollRef.scrollTop);
  };

  return (
    <div
      ref={scrollRef}
      class="overflow-auto"
      style={{
        height: `${props.height}px`,
        "padding-top": scrollPad() ? `${scrollPad()}px` : undefined,
      }}
      onScroll={handleScroll}
    >
      {/* centered gutter container — constrain width on desktop */}
      <div class="mx-auto max-w-3xl">
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
              const actions = () => props.getContextMenuActions?.(item()) ?? [];

              const rowContent = () => (
                <Show when={item()}>
                  <FeedRow
                    item={item()!}
                    onClick={() => props.onItemClick?.(item()!)}
                    onImageClick={() => props.onImageClick?.(item()!)}
                    onAddToQueue={
                      props.onAddToQueue ? () => props.onAddToQueue!(item()!) : undefined
                    }
                    onGenreClick={props.onGenreClick}
                  />
                </Show>
              );

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
                  <Show when={actions().length > 0} fallback={rowContent()}>
                    <ContextMenu actions={actions()}>{rowContent()}</ContextMenu>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
}

// individual feed row
function FeedRow(props: {
  item: FeedItem;
  onClick: () => void;
  onImageClick: () => void;
  onAddToQueue?: () => void;
  onGenreClick?: (genreId: string) => void;
}) {
  const [isRowHovered, setIsRowHovered] = createSignal(false);
  const [isThumbHovered, setIsThumbHovered] = createSignal(false);

  const typeInfo = () => feedTypeInfo(props.item.feed_type);
  const images = () => props.item.images;
  const collageImages = () => props.item.collage_images;

  // prefer entity image for playlist/artist/album sessions, fallback to collage for genre/shuffle
  const shouldShowCollage = createMemo(() => {
    const collage = collageImages();
    if (!collage || collage.length < 2) return false;
    // don't use collage if session has a specific entity type that should show its own image
    if (props.item.feed_type === "listen_session") {
      const sessionType = props.item.session_type;
      // genre and shuffle can use collage, others should use entity image when available
      if (sessionType === "playlist" || sessionType === "artist" || sessionType === "album") {
        // use entity image if available
        return !(images() && images()!.length > 0);
      }
    }
    return true;
  });
  const hasImages = () => shouldShowCollage() || !!(images() && images()!.length > 0);
  const createdAt = () =>
    typeof props.item.created_at === "number"
      ? props.item.created_at * 1000
      : props.item.created_at;

  const isSession = () => props.item.feed_type === "listen_session";
  const hasProgress = () => isSession() && (props.item.progress_percent ?? 0) > 0;
  const progressPercent = () => Math.min(100, props.item.progress_percent ?? 0);
  const isResumable = () => {
    if (!isSession()) return false;
    const item = props.item;
    const isComplete = item.session_status === "completed" || (item.progress_percent ?? 0) >= 100;
    if (isComplete) return false;
    const isOwn = item.user_id && item.user_id === getCurrentUser()?.userId;
    return isOwn && hasProgress();
  };

  // build natural language action line
  const actionText = createMemo(() => {
    const item = props.item;
    const user = item.username ?? null;
    const entity = entityLabel(item);

    switch (item.feed_type) {
      case "recent_favorite":
        return { user, verb: "\u2665", entity: entity || "a song" };
      case "recent_listen":
        return { user, verb: "played", entity: entity || "a song" };
      case "recent_album": {
        // is_initial_add: true means first add to this album, false means subsequent adds
        if (item.is_initial_add) {
          return { user, verb: "added", entity: "a new album" };
        } else {
          // show how many songs were added
          const count = item.songs_added ?? 1;
          const songWord = count === 1 ? "song" : "songs";
          return { user, verb: "added", entity: `${count} ${songWord} to an album` };
        }
      }
      case "recent_rating":
        return { user, verb: "rated", entity: entity || "a song" };
      case "recent_playlist": {
        // playlists use is_initial_add: true = created, false = updated
        return {
          user,
          verb: item.is_initial_add ? "created" : "updated",
          entity: entity || "a playlist",
        };
      }
      case "listen_session":
        // "is having" for active sessions, "had" for completed/paused/abandoned
        return {
          user,
          verb: item.session_status === "active" ? "is having" : "had",
          entity: "a listening session",
        };
      case "new_image": {
        const count = item.image_count ?? 1;
        const imageWord = count === 1 ? "image" : "images";
        const entityType = item.target_type ?? "";
        const imageEntity = `${count} new ${entityType} ${imageWord}`.replace(/\s+/g, " ").trim();
        return { user, verb: "added", entity: imageEntity };
      }
      default:
        return { user, verb: "", entity: item.feed_type };
    }
  });

  // build "artist · album" line — avoid duplicating title
  const artistAlbumLine = createMemo(() => {
    const item = props.item;
    const parts: string[] = [];
    if (item.artist_name && item.artist_name !== item.title) parts.push(item.artist_name);
    if (
      item.album_title &&
      item.feed_type !== "recent_album" &&
      item.album_title !== item.title &&
      item.album_title !== item.artist_name
    )
      parts.push(item.album_title);
    return parts.join(" \u00b7 ");
  });

  // build metadata line — year, tracks, duration (genre is rendered separately as a badge)
  const metaParts = createMemo(() => {
    const parts: string[] = [];
    const item = props.item;
    if (item.year) parts.push(String(item.year));
    if (item.song_count != null && item.song_count > 0) {
      parts.push(`${item.song_count} ${item.song_count === 1 ? "track" : "tracks"}`);
    }
    if (item.total_duration_ms != null && item.total_duration_ms > 0) {
      parts.push(formatLongDuration(item.total_duration_ms / 1000));
    }
    return parts;
  });

  // handle image click — stop propagation so row click doesn't fire
  const handleImageClick = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    props.onImageClick();
  };

  // determine favorite target from feed item (priority: song > album > playlist > artist)
  const favoriteTarget = createMemo((): { type: FavoriteTarget; id: string } | null => {
    const item = props.item;
    if (item.song_id) return { type: "song", id: item.song_id };
    if (item.album_id) return { type: "album", id: item.album_id };
    if (item.playlist_id) return { type: "playlist", id: item.playlist_id };
    if (item.artist_id) return { type: "artist", id: item.artist_id };
    return null;
  });

  // handle queue button click
  const handleQueueClick = (e: MouseEvent) => {
    e.stopPropagation();
    props.onAddToQueue?.();
  };

  return (
    <div
      class="w-full flex items-stretch gap-2 wide:gap-3 px-2 wide:px-4 py-1.5 text-left transition-colors hover:bg-[var(--color-accent-500)]/5 cursor-pointer"
      onClick={() => props.onClick()}
      onMouseEnter={() => setIsRowHovered(true)}
      onMouseLeave={() => setIsRowHovered(false)}
    >
      {/* thumbnail — square, matches row height */}
      <div
        class="flex-shrink-0 rounded overflow-hidden bg-[var(--color-accent-500)]/10 relative cursor-pointer my-1.5"
        style={{ width: `${IMAGE_SIZE}px`, height: `${IMAGE_SIZE}px` }}
        onClick={handleImageClick}
        onMouseEnter={() => setIsThumbHovered(true)}
        onMouseLeave={() => setIsThumbHovered(false)}
      >
        <Show
          when={hasImages()}
          fallback={
            <div
              class="w-full h-full flex items-center justify-center transition-opacity"
              style={{
                opacity: (isResumable() ? isRowHovered() : isThumbHovered() && isRowHovered())
                  ? "0"
                  : "1",
              }}
            >
              <Icon name={typeInfo().icon} size={48} color={typeInfo().color} />
            </div>
          }
        >
          <Show
            when={shouldShowCollage()}
            fallback={
              <MediaThumbnail
                images={images() ?? undefined}
                size={IMAGE_SIZE}
                hideIndex
                showPlayIcon={false}
              />
            }
          >
            <ImageCollageGrid images={collageImages()!} size={IMAGE_SIZE} thumbnailSize={50} />
          </Show>

          {/* feed type icon overlay — visible by default, hidden when ROW is hovered
              on touch devices: hide overlay entirely (no hover state available) */}
          <Show when={!isTouchDevice()}>
            <div
              class="absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity"
              style={{ opacity: isRowHovered() ? "0" : "1" }}
            >
              <Icon name={typeInfo().icon} size={32} color={typeInfo().color} />
            </div>
          </Show>
        </Show>

        {/* hover icon — carousel for new_image (opens gallery), play for everything else */}
        <div
          class="absolute inset-0 flex flex-col items-center justify-center bg-black/30 rounded transition-opacity"
          style={{
            opacity: (isResumable() ? isRowHovered() : isThumbHovered() && isRowHovered())
              ? "1"
              : "0",
          }}
        >
          <Icon
            name={props.item.feed_type === "new_image" ? "carousel" : "play"}
            size={isResumable() ? 28 : 36}
            color={typeInfo().color}
            className="bg-black/75 rounded-full"
            title={props.item.feed_type === "new_image" ? "view images" : "play"}
          />
          <Show when={isResumable()}>
            <span
              class="text-xs font-medium mt-0.5 p-1 bg-black/75 rounded"
              style={{ color: typeInfo().color }}
            >
              resume
            </span>
          </Show>
        </div>
      </div>

      {/* content area */}
      <div class="flex-1 min-w-0 py-3 flex flex-col justify-center gap-0.5">
        {/* line 1: action text — "edward ♥ a song" or "new album" */}
        <div class="text-xs wide:text-sm leading-snug" style={{ color: typeInfo().color }}>
          <Show when={actionText().user}>
            <span class="font-bold">{actionText().user} </span>
          </Show>
          <Show when={actionText().verb}>
            <Show
              when={actionText().verb === "\u2665"}
              fallback={<span>{actionText().verb} </span>}
            >
              <Icon
                name="favorite"
                size={14}
                color={entityColors.favorite}
                className="inline align-text-bottom"
              />{" "}
            </Show>
          </Show>
          <span>{actionText().entity}</span>
          <Show when={props.item.rating != null}>
            <span class="ml-1 inline-flex items-center gap-0.5 align-text-bottom">
              <Icon name="star" size={11} color={entityColors.rating} />
              {props.item.rating}/5
            </span>
          </Show>
        </div>

        {/* line 2: title */}
        <Show when={props.item.title}>
          <MarqueeText
            text={props.item.title}
            class="text-sm wide:text-base font-medium text-[var(--color-text-primary)] leading-tight"
            isHovering={isRowHovered}
          />
        </Show>

        {/* line 3: artist · album (for sessions, merge metadata onto this line) */}
        <Show when={artistAlbumLine() || (isSession() && metaParts().length > 0)}>
          <MarqueeText
            text={
              isSession()
                ? [artistAlbumLine(), metaParts().join(" \u00b7 ")].filter(Boolean).join(" \u00b7 ")
                : artistAlbumLine()
            }
            class="text-xs wide:text-sm text-[var(--color-text-secondary)]"
            isHovering={isRowHovered}
          />
        </Show>

        {/* line 4: metadata — genre badge, year, tracks, duration, tags, URLs (non-session items only) */}
        <Show
          when={
            !isSession() &&
            (props.item.genre ||
              metaParts().length > 0 ||
              (props.item.tags && props.item.tags.length > 0) ||
              (props.item.urls && props.item.urls.length > 0))
          }
        >
          <div class="flex items-center gap-1 text-xs text-[var(--color-text-tertiary)] overflow-hidden">
            <Show when={props.item.genre}>
              <span
                class="px-1.5 py-px rounded-full flex-shrink-0 cursor-pointer hover:brightness-125 transition-all"
                onClick={(e) => {
                  e.stopPropagation();
                  if (props.item.genre_id && props.onGenreClick) {
                    props.onGenreClick(props.item.genre_id);
                  }
                }}
                title={`go to ${props.item.genre}`}
              >
                {props.item.genre}
              </span>
            </Show>
            <Show when={metaParts().length > 0}>
              <MarqueeText
                text={metaParts().join(" \u00b7 ")}
                class="text-xs text-[var(--color-text-tertiary)]"
                isHovering={isRowHovered}
              />
            </Show>
            <Show when={props.item.tags && props.item.tags.length > 0}>
              <For each={props.item.tags!.slice(0, 3)}>
                {(tag) => (
                  <span class="px-1 py-px rounded bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] flex-shrink-0">
                    #{tag}
                  </span>
                )}
              </For>
            </Show>
            {/* inline entity URLs - limit to first 2 to save space */}
            <Show when={props.item.urls && props.item.urls.length > 0}>
              <div onClick={(e) => e.stopPropagation()} class="flex-shrink-0">
                <EntityLinks urls={props.item.urls!.slice(0, 2)} />
              </div>
            </Show>
          </div>
        </Show>

        {/* session progress bar */}
        <Show when={hasProgress()}>
          <div class="flex items-center gap-2">
            <div class="flex-1 h-1 bg-[var(--color-accent-500)]/15 rounded-full overflow-hidden">
              <div
                class="h-full bg-[var(--color-accent-500)] rounded-full transition-all duration-300"
                style={{ width: `${progressPercent()}%` }}
              />
            </div>
            <span class="text-[10px] text-[var(--color-text-muted)] flex-shrink-0 tabular-nums">
              {props.item.songs_completed}/{props.item.total_songs}
              {(props.item.total_songs ?? 0) > 1 ? ` tracks \u00b7 ` : ` \u00b7 `}
              {Math.round(progressPercent())}%
            </span>
          </div>
        </Show>

        {/* session status */}
        <Show when={isSession() && props.item.session_status && !hasProgress()}>
          <div class="text-[11px] text-[var(--color-text-muted)]">
            {props.item.session_status}
            {(props.item.total_songs ?? 0) > 1 ? (
              <> &middot; {props.item.total_songs} tracks</>
            ) : null}
          </div>
        </Show>

        {/* playlist description — only if it doesn't duplicate subtitle */}
        <Show
          when={
            props.item.description &&
            props.item.feed_type === "recent_playlist" &&
            props.item.description !== props.item.subtitle
          }
        >
          <div class="text-[11px] text-[var(--color-text-muted)] truncate">
            {props.item.description}
          </div>
        </Show>
      </div>

      {/* right side: timestamp + remote badge + actions */}
      <div class="flex flex-col items-end flex-shrink-0 gap-1 py-3 justify-start">
        <RelativeTime timestamp={createdAt()} class="text-[11px] text-[var(--color-text-muted)]" />
        <Show when={props.item.remote_name}>
          <span class="text-[10px] px-1.5 py-px rounded-full bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] truncate max-w-[80px]">
            {props.item.remote_name}
          </span>
        </Show>
        <Show when={props.item.play_count && props.item.play_count > 1}>
          <span class="text-[10px] text-[var(--color-text-muted)]">
            {props.item.play_count} plays
          </span>
        </Show>
        {/* favorite + queue actions — always visible on narrow, hover-only on desktop */}
        <div
          class="flex items-center gap-1 transition-opacity wide:opacity-0"
          classList={{ "wide:!opacity-100": isRowHovered() }}
        >
          <Show when={favoriteTarget()}>
            {(target) => (
              <div onClick={(e) => e.stopPropagation()}>
                <FavoriteToggle
                  targetType={target().type}
                  targetId={target().id}
                  isFavorite={props.item.is_favorite}
                  size="sm"
                />
              </div>
            )}
          </Show>
          <Show
            when={
              props.onAddToQueue &&
              (props.item.song_id || props.item.album_id || props.item.playlist_id)
            }
          >
            <button
              class="w-5 h-5 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-accent-500)] hover:bg-[var(--color-accent-500)]/10 transition-colors"
              onClick={handleQueueClick}
              title="add to queue"
            >
              <Icon name="add" size={14} />
            </button>
          </Show>
        </div>
      </div>
    </div>
  );
}
