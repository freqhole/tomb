// virtualized song list - optimized for large lists with infinite scroll

import { createVirtualizer } from "@tanstack/solid-virtual";
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import type { Song } from "../../music/data/types";
import { formatDuration } from "../../utils/formatDuration";
import { ContextMenu, type MenuAction } from "../overlays/ContextMenu";
import { MediaThumbnail } from "../media/MediaThumbnail";
import { MarqueeText } from "../text/MarqueeText";
import { FavoriteHeart } from "../ratings/FavoriteHeart";
import { Rating } from "../ratings/Rating";
import { isNarrowViewport } from "../../config/breakpoints";

// row heights for different layouts
const TABLE_ROW_HEIGHT = 48;
const COMPACT_ROW_HEIGHT = 64; // taller for 2-line content
const OVERSCAN = 5;
const IMAGE_SIZE = 40;

// horizontal padding for cells - adjust this value to change spacing
const CELL_PAD = "px-2";

// simple scroll position cache keyed by scrollKey prop
const scrollCache = new Map<string, number>();

// sort field types matching query params
export type SortField =
  | "title"
  | "artist"
  | "album"
  | "genre"
  | "year"
  | "duration"
  | "added_at"
  | "play_count";
export type SortDirection = "asc" | "desc" | null;

export interface SortState {
  field: SortField;
  direction: SortDirection;
}

export interface VirtualSongListProps {
  songs: Song[];
  height: number;
  onSongClick?: (song: Song, index: number) => void;
  onSongDoubleClick?: (song: Song, index: number) => void;
  onNearEnd?: () => void;
  /** function to get context menu actions for a song */
  getContextMenuActions?: (song: Song, index: number) => MenuAction[];
  /** unique key for scroll position persistence (e.g. "songs-view" or "playlist-123") */
  scrollKey?: string;
  /** sha256 of currently playing song (for highlight) */
  playingSongId?: string;
  /** callback when thumbnail play button is clicked */
  onPlayClick?: (song: Song, index: number) => void;
  /** current sort state */
  sortState?: SortState;
  /** callback when sort changes */
  onSortChange?: (field: SortField, direction: SortDirection) => void;
  /** callback when favorite is toggled */
  onFavoriteToggle?: (song: Song, isFavorite: boolean) => void;
  /** callback when rating changes */
  onRatingChange?: (song: Song, rating: number) => void;
  // selection support
  /** set of selected song IDs */
  selectedSongIds?: Set<string>;
  /** callback for selection-aware clicks (receives mouse event for modifier key detection) */
  onSelectionClick?: (song: Song, index: number, event: MouseEvent) => void;
  /** whether to show selection styling (only when 2+ selected) */
  showSelectionHighlight?: boolean;
  /** callback when context menu is about to open (use to clear selection) */
  onContextMenuOpen?: () => void;
  /** extra padding at top of scroll container (for topnav overlap, only on wide viewports) */
  scrollPaddingTop?: number;
}

export function VirtualSongList(props: VirtualSongListProps) {
  let scrollContainerRef: HTMLDivElement | undefined;

  // track which row is hovered for marquee text
  const [hoveredRowIndex, setHoveredRowIndex] = createSignal<number | null>(null);

  // responsive: window-based for compact layout
  const [isNarrow, setIsNarrow] = createSignal(isNarrowViewport());

  // container-based breakpoints for column sizing (adapts to queue panel)
  const [containerWidth, setContainerWidth] = createSignal(0);
  // thresholds based on calculated min-widths: lg content fits at 1104px, xl at 1328px
  const isContainerLg = () => containerWidth() >= 1110;
  const isContainerXl = () => containerWidth() >= 1340;

  // compute min-width based on container breakpoint to match column widths
  // formula: padding(32) + fixed(288) + responsive + title(144)
  // fixed: thumbnail(48) + year(56) + duration(56) + plays(56) + favorite(32) + rating(40) = 288
  // responsive: artist + album + genres + tags (varies by breakpoint)
  // base: 176+176+96+128 = 576 → 32+288+576+144 = 1040
  // lg: 192+192+112+144 = 640 → 32+288+640+144 = 1104
  // xl: 256+288+176+144 = 864 → 32+288+864+144 = 1328
  const tableMinWidth = () => {
    if (isContainerXl()) return "1328px";
    if (isContainerLg()) return "1104px";
    return "1040px";
  };

  // container-based column widths (in px)
  // returns tailwind-style width class based on container size
  const colWidth = {
    artist: () => (isContainerXl() ? "w-64" : isContainerLg() ? "w-48" : "w-44"),
    album: () => (isContainerXl() ? "w-72" : isContainerLg() ? "w-48" : "w-44"),
    genres: () => (isContainerXl() ? "w-44" : isContainerLg() ? "w-28" : "w-24"),
    tags: () => (isContainerXl() ? "w-36" : isContainerLg() ? "w-36" : "w-32"),
  };

  // current row height based on layout mode
  const rowHeight = () => (isNarrow() ? COMPACT_ROW_HEIGHT : TABLE_ROW_HEIGHT);

  // stable count accessor - only updates when length actually changes
  const count = createMemo(() => props.songs.length);

  const virtualizer = createVirtualizer({
    get count() {
      return count();
    },
    getScrollElement: () => scrollContainerRef ?? null,
    estimateSize: () => rowHeight(),
    overscan: OVERSCAN,
  });

  // listen for window resize to update compact layout mode
  onMount(() => {
    const handleResize = () => {
      const narrow = isNarrowViewport();
      if (narrow !== isNarrow()) {
        setIsNarrow(narrow);
        // force virtualizer to recalculate with new row height
        virtualizer.measure();
      }
    };

    window.addEventListener("resize", handleResize);
    onCleanup(() => window.removeEventListener("resize", handleResize));
  });

  // track container width for responsive column sizing (adapts to queue panel)
  onMount(() => {
    if (!scrollContainerRef) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    observer.observe(scrollContainerRef);
    onCleanup(() => observer.disconnect());
  });

  // restore scroll position on mount
  onMount(() => {
    if (props.scrollKey && scrollContainerRef) {
      const savedPos = scrollCache.get(props.scrollKey);
      if (savedPos !== undefined && savedPos > 0) {
        // small delay to let virtualizer initialize
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

  // scroll to top when sort changes
  createEffect(
    on(
      () => props.sortState,
      (current, prev) => {
        // skip initial run (prev is undefined)
        if (prev === undefined) return;
        // scroll to top when sort field or direction changes
        if (current?.field !== prev?.field || current?.direction !== prev?.direction) {
          scrollContainerRef?.scrollTo({ top: 0, behavior: "instant" });
          // also clear the saved scroll position
          if (props.scrollKey) {
            scrollCache.delete(props.scrollKey);
          }
        }
      }
    )
  );

  // near-end detection for infinite scroll
  const checkNearEnd = () => {
    if (!props.onNearEnd) return;
    const items = virtualizer.getVirtualItems();
    if (items.length === 0) return;
    const lastItem = items[items.length - 1];
    if (lastItem && lastItem.index >= count() - 50) {
      props.onNearEnd();
    }
  };

  // event delegation - single handler for all clicks
  const handleContainerClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;

    // ignore clicks on thumbnail (MediaThumbnail handles its own clicks)
    if (target.closest("[data-thumbnail]")) {
      return;
    }

    const row = target.closest("[data-row-index]") as HTMLElement | null;
    if (!row) return;

    const index = parseInt(row.dataset.rowIndex!, 10);
    const song = props.songs[index];
    if (!song) return;

    // if selection callback provided and modifier key pressed, use selection handling
    if (props.onSelectionClick && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      props.onSelectionClick(song, index, e);
      return;
    }

    // regular row click handling
    if (e.detail === 2) {
      props.onSongDoubleClick?.(song, index);
    } else if (props.onSelectionClick) {
      // if selection is enabled, single clicks go through selection handler too
      props.onSelectionClick(song, index, e);
    } else {
      props.onSongClick?.(song, index);
    }
  };

  // event delegation for hover - track which row is hovered
  const handleContainerMouseOver = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const row = target.closest("[data-row-index]") as HTMLElement | null;
    if (row) {
      const index = parseInt(row.dataset.rowIndex!, 10);
      setHoveredRowIndex(index);
    }
  };

  const handleContainerMouseLeave = () => {
    setHoveredRowIndex(null);
  };

  // handle sort cycling: null -> asc -> desc -> null
  const handleSort = (field: SortField) => {
    if (!props.onSortChange) return;

    const current = props.sortState;

    if (!current || current.field !== field) {
      // first click on new column: asc
      props.onSortChange(field, "asc");
    } else if (current.direction === "asc") {
      // second click: desc
      props.onSortChange(field, "desc");
    } else {
      // third click: clear (back to default)
      props.onSortChange(field, null);
    }
  };

  // get sort indicator for a column
  const getSortIndicator = (field: SortField): string => {
    const current = props.sortState;
    if (!current || current.field !== field || !current.direction) {
      return "↕";
    }
    return current.direction === "asc" ? "↑" : "↓";
  };

  // only apply scroll padding on wide viewports (narrow has its own fixed nav)
  const scrollPad = () =>
    props.scrollPaddingTop && window.matchMedia("(min-width: 768px)").matches
      ? props.scrollPaddingTop
      : 0;

  // get images for a song - tries song images first, then album images
  const getImages = (song: Song) => {
    if (song.images && song.images.length > 0) return song.images;
    if (song.album_images && song.album_images.length > 0) return song.album_images;
    return undefined;
  };

  // format track number with optional disc
  const getTrackText = (song: Song, fallbackIndex: number) => {
    if (song.disc_number > 1) {
      return `${song.disc_number}-${song.track_number}`;
    }
    return String(song.track_number || fallbackIndex + 1);
  };

  return (
    <div class="relative" style={{ height: `${props.height}px` }}>
      <div
        ref={scrollContainerRef}
        class="overflow-auto"
        style={{
          height: `${isNarrow() ? props.height : props.height - TABLE_ROW_HEIGHT}px`,
          "padding-top": scrollPad() ? `${scrollPad()}px` : undefined,
        }}
        onScroll={checkNearEnd}
      >
        {/* narrow layout: compact rows without header */}
        <Show when={isNarrow()}>
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: "relative",
            }}
            onClick={handleContainerClick}
            onMouseOver={handleContainerMouseOver}
            onMouseLeave={handleContainerMouseLeave}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const song = props.songs[virtualRow.index];
              if (!song) return null;

              const isPlaying = props.playingSongId === song.sha256;
              const isHovered = () => hoveredRowIndex() === virtualRow.index;
              const isSelected = () =>
                props.showSelectionHighlight && props.selectedSongIds?.has(song.id);

              const compactRow = (
                <div
                  data-row-index={virtualRow.index}
                  class={`absolute left-0 right-0 flex items-center gap-3 px-3 cursor-pointer ${
                    isSelected()
                      ? "bg-[var(--color-accent-500)]/30"
                      : isPlaying
                        ? "bg-[#66003b]/20 border-l-2 border-l-[var(--color-accent-500)]"
                        : "hover:bg-[var(--color-bg-tertiary)] active:bg-[var(--color-bg-elevated)]"
                  }`}
                  style={{
                    height: `${COMPACT_ROW_HEIGHT}px`,
                    top: `${virtualRow.start}px`,
                  }}
                >
                  {/* thumbnail */}
                  <div class="flex-shrink-0">
                    <MediaThumbnail
                      images={getImages(song)}
                      indexText={getTrackText(song, virtualRow.index)}
                      size={48}
                      hideIndex={isHovered()}
                      onPlayClick={() => props.onPlayClick?.(song, virtualRow.index)}
                      enablePlayClick={!!props.onPlayClick}
                      showPlayIcon={true}
                    />
                  </div>

                  {/* title + artist/album on two lines */}
                  <div class="flex-1 min-w-0">
                    <div
                      class={`text-sm font-medium truncate ${isPlaying ? "text-[var(--color-accent-500)]" : "text-[var(--color-text-primary)]"}`}
                    >
                      {song.title || "untitled"}
                    </div>
                    <div class="text-xs text-[var(--color-text-secondary)] truncate">
                      {song.artist_name || "unknown"} • {song.album_title || "unknown"}
                    </div>
                  </div>

                  {/* favorite */}
                  <div class="flex-shrink-0">
                    <FavoriteHeart
                      isFavorite={song.is_favorite ?? false}
                      onToggle={(isFavorite) => props.onFavoriteToggle?.(song, isFavorite)}
                      size="sm"
                      readonly={!props.onFavoriteToggle}
                    />
                  </div>

                  {/* duration */}
                  <div class="text-xs text-[var(--color-text-tertiary)] flex-shrink-0 w-10 text-right">
                    {formatDuration(song.duration_seconds)}
                  </div>
                </div>
              );

              if (props.getContextMenuActions) {
                return (
                  <ContextMenu
                    actions={props.getContextMenuActions(song, virtualRow.index)}
                    onOpen={() => props.onContextMenuOpen?.()}
                  >
                    {compactRow}
                  </ContextMenu>
                );
              }
              return compactRow;
            })}
          </div>
        </Show>

        {/* wide layout: table with header */}
        <Show when={!isNarrow()}>
          <div style={{ "min-width": tableMinWidth() }}>
            {/* virtual container */}
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                position: "relative",
              }}
              onClick={handleContainerClick}
              onMouseOver={handleContainerMouseOver}
              onMouseLeave={handleContainerMouseLeave}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const song = props.songs[virtualRow.index];
                if (!song) return null;

                const isPlaying = props.playingSongId === song.sha256;
                const isHovered = () => hoveredRowIndex() === virtualRow.index;
                const isSelected = () =>
                  props.showSelectionHighlight && props.selectedSongIds?.has(song.id);

                const rowContent = (
                  <div
                    data-row-index={virtualRow.index}
                    class={`absolute left-0 right-0 flex items-center px-4 cursor-pointer ${
                      isSelected()
                        ? "bg-[var(--color-accent-500)]/30"
                        : isPlaying
                          ? "bg-[#66003b]/20 border-l-2 border-l-[var(--color-accent-500)]"
                          : "hover:bg-[var(--color-bg-tertiary)]"
                    }`}
                    style={{
                      height: `${TABLE_ROW_HEIGHT}px`,
                      top: `${virtualRow.start}px`,
                    }}
                  >
                    {/* thumbnail with track number overlay and play hover */}
                    <div class="w-12 shrink-0 flex items-center justify-center">
                      <MediaThumbnail
                        images={getImages(song)}
                        indexText={getTrackText(song, virtualRow.index)}
                        size={IMAGE_SIZE}
                        hideIndex={isHovered()}
                        onPlayClick={() => props.onPlayClick?.(song, virtualRow.index)}
                        enablePlayClick={!!props.onPlayClick}
                        showPlayIcon={true}
                      />
                    </div>
                    <MarqueeText
                      text={song.title || "untitled"}
                      class={`flex-1 min-w-0 text-sm text-[var(--color-text-primary)]`}
                      padClass={CELL_PAD}
                      isHovering={isHovered()}
                    />
                    <MarqueeText
                      text={song.artist_name || "unknown artist"}
                      class={`${colWidth.artist()} shrink-0 text-sm text-[var(--color-text-secondary)]`}
                      padClass={CELL_PAD}
                      isHovering={isHovered()}
                    />
                    <MarqueeText
                      text={song.album_title || "unknown album"}
                      class={`${colWidth.album()} shrink-0 text-sm text-[var(--color-text-secondary)]`}
                      padClass={CELL_PAD}
                      isHovering={isHovered()}
                    />
                    {/* genres + non-genre taxons (label, mood, era, ...) */}
                    <MarqueeText
                      text={
                        [
                          ...(song.album_taxons
                            ?.filter((t) => t.kind_slug === "genre")
                            .map((t) => t.label) ?? []),
                          ...(song.album_taxons
                            ?.filter((t) => t.kind_slug !== "genre")
                            .map((t) => `${t.kind_slug}·${t.label}`) ?? []),
                        ].join(", ") || ""
                      }
                      class={`${colWidth.genres()} shrink-0 text-sm text-[var(--color-text-tertiary)] text-center`}
                      padClass={CELL_PAD}
                      isHovering={isHovered()}
                    />
                    {/* year */}
                    <div
                      class={`w-14 shrink-0 ${CELL_PAD} text-sm text-[var(--color-text-tertiary)] text-center`}
                    >
                      {song.year || ""}
                    </div>
                    {/* duration */}
                    <div
                      class={`w-14 shrink-0 ${CELL_PAD} text-sm text-[var(--color-text-tertiary)] text-center`}
                    >
                      {formatDuration(song.duration_seconds)}
                    </div>
                    {/* plays */}
                    <div
                      class={`w-14 shrink-0 ${CELL_PAD} text-sm text-[var(--color-text-tertiary)] text-center`}
                      title="total play count"
                    >
                      {song.play_count ? song.play_count : ""}
                    </div>
                    {/* tags */}
                    <MarqueeText
                      text={song.album_tags?.join(", ") || ""}
                      class={`${colWidth.tags()} shrink-0 text-xs text-[var(--color-text-muted)] text-center`}
                      padClass={CELL_PAD}
                      isHovering={isHovered()}
                    />
                    {/* favorite */}
                    <div class="w-8 shrink-0 flex items-center justify-center">
                      <FavoriteHeart
                        isFavorite={song.is_favorite ?? false}
                        onToggle={(isFavorite) => props.onFavoriteToggle?.(song, isFavorite)}
                        size="sm"
                        readonly={!props.onFavoriteToggle}
                      />
                    </div>
                    {/* rating */}
                    <div class="w-10 shrink-0 flex items-center justify-center">
                      <Rating
                        rating={song.user_rating}
                        size="sm"
                        onRatingChange={
                          props.onRatingChange
                            ? (rating) => props.onRatingChange?.(song, rating)
                            : undefined
                        }
                      />
                    </div>
                  </div>
                );

                // wrap with context menu if actions provided
                if (props.getContextMenuActions) {
                  return (
                    <ContextMenu
                      actions={props.getContextMenuActions(song, virtualRow.index)}
                      onOpen={() => props.onContextMenuOpen?.()}
                    >
                      {rowContent}
                    </ContextMenu>
                  );
                }

                return rowContent;
              })}
            </div>
          </div>
        </Show>
      </div>

      {/* header row - positioned at bottom */}
      <Show when={!isNarrow()}>
        <div
          class="absolute bottom-0 left-0 right-0 z-10 flex items-center px-4 bg-[var(--color-bg-secondary)] text-xs text-[var(--color-text-secondary)] uppercase tracking-wider border-t border-[var(--color-border-default)]"
          style={{ height: `${TABLE_ROW_HEIGHT}px`, "min-width": tableMinWidth() }}
        >
          <div class="w-12 shrink-0"></div>
          <div
            class={`flex-1 min-w-0 flex items-center gap-1 ${props.onSortChange ? "cursor-pointer hover:text-[var(--color-text-primary)]" : ""}`}
            onClick={() => handleSort("title")}
          >
            <span class="text-[10px]">{getSortIndicator("title")}</span> title
          </div>
          <div
            class={`${colWidth.artist()} shrink-0 flex items-center gap-1 ${props.onSortChange ? "cursor-pointer hover:text-[var(--color-text-primary)]" : ""}`}
            onClick={() => handleSort("artist")}
          >
            <span class="text-[10px]">{getSortIndicator("artist")}</span> artist
          </div>
          <div
            class={`${colWidth.album()} shrink-0 flex items-center gap-1 ${props.onSortChange ? "cursor-pointer hover:text-[var(--color-text-primary)]" : ""}`}
            onClick={() => handleSort("album")}
          >
            <span class="text-[10px]">{getSortIndicator("album")}</span> album
          </div>
          <div
            class={`${colWidth.genres()} shrink-0 flex items-center gap-1 ${props.onSortChange ? "cursor-pointer hover:text-[var(--color-text-primary)]" : ""}`}
            onClick={() => handleSort("genre")}
          >
            <span class="text-[10px]">{getSortIndicator("genre")}</span> genres
          </div>
          <div
            class={`w-14 shrink-0 flex items-center gap-1 ${props.onSortChange ? "cursor-pointer hover:text-[var(--color-text-primary)]" : ""}`}
            onClick={() => handleSort("year")}
          >
            <span class="text-[10px]">{getSortIndicator("year")}</span> year
          </div>
          <div
            class={`w-14 shrink-0 flex items-center gap-1 ${props.onSortChange ? "cursor-pointer hover:text-[var(--color-text-primary)]" : ""}`}
            onClick={() => handleSort("duration")}
          >
            <span class="text-[10px]">{getSortIndicator("duration")}</span> time
          </div>
          <div
            class={`w-14 shrink-0 flex items-center gap-1 ${props.onSortChange ? "cursor-pointer hover:text-[var(--color-text-primary)]" : ""}`}
            onClick={() => handleSort("play_count")}
            title="total play count"
          >
            <span class="text-[10px]">{getSortIndicator("play_count")}</span> plays
          </div>
          {/* tags column header */}
          <div class={`${colWidth.tags()} shrink-0 text-center`} title="tags (not sortable)">
            tags
          </div>
          {/* favorite column header */}
          <div class="w-8 shrink-0 flex items-center" title="favorite">
            ♡
          </div>
          {/* rating column header */}
          <div class="w-10 shrink-0 flex items-center" title="rating">
            ★
          </div>
        </div>
      </Show>
    </div>
  );
}
