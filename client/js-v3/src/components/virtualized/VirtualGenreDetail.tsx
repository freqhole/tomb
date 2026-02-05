// virtualized genre detail component - displays albums grouped by artist with virtualized scrolling
import { createVirtualizer } from "@tanstack/solid-virtual";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import { CollectionCard } from "../cards/CollectionCard";
import { formatLongDuration } from "../../utils/formatDuration";
import { useScrollRestore } from "../../utils/scrollRestore";
import { ContextMenu, type MenuAction } from "../overlays/ContextMenu";
import { MarqueeText } from "../text/MarqueeText";

const NARROW_BREAKPOINT = 768;

export interface VirtualGenreDetailSong {
  sha256: string;
  title: string;
  artist_id: string;
  artist_name: string;
  album_id: string;
  album_title: string;
  duration_seconds: number;
  year: number | null;
  images?: import("../../music/services/storage/types").ImageMetadata[];
  album_images?: import("../../music/services/storage/types").ImageMetadata[];
  album_is_favorite?: boolean;
}

interface AlbumGroup {
  albumId: string;
  albumTitle: string;
  artistId: string;
  artistName: string;
  year: number | null;
  songCount: number;
  totalDuration: number;
  images?: import("../../music/services/storage/types").ImageMetadata[];
  isFavorite?: boolean;
}

interface ArtistGroup {
  artistId: string;
  artistName: string;
  albums: AlbumGroup[];
}

export interface VirtualGenreDetailProps {
  /** all songs in the genre */
  songs: VirtualGenreDetailSong[];
  /** callback when album is clicked */
  onAlbumClick?: (albumId: string) => void;
  /** callback when album play button is clicked */
  onPlayAlbum?: (albumId: string) => void;
  /** callback when album favorite is toggled */
  onAlbumFavoriteToggle?: (albumId: string, isFavorite: boolean) => void;
  /** callback when artist name is clicked */
  onArtistClick?: (artistId: string) => void;
  /** callback to get context menu actions for an album */
  getAlbumContextMenuActions?: (albumId: string) => MenuAction[];
  /** number of columns in grid */
  gridColumns?: number;
  /** height of the container - required for virtualization */
  height: number;
  /** optional header content that scrolls with the list (e.g., stats cards on mobile) */
  header?: JSX.Element;
  /** unique key for scroll restoration (e.g., 'genre-detail-rock') */
  scrollRestoreKey?: string;
  /** additional css classes */
  class?: string;
}

export function VirtualGenreDetail(props: VirtualGenreDetailProps): JSX.Element {
  // component OWNS its scroll container - this is the key pattern from working virtualizers
  let parentRef: HTMLDivElement | undefined;
  const [isNarrow, setIsNarrow] = createSignal(window.innerWidth < NARROW_BREAKPOINT);
  const [containerWidth, setContainerWidth] = createSignal(0);
  const gap = 16;

  // scroll restoration using browser history state
  const { restoreScroll, saveScroll } = useScrollRestore(props.scrollRestoreKey || "genre-detail");

  const gridColumns = () => (isNarrow() ? 2 : (props.gridColumns ?? 5));

  // calculate card height dynamically based on container width
  const getCardHeight = () => {
    const width = containerWidth();
    if (width === 0) {
      // initial estimate before measurement
      return 280;
    }
    const cols = gridColumns();
    const effectiveWidth = width - gap * 2; // padding on sides
    const columnWidth = (effectiveWidth - gap * (cols - 1)) / cols;
    const textHeight = 100; // space for title, subtitle, metadata
    return columnWidth + textHeight;
  };

  // group albums by artist
  const artistGroups = createMemo((): ArtistGroup[] => {
    const albumsMap = new Map<string, AlbumGroup>();
    const artistsMap = new Map<string, ArtistGroup>();

    // first, group songs by album
    props.songs.forEach((song) => {
      if (!albumsMap.has(song.album_id)) {
        albumsMap.set(song.album_id, {
          albumId: song.album_id,
          albumTitle: song.album_title,
          artistId: song.artist_id,
          artistName: song.artist_name,
          year: song.year,
          songCount: 0,
          totalDuration: 0,
          images: song.album_images, // use album images, not song images
          isFavorite: song.album_is_favorite,
        });
      }

      const album = albumsMap.get(song.album_id)!;
      album.songCount += 1;
      album.totalDuration += song.duration_seconds;
      // update isFavorite if any song has it set (they should all be consistent)
      if (song.album_is_favorite !== undefined) {
        album.isFavorite = song.album_is_favorite;
      }
    });

    // then, group albums by artist
    Array.from(albumsMap.values()).forEach((album) => {
      if (!artistsMap.has(album.artistId)) {
        artistsMap.set(album.artistId, {
          artistId: album.artistId,
          artistName: album.artistName,
          albums: [],
        });
      }

      artistsMap.get(album.artistId)!.albums.push(album);
    });

    // sort artists by name
    const sortedArtists = Array.from(artistsMap.values()).sort((a, b) =>
      a.artistName.localeCompare(b.artistName)
    );

    // sort albums within each artist by year (newest first), then by title
    sortedArtists.forEach((artist) => {
      artist.albums.sort((a, b) => {
        if (a.year && b.year && a.year !== b.year) {
          return b.year - a.year; // newest first
        }
        return a.albumTitle.localeCompare(b.albumTitle);
      });
    });

    return sortedArtists;
  });

  // reactive count for virtualizer
  const groupCount = createMemo(() => artistGroups().length);

  // estimate row size - needs access to current groups and columns
  // 60px for artist header, cardHeight for each album row, 32px for padding
  const estimateRowSize = (index: number) => {
    const artist = artistGroups()[index];
    if (!artist) return 0;
    const albumRows = Math.ceil(artist.albums.length / gridColumns());
    return 60 + albumRows * (getCardHeight() + gap) + 32;
  };

  // single stable virtualizer with reactive count
  // getScrollElement returns parentRef directly - component owns its scroll container
  const rowVirtualizer = createVirtualizer({
    get count() {
      return groupCount();
    },
    getScrollElement: () => parentRef ?? null,
    estimateSize: estimateRowSize,
    overscan: 2,
  });

  // measure container width and remeasure virtualizer
  onMount(() => {
    if (!parentRef) return;

    // set initial width
    setContainerWidth(parentRef.clientWidth);

    // restore scroll position from history state (use double RAF to ensure virtualizer is ready)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (parentRef) {
          restoreScroll(parentRef);
        }
      });
    });

    // observe for size changes
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && width > 0) {
        setContainerWidth(width);
      }
    });

    observer.observe(parentRef);

    // save scroll position while scrolling
    const handleScroll = () => {
      if (parentRef) {
        saveScroll(parentRef);
      }
    };
    parentRef.addEventListener("scroll", handleScroll, { passive: true });

    onCleanup(() => {
      observer.disconnect();
      parentRef?.removeEventListener("scroll", handleScroll);
    });
  });

  // remeasure virtualizer when columns or container width changes
  createEffect(() => {
    gridColumns(); // track
    containerWidth(); // track
    rowVirtualizer.measure();
  });

  // listen for window resize to update narrow state
  onMount(() => {
    const handleResize = () => {
      const nowNarrow = window.innerWidth < NARROW_BREAKPOINT;
      if (isNarrow() !== nowNarrow) {
        setIsNarrow(nowNarrow);
      }
    };
    window.addEventListener("resize", handleResize);

    onCleanup(() => {
      window.removeEventListener("resize", handleResize);
    });
  });

  return (
    <div
      ref={parentRef!}
      class={`overflow-auto ${props.class || ""}`}
      style={{ height: `${props.height}px` }}
    >
      {/* optional header that scrolls with content (e.g., stats on mobile) */}
      {props.header}
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        <Show
          when={artistGroups().length > 0}
          fallback={
            <div class="flex items-center justify-center h-full">
              <p class="text-[var(--color-text-tertiary)] text-sm">no albums found</p>
            </div>
          }
        >
          <For each={rowVirtualizer.getVirtualItems()}>
            {(virtualRow) => {
              const artist = () => artistGroups()[virtualRow.index];

              return (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div class="px-4 md:px-6 py-4">
                    {/* artist header */}
                    <div class="flex flex-col md:flex-row md:items-center gap-1 md:gap-3 mb-4">
                      <button
                        onClick={() => props.onArtistClick?.(artist().artistId)}
                        class="min-w-0 overflow-hidden text-lg md:text-xl font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-accent-500)] transition-colors text-left"
                      >
                        <MarqueeText text={artist().artistName} hoverOnly={true} />
                      </button>
                      <span class="text-xs md:text-sm text-[var(--color-text-tertiary)] shrink-0">
                        {artist().albums.length} {artist().albums.length === 1 ? "album" : "albums"}
                      </span>
                    </div>

                    {/* albums grid */}
                    <div
                      class="grid gap-4"
                      style={{
                        "grid-template-columns": `repeat(${gridColumns()}, minmax(0, 1fr))`,
                      }}
                    >
                      <Index each={artist().albums}>
                        {(albumAccessor) => {
                          const album = () => albumAccessor();
                          const contextMenuActions = () =>
                            props.getAlbumContextMenuActions?.(album().albumId);

                          const card = () => (
                            <CollectionCard
                              collection={{
                                id: album().albumId,
                                title: album().albumTitle,
                                subtitle: album().artistName,
                                domainType: "album",
                                year: album().year,
                                trackCount: album().songCount,
                                totalDuration: formatLongDuration(album().totalDuration),
                                images: album().images,
                                isFavorite: album().isFavorite,
                              }}
                              showYear={true}
                              showDuration={true}
                              onClick={() => props.onAlbumClick?.(album().albumId)}
                              onPlay={() => props.onPlayAlbum?.(album().albumId)}
                              onFavoriteToggle={(_, isFavorite) =>
                                props.onAlbumFavoriteToggle?.(album().albumId, isFavorite)
                              }
                            />
                          );

                          const actions = contextMenuActions();
                          return actions && actions.length > 0 ? (
                            <ContextMenu actions={actions}>{card()}</ContextMenu>
                          ) : (
                            card()
                          );
                        }}
                      </Index>
                    </div>
                  </div>
                </div>
              );
            }}
          </For>
        </Show>
      </div>
    </div>
  );
}
