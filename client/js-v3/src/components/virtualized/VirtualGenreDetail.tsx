// virtualized genre detail component - displays albums grouped by artist with virtualized scrolling
import { createVirtualizer } from "@tanstack/solid-virtual";
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import { CollectionCard } from "../cards/CollectionCard";
import { formatLongDuration } from "../../utils/formatDuration";
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
  /** callback when artist name is clicked */
  onArtistClick?: (artistId: string) => void;
  /** callback to get context menu actions for an album */
  getAlbumContextMenuActions?: (albumId: string) => MenuAction[];
  /** number of columns in grid */
  gridColumns?: number;
  /** scroll container element ref - if not provided, component manages its own scroll */
  scrollContainerRef?: HTMLElement | null;
  /** additional css classes */
  class?: string;
}

export function VirtualGenreDetail(props: VirtualGenreDetailProps): JSX.Element {
  let scrollElementRef: HTMLDivElement | undefined;
  const [savedScrollOffset, setSavedScrollOffset] = createSignal(0);
  const [isNarrow, setIsNarrow] = createSignal(window.innerWidth < NARROW_BREAKPOINT);

  const gridColumns = () => (isNarrow() ? 2 : (props.gridColumns ?? 5));

  // get the scroll element - prefer explicit prop, fall back to walking up DOM
  const getScrollElement = () => {
    if (props.scrollContainerRef) {
      return props.scrollContainerRef;
    }
    // fallback to parent chain (fragile, but maintains backward compatibility)
    return scrollElementRef?.parentElement?.parentElement || null;
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
        });
      }

      const album = albumsMap.get(song.album_id)!;
      album.songCount += 1;
      album.totalDuration += song.duration_seconds;
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

  // recreate virtualizer when data or column count changes
  // NOTE: do NOT track containerHeight here - the virtualizer handles container resizing internally
  // tracking it caused an infinite loop: height change -> virtualizer recreate -> layout change -> height change
  const virtualizer = createMemo((prev) => {
    const scrollElement = getScrollElement();

    // track dependencies - must read all reactive values here
    const count = artistGroups().length;
    const cols = gridColumns();

    // save scroll position before recreating
    if (prev && scrollElement) {
      setSavedScrollOffset(scrollElement.scrollTop);
    }

    const newVirtualizer = createVirtualizer({
      count: count,
      getScrollElement: () => getScrollElement(),
      estimateSize: (index) => {
        const groups = artistGroups();
        const artist = groups[index];
        if (!artist) return 0;
        // header: 60px, albums in grid: 280px per row
        const albumRows = Math.ceil(artist.albums.length / cols);
        return 60 + albumRows * 280 + 32; // header + album rows + spacing
      },
      overscan: 2,
    });

    // restore scroll after recreation
    const savedOffset = savedScrollOffset();
    if (savedOffset > 0) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = getScrollElement();
          if (el) {
            el.scrollTop = savedOffset;
          }
        });
      });
    }

    return newVirtualizer;
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
    <div ref={scrollElementRef!} class={props.class || ""}>
      <div
        style={{
          height: `${virtualizer().getTotalSize()}px`,
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
          <For each={virtualizer().getVirtualItems()}>
            {(virtualRow) => {
              const artist = artistGroups()[virtualRow.index];

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
                        onClick={() => props.onArtistClick?.(artist.artistId)}
                        class="min-w-0 overflow-hidden text-lg md:text-xl font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-accent-500)] transition-colors text-left"
                      >
                        <MarqueeText text={artist.artistName} hoverOnly={true} />
                      </button>
                      <span class="text-xs md:text-sm text-[var(--color-text-tertiary)] shrink-0">
                        {artist.albums.length} {artist.albums.length === 1 ? "album" : "albums"}
                      </span>
                    </div>

                    {/* albums grid */}
                    <div
                      class="grid gap-4"
                      style={{
                        "grid-template-columns": `repeat(${gridColumns()}, minmax(0, 1fr))`,
                      }}
                    >
                      <For each={artist.albums}>
                        {(album) => {
                          const contextMenuActions = props.getAlbumContextMenuActions?.(
                            album.albumId
                          );

                          const card = (
                            <CollectionCard
                              collection={{
                                id: album.albumId,
                                title: album.albumTitle,
                                subtitle: `${album.songCount} songs`,
                                domainType: "album",
                                year: album.year,
                                trackCount: album.songCount,
                                totalDuration: formatLongDuration(album.totalDuration),
                                images: album.images,
                              }}
                              showYear={true}
                              showDuration={true}
                              onClick={() => props.onAlbumClick?.(album.albumId)}
                              onPlay={() => props.onPlayAlbum?.(album.albumId)}
                            />
                          );

                          return contextMenuActions && contextMenuActions.length > 0 ? (
                            <ContextMenu actions={contextMenuActions}>{card}</ContextMenu>
                          ) : (
                            card
                          );
                        }}
                      </For>
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
