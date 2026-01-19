// virtualized genre detail component - displays albums grouped by artist with virtualized scrolling
import { createVirtualizer } from "@tanstack/solid-virtual";
import { createMemo, For, Show, type JSX } from "solid-js";
import { CollectionCard } from "../cards/CollectionCard";
import { formatDuration } from "../cards/StatsCard";
import { MarqueeText } from "../text/MarqueeText";

export interface VirtualGenreDetailSong {
  sha256: string;
  title: string;
  artist_id: string;
  artist_name: string;
  album_id: string;
  album_title: string;
  duration_seconds: number;
  year: number | null;
}

interface AlbumGroup {
  albumId: string;
  albumTitle: string;
  artistId: string;
  artistName: string;
  year: number | null;
  songCount: number;
  totalDuration: number;
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
  /** height of the scrollable area */
  height?: number;
  /** number of columns in grid */
  gridColumns?: number;
  /** additional css classes */
  class?: string;
}

export function VirtualGenreDetail(
  props: VirtualGenreDetailProps,
): JSX.Element {
  let scrollElementRef: HTMLDivElement | undefined;

  const gridColumns = () => props.gridColumns ?? 5;
  const height = () => props.height ?? 600;

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
      a.artistName.localeCompare(b.artistName),
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

  // create virtualizer (one row per artist section)
  const virtualizer = createVirtualizer({
    get count() {
      return artistGroups().length;
    },
    getScrollElement: () => scrollElementRef,
    estimateSize: (index) => {
      const artist = artistGroups()[index];
      // header: 60px, albums in grid: 280px per row
      const albumRows = Math.ceil(artist.albums.length / gridColumns());
      return 60 + albumRows * 280 + 32; // header + album rows + spacing
    },
    overscan: 2,
  });

  return (
    <div class={`flex flex-col ${props.class || ""}`} style={{ height: `${height()}px` }}>
      <div
        ref={scrollElementRef}
        class="flex-1 overflow-y-auto"
        style={{ "overflow-anchor": "none" }}
      >
        <Show
          when={artistGroups().length > 0}
          fallback={
            <div class="flex items-center justify-center h-full">
              <p class="text-[var(--color-text-tertiary)] text-sm">
                no albums found
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
            <For each={virtualizer.getVirtualItems()}>
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
                    <div class="px-6 py-4">
                      {/* artist header */}
                      <div class="flex items-center gap-3 mb-4">
                        <button
                          onClick={() => props.onArtistClick?.(artist.artistId)}
                          class="text-xl font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-accent-500)] transition-colors"
                        >
                          <MarqueeText
                            text={artist.artistName}
                            hoverOnly={true}
                          />
                        </button>
                        <span class="text-sm text-[var(--color-text-tertiary)]">
                          {artist.albums.length}{" "}
                          {artist.albums.length === 1 ? "album" : "albums"}
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
                          {(album) => (
                            <CollectionCard
                              collection={{
                                id: album.albumId,
                                title: album.albumTitle,
                                subtitle: `${album.songCount} songs`,
                                domainType: "album",
                                year: album.year,
                                trackCount: album.songCount,
                                totalDuration: formatDuration(
                                  album.totalDuration,
                                ),
                              }}
                              showYear={true}
                              showDuration={true}
                              onClick={() => props.onAlbumClick?.(album.albumId)}
                              onPlay={() => props.onPlayAlbum?.(album.albumId)}
                            />
                          )}
                        </For>
                      </div>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
