import { createVirtualizer } from "@tanstack/solid-virtual";
import { createSignal, For, JSX, Show } from "solid-js";

export interface Song {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  duration: string; // formatted as "3:45"
  year?: number;
  discNumber?: number;
  trackNumber?: number;
  userIsFavorite?: boolean;
  userRating?: number | null;
  tags?: string[];
}

export type SortField =
  | "track"
  | "title"
  | "artist"
  | "album"
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
  songs: Song[];
  /** current sort state */
  sortState?: SortState;
  /** callback when sort changes (for server-side sorting) */
  onSortChange?: (field: SortField, direction: SortDirection) => void;
  /** callback when a song is clicked */
  onSongClick?: (song: Song, index: number) => void;
  /** callback when a song is double-clicked (for play action) */
  onSongDoubleClick?: (song: Song, index: number) => void;
  /** callback when favorite is toggled */
  onFavoriteToggle?: (song: Song, isFavorite: boolean) => void;
  /** callback when rating changes */
  onRatingChange?: (song: Song, rating: number) => void;
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
}

export function VirtualSongList(props: VirtualSongListProps): JSX.Element {
  let parentRef: HTMLDivElement | undefined;
  const height = () => props.height || 600;
  const variant = () => props.variant || "default";

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
  const getTrackNumber = (song: Song, index: number): string => {
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

  // create virtualizer instance
  const rowVirtualizer = createVirtualizer({
    get count() {
      return props.songs.length;
    },
    getScrollElement: () => parentRef,
    estimateSize: () => 48,
    overscan: 5,
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

  const handleRowClick = (song: Song, index: number) => {
    props.onSongClick?.(song, index);
  };

  const handleRowDoubleClick = (song: Song, index: number) => {
    props.onSongDoubleClick?.(song, index);
  };

  const handleFavoriteClick = (e: MouseEvent, song: Song) => {
    e.stopPropagation();
    props.onFavoriteToggle?.(song, !song.userIsFavorite);
  };

  const handleRatingClick = (e: MouseEvent, song: Song) => {
    e.stopPropagation();
    // cycle through 0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 0
    const currentRating = song.userRating || 0;
    const newRating = currentRating >= 5 ? 0 : currentRating + 1;
    props.onRatingChange?.(song, newRating);
  };

  // grid template based on visible columns
  const getGridTemplate = () => {
    const cols: string[] = [];

    if (showTrackNumber()) cols.push("60px"); // #
    cols.push("minmax(200px, 2fr)"); // title
    if (showArtist()) cols.push("minmax(150px, 1.5fr)"); // artist
    if (showAlbum()) cols.push("minmax(150px, 1.5fr)"); // album
    cols.push("80px"); // year
    cols.push("80px"); // duration
    if (showFavorites()) cols.push("50px"); // favorite
    if (showRating()) cols.push("70px"); // rating
    if (showTags()) cols.push("minmax(150px, 1fr)"); // tags

    return cols.join(" ");
  };

  return (
    <div
      ref={parentRef!}
      class={`overflow-auto bg-dark-900 ${props.class || ""}`}
      style={{ height: `${height()}px` }}
    >
      {/* sticky header row with grid layout */}
      <div
        class="sticky top-0 z-10 bg-dark-800 border-b border-dark-700 text-xs text-gray-400 font-medium uppercase tracking-wide"
        style={{
          display: "grid",
          "grid-template-columns": getGridTemplate(),
          "min-width": "fit-content",
        }}
      >
        <Show when={showTrackNumber()}>
          <button
            class="px-3 py-3 text-left hover:text-white hover:bg-dark-700 transition-colors"
            onClick={() => handleSort("track")}
          >
            # {getSortIcon("track")}
          </button>
        </Show>

        <button
          class="px-4 py-3 text-left hover:text-white hover:bg-dark-700 transition-colors"
          onClick={() => handleSort("title")}
        >
          title {getSortIcon("title")}
        </button>

        <Show when={showArtist()}>
          <button
            class="px-4 py-3 text-left hover:text-white hover:bg-dark-700 transition-colors"
            onClick={() => handleSort("artist")}
          >
            artist {getSortIcon("artist")}
          </button>
        </Show>

        <Show when={showAlbum()}>
          <button
            class="px-4 py-3 text-left hover:text-white hover:bg-dark-700 transition-colors"
            onClick={() => handleSort("album")}
          >
            album {getSortIcon("album")}
          </button>
        </Show>

        <button
          class="px-4 py-3 text-left hover:text-white hover:bg-dark-700 transition-colors"
          onClick={() => handleSort("year")}
        >
          year {getSortIcon("year")}
        </button>

        <button
          class="px-4 py-3 text-right hover:text-white hover:bg-dark-700 transition-colors"
          onClick={() => handleSort("duration")}
        >
          time {getSortIcon("duration")}
        </button>

        <Show when={showFavorites()}>
          <button
            class="px-3 py-3 text-center hover:text-white hover:bg-dark-700 transition-colors"
            onClick={() => handleSort("favorite")}
          >
            <svg
              class="w-3 h-3 inline-block"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          </button>
        </Show>

        <Show when={showRating()}>
          <button
            class="px-3 py-3 text-center hover:text-white hover:bg-dark-700 transition-colors"
            onClick={() => handleSort("rating")}
          >
            ★ {getSortIcon("rating")}
          </button>
        </Show>

        <Show when={showTags()}>
          <div class="px-4 py-3 text-left">tags</div>
        </Show>
      </div>

      {/* virtual list container */}
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
          "min-width": "fit-content",
        }}
      >
        <For each={rowVirtualizer.getVirtualItems()}>
          {(virtualRow) => {
            const song = props.songs[virtualRow.index];
            const isPlaying = props.playingSongId === song.id;
            const isSelected = props.selectedSongIds?.has(song.id);

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
                <div
                  class={`
                    h-full cursor-pointer
                    border-b border-dark-800
                    transition-colors
                    ${isPlaying ? "bg-magenta-900/20 text-magenta-400" : "text-white hover:bg-dark-800"}
                    ${isSelected ? "bg-dark-700" : ""}
                  `}
                  style={{
                    display: "grid",
                    "grid-template-columns": getGridTemplate(),
                    "align-items": "center",
                  }}
                  onClick={() => handleRowClick(song, virtualRow.index)}
                  onDblClick={() =>
                    handleRowDoubleClick(song, virtualRow.index)
                  }
                >
                  {/* track number */}
                  <Show when={showTrackNumber()}>
                    <div class="px-3 text-center text-gray-500 text-sm tabular-nums">
                      {getTrackNumber(song, virtualRow.index)}
                    </div>
                  </Show>

                  {/* title */}
                  <div class="px-4 min-w-0">
                    <div class="truncate font-medium">{song.title}</div>
                  </div>

                  {/* artist */}
                  <Show when={showArtist()}>
                    <div class="px-4 min-w-0">
                      <div class="truncate text-gray-400">{song.artist}</div>
                    </div>
                  </Show>

                  {/* album */}
                  <Show when={showAlbum()}>
                    <div class="px-4 min-w-0">
                      <div class="truncate text-gray-400">{song.album}</div>
                    </div>
                  </Show>

                  {/* year */}
                  <div class="px-4 text-left text-gray-500 text-sm tabular-nums">
                    {song.year || "—"}
                  </div>

                  {/* duration */}
                  <div class="px-4 text-right text-gray-500 text-sm tabular-nums">
                    {song.duration}
                  </div>

                  {/* favorite */}
                  <Show when={showFavorites()}>
                    <div class="px-3 flex justify-center">
                      <button
                        class={`w-4 h-4 transition-colors ${
                          song.userIsFavorite
                            ? "text-magenta-500"
                            : "text-gray-600 hover:text-gray-400"
                        }`}
                        onClick={(e) => handleFavoriteClick(e, song)}
                        title={
                          song.userIsFavorite
                            ? "remove from favorites"
                            : "add to favorites"
                        }
                      >
                        <svg
                          class="w-full h-full"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                        </svg>
                      </button>
                    </div>
                  </Show>

                  {/* rating */}
                  <Show when={showRating()}>
                    <div class="px-3 flex justify-center">
                      <button
                        class={`text-sm transition-colors ${
                          song.userRating
                            ? "text-magenta-400"
                            : "text-gray-600 hover:text-gray-400"
                        }`}
                        onClick={(e) => handleRatingClick(e, song)}
                        title={`rating: ${song.userRating || 0}/5 (click to cycle)`}
                      >
                        {song.userRating ? `★${song.userRating}` : "☆"}
                      </button>
                    </div>
                  </Show>

                  {/* tags */}
                  <Show when={showTags()}>
                    <div class="px-4 min-w-0">
                      <div class="truncate text-xs text-gray-600">
                        {song.tags?.join(", ") || ""}
                      </div>
                    </div>
                  </Show>
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}

export default VirtualSongList;
