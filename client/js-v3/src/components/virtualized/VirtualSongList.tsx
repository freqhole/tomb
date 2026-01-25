import { createVirtualizer } from "@tanstack/solid-virtual";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  JSX,
  onMount,
  Show,
  untrack,
} from "solid-js";
import { MediaThumbnail } from "../media/MediaThumbnail";
import { ContextMenu, type MenuAction } from "../overlays/ContextMenu";
import { FavoriteToggle } from "../ratings/FavoriteToggle";
import { StarRatingCompact } from "../ratings/StarRatingCompact";
import { MarqueeText } from "../text/MarqueeText";
import { useScrollRestore } from "../../utils/scrollRestore";

export interface VirtualSong {
  id: string;
  sha256?: string; // needed for favorite queue updates
  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  genre?: string;
  duration: string; // formatted as "3:45"
  year?: number;
  discNumber?: number;
  trackNumber?: number;
  thumbnailUrl?: string | null;
  userIsFavorite?: boolean;
  userRating?: number | null;
  tags?: string[];
}

export type SortField =
  | "track"
  | "title"
  | "artist"
  | "album"
  | "genre"
  | "year"
  | "duration"
  | "favorite"
  | "rating";

export type SortDirection = "asc" | "desc" | null;

export interface SortState {
  field: SortField;
  direction: SortDirection;
}

export interface VirtualSongListProps {
  /** array of songs to display */
  songs: VirtualSong[];
  /** current sort state */
  sortState?: SortState;
  /** callback when sort changes (for server-side sorting) */
  onSortChange?: (field: SortField, direction: SortDirection) => void;
  /** callback when a song is clicked */
  onSongClick?: (song: VirtualSong, index: number) => void;
  /** callback when a song is double-clicked (for play action) */
  onSongDoubleClick?: (song: VirtualSong, index: number) => void;
  /** callback when favorite is toggled */
  onFavoriteToggle?: (song: VirtualSong, isFavorite: boolean) => void;
  /** callback when rating changes */
  onRatingChange?: (song: VirtualSong, rating: number) => void;
  /** callback to get context menu actions for a song */
  getContextMenuActions?: (song: VirtualSong, index: number) => MenuAction[];
  /** callback when virtualizer is rendering items near end (for infinite scroll) */
  onNearEnd?: () => void;
  /** currently playing song id */
  playingSongId?: string;
  /** selected song ids */
  selectedSongIds?: Set<string>;
  /** height of the container */
  height?: number;
  /** show track numbers (computed from disc + track) */
  showTrackNumber?: boolean;
  /** show favorites column */
  showFavorites?: boolean;
  /** show rating column */
  showRating?: boolean;
  /** show tags column */
  showTags?: boolean;
  /** variant for different contexts */
  variant?: "default" | "playlist" | "queue" | "album" | "artist";
  /** additional css classes */
  class?: string;
  /** unique key for scroll position restoration */
  scrollRestoreKey?: string;
}

export function VirtualSongList(props: VirtualSongListProps): JSX.Element {
  let parentRef: HTMLDivElement | undefined;
  const height = () => props.height || 600;
  const variant = () => props.variant || "default";

  // scroll restoration
  const [savedScrollOffset, setSavedScrollOffset] = createSignal(0);
  const { restoreScroll, saveScroll } = useScrollRestore(props.scrollRestoreKey || "song-list");

  // determine which columns to show based on variant
  const showTrackNumber = () => {
    if (props.showTrackNumber !== undefined) return props.showTrackNumber;
    return true; // always show track number by default
  };

  const showArtist = () => variant() !== "artist";
  const showAlbum = () => variant() !== "album";
  const showFavorites = () => props.showFavorites !== false;
  const showRating = () => props.showRating !== false;
  const showTags = () => props.showTags !== false;

  // compute track number from disc + track
  const getTrackNumber = (song: VirtualSong, index: number): string => {
    // for queue or playlist with position field, use position/index
    if (variant() === "queue" || variant() === "playlist") {
      return String(index + 1);
    }

    // if song has disc + track, compute the absolute track number
    // by counting all tracks from previous discs
    if (song.discNumber && song.trackNumber) {
      // count how many tracks are in previous discs for this album
      let trackOffset = 0;
      for (let i = 0; i < index; i++) {
        const prevSong = props.songs[i];
        // same album/artist and earlier disc
        if (
          prevSong.album === song.album &&
          prevSong.artist === song.artist &&
          prevSong.discNumber &&
          prevSong.discNumber < song.discNumber
        ) {
          trackOffset++;
        }
      }
      return String(trackOffset + song.trackNumber);
    }

    // fallback to track number or index
    return song.trackNumber ? String(song.trackNumber) : String(index + 1);
  };

  // track last triggered count to prevent infinite loops
  const [lastTriggeredAtCount, setLastTriggeredAtCount] = createSignal(0);

  // create virtualizer instance - preserve scroll offset across recreations
  const rowVirtualizer = createMemo((prev) => {
    // save current scroll position before virtualizer recreation
    if (prev && parentRef) {
      setSavedScrollOffset(parentRef.scrollTop);
    }

    props.songs.length; // track for reactivity
    
    const virtualizer = createVirtualizer({
      count: props.songs.length,
      getScrollElement: () => parentRef,
      estimateSize: () => 48,
      overscan: 20,
      measureElement:
        typeof window !== "undefined" &&
        navigator.userAgent.indexOf("Firefox") === -1
          ? (element) => element?.getBoundingClientRect().height
          : undefined,
    });

    // restore scroll position after virtualizer is created
    if (savedScrollOffset() > 0 && parentRef) {
      queueMicrotask(() => {
        if (parentRef) {
          parentRef.scrollTop = savedScrollOffset();
        }
      });
    }

    return virtualizer;
  });

  // detect when virtualizer is rendering items near end (for infinite scroll)
  createEffect(() => {
    const items = rowVirtualizer().getVirtualItems();
    if (items.length === 0) return;

    const lastItem = items[items.length - 1];
    const totalCount = props.songs.length;

    // only trigger once per data length milestone
    // trigger when within last 30 items OR last 25% (whichever is larger)
    const threshold = Math.max(totalCount - 30, Math.floor(totalCount * 0.75));

    if (lastItem.index >= threshold && totalCount > lastTriggeredAtCount()) {
      setLastTriggeredAtCount(totalCount);
      // untrack to prevent this call from causing re-runs
      untrack(() => props.onNearEnd?.());
    }
  });

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

  const getSortIcon = (field: SortField): string => {
    const current = props.sortState;
    if (!current || current.field !== field || !current.direction) {
      return "↕";
    }
    return current.direction === "asc" ? "↑" : "↓";
  };

  const handleRowClick = (song: VirtualSong, index: number) => {
    props.onSongClick?.(song, index);
  };

  const handleRowDoubleClick = (song: VirtualSong, index: number) => {
    props.onSongDoubleClick?.(song, index);
  };

  const handleFavoriteClick = (e: MouseEvent, song: VirtualSong) => {
    e.stopPropagation();
    props.onFavoriteToggle?.(song, !song.userIsFavorite);
  };

  // grid template based on visible columns
  const getGridTemplate = () => {
    const cols: string[] = [];

    if (showTrackNumber()) cols.push("60px"); // #
    cols.push("minmax(200px, 3fr)"); // title - wider
    if (showArtist()) cols.push("minmax(150px, 1.5fr)"); // artist
    if (showAlbum()) cols.push("minmax(150px, 1.5fr)"); // album
    cols.push("minmax(100px, 0.8fr)"); // genre - narrower
    cols.push("70px"); // year - wider to fit "year ↕"
    cols.push("70px"); // duration - wider to fit "time ↕"
    if (showFavorites()) cols.push("25px"); // favorite - narrower
    if (showRating()) cols.push("25px"); // rating - narrower
    if (showTags()) cols.push("minmax(150px, 1fr)"); // tags

    return cols.join(" ");
  };

  const handleScroll = () => {
    if (parentRef) {
      saveScroll(parentRef);
    }
  };

  // restore scroll position on mount
  onMount(() => {
    if (parentRef) {
      // use double RAF to ensure virtualizer has calculated sizes and rendered
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (parentRef) {
            restoreScroll(parentRef);
          }
        });
      });
    }
  });

  return (
    <div
      ref={parentRef!}
      class={`overflow-auto bg-[var(--color-bg-primary)] ${props.class || ""}`}
      style={{ height: `${height()}px` }}
      onScroll={handleScroll}
    >
      {/* sticky header row with grid layout */}
      <div
        class="sticky top-0 z-10 bg-[var(--color-bg-elevated)] border-b border-[var(--color-border-default)] text-xs text-[var(--color-text-tertiary)] font-medium uppercase tracking-wide"
        style={{
          display: "grid",
          "grid-template-columns": getGridTemplate(),
          "min-width": "fit-content",
        }}
      >
        <Show when={showTrackNumber()}>
          <button
            class="px-3 py-3 text-left hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
            onClick={() => handleSort("track")}
          >
            # {getSortIcon("track")}
          </button>
        </Show>

        <button
          class="px-4 py-3 text-left hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
          onClick={() => handleSort("title")}
        >
          title {getSortIcon("title")}
        </button>

        <Show when={showArtist()}>
          <button
            class="px-4 py-3 text-left hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
            onClick={() => handleSort("artist")}
          >
            artist {getSortIcon("artist")}
          </button>
        </Show>

        <Show when={showAlbum()}>
          <button
            class="px-4 py-3 text-left hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
            onClick={() => handleSort("album")}
          >
            album {getSortIcon("album")}
          </button>
        </Show>

        <button
          class="px-4 py-3 text-left hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
          onClick={() => handleSort("genre")}
        >
          genre {getSortIcon("genre")}
        </button>

        <button
          class="px-4 py-3 text-left hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
          onClick={() => handleSort("year")}
        >
          year {getSortIcon("year")}
        </button>

        <button
          class="px-4 py-3 text-right hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
          onClick={() => handleSort("duration")}
        >
          time {getSortIcon("duration")}
        </button>

        <Show when={showFavorites()}>
          <div class="px-3 py-3"></div>
        </Show>

        <Show when={showRating()}>
          <div class="px-3 py-3"></div>
        </Show>

        <Show when={showTags()}>
          <div class="px-4 py-3 text-left">tags</div>
        </Show>
      </div>

      {/* virtual list container */}
      <div
        style={{
          height: `${rowVirtualizer().getTotalSize()}px`,
          width: "100%",
          position: "relative",
          "min-width": "fit-content",
        }}
      >
        <For each={rowVirtualizer().getVirtualItems()}>
          {(virtualRow) => {
            // make song access reactive so changes to song data trigger re-renders
            const song = () => props.songs[virtualRow.index];
            const isPlaying = () => props.playingSongId === song().id;
            const isSelected = () => props.selectedSongIds?.has(song().id);

            const rowContent = (
              <div
                class={`
                  h-full cursor-pointer
                  border-b border-[var(--color-border-subtle)]
                  transition-colors
                  ${isPlaying() ? "bg-[var(--color-accent-500)] bg-opacity-10 text-[var(--color-accent-500)]" : "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)]"}
                  ${isSelected() ? "bg-[var(--color-bg-hover)]" : ""}
                `}
                style={{
                  display: "grid",
                  "grid-template-columns": getGridTemplate(),
                  "align-items": "center",
                }}
                onClick={() => handleRowClick(song(), virtualRow.index)}
                onDblClick={() =>
                  handleRowDoubleClick(song(), virtualRow.index)
                }
              >
                {/* thumbnail with track number overlay */}
                <Show when={showTrackNumber()}>
                  <div class="px-3 flex justify-center">
                    <MediaThumbnail
                      thumbnailUrl={song().thumbnailUrl}
                      indexText={getTrackNumber(song(), virtualRow.index)}
                      hideIndex={false}
                      onPlayClick={() =>
                        handleRowDoubleClick(song(), virtualRow.index)
                      }
                      size={40}
                    />
                  </div>
                </Show>

                {/* title */}
                <div class="px-4 min-w-0">
                  <div class="font-medium">
                    <MarqueeText text={song().title} hoverOnly={true} />
                  </div>
                </div>

                {/* artist */}
                <Show when={showArtist()}>
                  <div class="px-4 min-w-0">
                    <div class="text-sm text-[var(--color-text-secondary)]">
                      <MarqueeText text={song().artist} hoverOnly={true} />
                    </div>
                  </div>
                </Show>

                {/* album */}
                <Show when={showAlbum()}>
                  <div class="px-4 min-w-0">
                    <div class="text-sm text-[var(--color-text-secondary)]">
                      <MarqueeText text={song().album} hoverOnly={true} />
                    </div>
                  </div>
                </Show>

                {/* genre */}
                <div class="px-4 min-w-0">
                  <div class="text-[var(--color-text-tertiary)] text-sm">
                    <MarqueeText text={song().genre || "—"} hoverOnly={true} />
                  </div>
                </div>

                {/* year */}
                <div class="px-4 text-left text-[var(--color-text-tertiary)] text-sm tabular-nums">
                  {song().year || "—"}
                </div>

                {/* duration */}
                <div class="px-4 text-right text-[var(--color-text-tertiary)] text-sm tabular-nums">
                  {song().duration}
                </div>

                {/* favorite */}
                <Show when={showFavorites()}>
                  <div class="px-3 flex items-center justify-center">
                    <FavoriteToggle
                      targetType="song"
                      targetId={song().id}
                      sha256={song().sha256}
                      isFavorite={song().userIsFavorite ?? false}
                      size="sm"
                      onToggleSuccess={(newValue) => {
                        props.onFavoriteToggle?.(song(), newValue);
                      }}
                    />
                  </div>
                </Show>

                {/* rating */}
                <Show when={showRating()}>
                  <div class="px-3 flex items-center justify-center">
                    <StarRatingCompact
                      rating={song().userRating}
                      size="sm"
                      onRatingChange={(newRating) => {
                        console.log("TODO: wire up rating change", song().id, newRating);
                        // props.onRatingChange?.(song(), newRating);
                      }}
                    />
                  </div>
                </Show>

                {/* tags */}
                <Show when={showTags()}>
                  <div class="px-4 min-w-0">
                    <div class="text-xs text-[var(--color-text-muted)]">
                      <MarqueeText
                        text={song().tags?.join(", ") || ""}
                        hoverOnly={true}
                      />
                    </div>
                  </div>
                </Show>
              </div>
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
                {props.getContextMenuActions ? (
                  <ContextMenu
                    actions={props.getContextMenuActions(
                      song(),
                      virtualRow.index,
                    )}
                  >
                    {rowContent}
                  </ContextMenu>
                ) : (
                  rowContent
                )}
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}

export default VirtualSongList;
