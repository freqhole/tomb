// virtualized feed list — infinite scrolling list of feed events

import { createVirtualizer } from "@tanstack/solid-virtual";
import { createMemo, createSignal, onCleanup, onMount, Show, For } from "solid-js";
import type { FeedItem, FeedItemType } from "../../music/data/types";
import { Icon, type IconName } from "../icons/registry";
import { MediaThumbnail } from "../media/MediaThumbnail";
import { ContextMenu, type MenuAction } from "../overlays/ContextMenu";
import { MarqueeText } from "../text/MarqueeText";
import { formatLongDuration } from "../../utils/formatDuration";
import { entityColors } from "../../design-system/colors";
import { useNavigate } from "@solidjs/router";
import { routes } from "../../music/utils/routing";
import { FavoriteToggle } from "../../utils/FavoriteToggle";
import type { FavoriteTarget } from "../../music/queries/favorites";
import { getCurrentUserId } from "../../music/data";

const ROW_HEIGHT = 100;
const IMAGE_SIZE = ROW_HEIGHT - 12; // 6px padding top + bottom
const OVERSCAN = 8;

// scroll position cache
const scrollCache = new Map<string, number>();

// relative time formatting
function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 30) return `${weeks}w ago`;
  return new Date(timestamp).toLocaleDateString();
}

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
  isFetchingMore?: boolean;
  scrollKey?: string;
  onScroll?: (scrollTop: number) => void;
}

export function VirtualFeedList(props: VirtualFeedListProps) {
  let scrollContainerRef: HTMLDivElement | undefined;

  const count = createMemo(() => props.items.length);

  const virtualizer = createVirtualizer({
    get count() {
      return count();
    },
    getScrollElement: () => scrollContainerRef ?? null,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  // restore scroll position on mount
  onMount(() => {
    if (props.scrollKey && scrollContainerRef) {
      const savedPos = scrollCache.get(props.scrollKey);
      if (savedPos !== undefined && savedPos > 0) {
        requestAnimationFrame(() => {
          scrollContainerRef?.scrollTo({ top: savedPos });
        });
      }
    }
  });

  // save scroll position on cleanup
  onCleanup(() => {
    if (props.scrollKey && scrollContainerRef) {
      scrollCache.set(props.scrollKey, scrollContainerRef.scrollTop);
    }
  });

  // near-end detection for infinite scroll
  const checkNearEnd = () => {
    if (!props.onNearEnd) return;
    const items = virtualizer.getVirtualItems();
    if (items.length === 0) return;
    const lastItem = items[items.length - 1];
    if (lastItem && lastItem.index >= count() - 20) {
      props.onNearEnd();
    }
  };

  return (
    <div
      ref={scrollContainerRef!}
      class="overflow-auto"
      style={{
        height: `${props.height}px`,
        "padding-top": props.scrollPaddingTop ? `${props.scrollPaddingTop}px` : undefined,
      }}
      onScroll={() => {
        checkNearEnd();
        if (props.onScroll && scrollContainerRef) {
          props.onScroll(scrollContainerRef.scrollTop);
        }
      }}
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
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = props.items[virtualRow.index];
            if (!item) return null;

            const actions = () => props.getContextMenuActions?.(item) ?? [];

            const rowContent = (
              <FeedRow
                item={item}
                onClick={() => props.onItemClick?.(item)}
                onImageClick={() => props.onImageClick?.(item)}
                onAddToQueue={props.onAddToQueue ? () => props.onAddToQueue!(item) : undefined}
              />
            );

            return (
              <div
                data-index={virtualRow.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <Show when={actions().length > 0} fallback={rowContent}>
                  <ContextMenu actions={actions()}>{rowContent}</ContextMenu>
                </Show>
              </div>
            );
          })}
        </div>

        {/* loading indicator at bottom */}
        <Show when={props.isFetchingMore}>
          <div class="flex items-center justify-center py-4">
            <Icon name="loader" size={20} color="var(--color-text-muted)" />
            <span class="text-[var(--color-text-muted)] ml-2 text-xs">loading more...</span>
          </div>
        </Show>
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
}) {
  const navigate = useNavigate();
  const [isRowHovered, setIsRowHovered] = createSignal(false);
  const [isThumbHovered, setIsThumbHovered] = createSignal(false);

  const typeInfo = () => feedTypeInfo(props.item.feed_type);
  const images = () => props.item.images;
  const hasImages = () => !!(images() && images()!.length > 0);
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
    const isOwn = item.user_id && item.user_id === getCurrentUserId();
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
      case "recent_album":
        return { user: null, verb: "", entity: "new album" };
      case "recent_rating":
        return { user, verb: "rated", entity: entity || "a song" };
      case "recent_playlist":
        return { user, verb: "created", entity: entity || "a playlist" };
      case "listen_session":
        return { user, verb: "had", entity: "a listening session" };
      case "new_image": {
        const imageEntity = item.target_type ? `new ${item.target_type} image` : "new image";
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
      class="w-full h-full flex items-stretch gap-3 px-4 text-left transition-colors hover:bg-[var(--color-accent-500)]/5 cursor-pointer"
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
          <MediaThumbnail images={images()} size={IMAGE_SIZE} hideIndex showPlayIcon={false} />

          {/* feed type icon overlay — visible by default, hidden when ROW is hovered */}
          <div
            class="absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity"
            style={{ opacity: isRowHovered() ? "0" : "1" }}
          >
            <Icon name={typeInfo().icon} size={32} color={typeInfo().color} />
          </div>
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
        <div class="flex items-center gap-1 text-sm" style={{ color: typeInfo().color }}>
          <Show when={actionText().user}>
            <span class="font-bold">{actionText().user}</span>
          </Show>
          <Show when={actionText().verb}>
            <Show when={actionText().verb === "\u2665"} fallback={<span>{actionText().verb}</span>}>
              <Icon name="favorite" size={14} color={entityColors.favorite} />
            </Show>
          </Show>
          <span>{actionText().entity}</span>
          <Show when={props.item.rating != null}>
            <span class="ml-1 flex items-center gap-0.5">
              <Icon name="star" size={11} color={entityColors.rating} />
              {props.item.rating}/5
            </span>
          </Show>
        </div>

        {/* line 2: title */}
        <Show when={props.item.title}>
          <MarqueeText
            text={props.item.title}
            class="text-base font-medium text-[var(--color-text-primary)] leading-tight"
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
            class="text-sm text-[var(--color-text-secondary)]"
            isHovering={isRowHovered}
          />
        </Show>

        {/* line 4: metadata — genre badge, year, tracks, duration, tags (non-session items only) */}
        <Show
          when={
            !isSession() &&
            (props.item.genre ||
              metaParts().length > 0 ||
              (props.item.tags && props.item.tags.length > 0))
          }
        >
          <div class="flex items-center gap-1 text-xs text-[var(--color-text-tertiary)] overflow-hidden">
            <Show when={props.item.genre}>
              <span
                class="px-1.5 py-px rounded-full flex-shrink-0 cursor-pointer hover:brightness-125 transition-all"
                style={{
                  background: `color-mix(in srgb, ${entityColors.genre} 20%, transparent)`,
                  color: entityColors.genre,
                  "font-size": "10px",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (props.item.genre_id) {
                    navigate(routes.genre(props.item.genre_id));
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

      {/* right side: timestamp + actions */}
      <div class="flex flex-col items-end flex-shrink-0 gap-1 py-3 justify-start">
        <span class="text-[11px] text-[var(--color-text-muted)]">{timeAgo(createdAt())}</span>
        <Show when={props.item.play_count && props.item.play_count > 1}>
          <span class="text-[10px] text-[var(--color-text-muted)]">
            {props.item.play_count} plays
          </span>
        </Show>
        {/* favorite + queue actions — visible on hover */}
        <div
          class="flex items-center gap-1 transition-opacity"
          classList={{ "opacity-0": !isRowHovered(), "opacity-100": isRowHovered() }}
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
