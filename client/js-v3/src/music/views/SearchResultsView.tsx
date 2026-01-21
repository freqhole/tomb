// search results view - displays search results with virtualized infinite scrolling
import { useNavigate, useSearchParams } from "@solidjs/router";
import { createVirtualizer } from "@tanstack/solid-virtual";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";

import { Icon } from "../../components/icons/registry";
import { MediaThumbnail } from "../../components/media/MediaThumbnail";
import { HighlightedMarqueeText } from "../../components/text/HighlightedMarqueeText";
import { getCurrentRemote, getDataSource } from "../data";
import type {
  SearchAlbumResult,
  SearchArtistResult,
  SearchGenreResult,
  SearchPlaylistResult,
  SearchSongResult,
} from "../data/types";
import { useSearchQuery } from "../queries/search";
import { playQueue } from "../services/audio/player";
import { formatDuration } from "../utils/format";
import { getBlobImageUrl, getPrimaryImageUrl } from "../utils/images";
import { routes } from "../utils/routing";

export function SearchResultsView() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [scrollParent, setScrollParent] = createSignal<HTMLElement | null>(
    null,
  );

  // get query from URL params
  const query = createMemo(() => {
    const q = searchParams.q;
    return Array.isArray(q) ? q[0] || "" : q || "";
  });
  const field = createMemo(() => {
    const f = searchParams.field;
    if (
      f === "all" ||
      f === "songs" ||
      f === "artists" ||
      f === "albums" ||
      f === "genres" ||
      f === "playlists"
    ) {
      return f;
    }
    return "all";
  });

  // search query
  const searchQuery = useSearchQuery({
    query,
    field: () => (field() === "all" ? null : field()),
    pageSize: 50,
    enabled: () => query().length >= 2,
  });

  // flatten all results into a single array for virtualization
  const allResults = createMemo(() => {
    const pages = searchQuery.data?.pages || [];
    const results: Array<{
      type: "song" | "artist" | "album" | "genre" | "playlist";
      data:
        | SearchSongResult
        | SearchArtistResult
        | SearchAlbumResult
        | SearchGenreResult
        | SearchPlaylistResult;
    }> = [];

    pages.forEach((page) => {
      // songs always present
      page.songs.forEach((song) => {
        results.push({ type: "song", data: song });
      });

      // other categories only on first page
      if (page.page === 1) {
        page.artists?.forEach((artist) => {
          results.push({ type: "artist", data: artist });
        });
        page.albums?.forEach((album) => {
          results.push({ type: "album", data: album });
        });
        page.genres?.forEach((genre) => {
          results.push({ type: "genre", data: genre });
        });
        page.playlists?.forEach((playlist) => {
          results.push({ type: "playlist", data: playlist });
        });
      }
    });

    return results;
  });

  // virtualizer for results
  const virtualizer = createMemo(() => {
    const parent = scrollParent();
    if (!parent) return null;

    return createVirtualizer({
      count: allResults().length,
      getScrollElement: () => parent,
      estimateSize: () => 64,
      overscan: 10,
    });
  });

  // infinite scroll - fetch more when near bottom
  createEffect(() => {
    const virt = virtualizer();
    if (!virt) return;

    const items = virt.getVirtualItems();
    if (items.length === 0) return;

    const lastItem = items[items.length - 1];
    if (!lastItem) return;

    // if we're within 5 items of the end, fetch more
    if (
      lastItem.index >= allResults().length - 5 &&
      searchQuery.hasNextPage &&
      !searchQuery.isFetchingNextPage
    ) {
      searchQuery.fetchNextPage();
    }
  });

  // handle play song - plays immediately
  const handlePlaySong = async (song: SearchSongResult) => {
    // fetch full song data from the data source
    try {
      const dataSource = getDataSource();
      const fullSong = await dataSource.getSongById(song.id);

      if (!fullSong) {
        console.error("song not found:", song.id);
        return;
      }

      // play the song with full data
      await playQueue([fullSong]);
    } catch (error) {
      console.error("failed to play song:", error);
    }
  };

  // handle navigate to song's album
  const handleNavigateToSongAlbum = (albumId: string | null | undefined) => {
    if (!albumId) return;
    navigate(routes.album(albumId));
  };

  // handle navigate to detail
  const handleNavigateToArtist = (artistId: string) => {
    navigate(routes.artist(artistId));
  };

  const handleNavigateToAlbum = (albumId: string) => {
    navigate(routes.album(albumId));
  };

  const handleNavigateToGenre = (genreId: string) => {
    navigate(routes.genre(genreId));
  };

  const handleNavigateToPlaylist = (playlistId: string) => {
    navigate(routes.playlist(playlistId));
  };

  // render different result types
  const renderResult = (item: ReturnType<typeof allResults>[number]) => {
    const remote = getCurrentRemote();
    const baseUrl = remote?.base_url || "";

    switch (item.type) {
      case "song": {
        const song = item.data as SearchSongResult;
        const [isHovering, setIsHovering] = createSignal(false);
        return (
          <div
            class="
              flex items-center gap-3 px-4 py-2
              hover:bg-[var(--color-bg-hover)]
              cursor-pointer
              border-b border-[var(--color-border-default)]
            "
            onClick={() => handleNavigateToSongAlbum(song.album_id)}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
          >
            <MediaThumbnail
              thumbnailUrl={
                song.thumbnail_url ? `${baseUrl}${song.thumbnail_url}` : null
              }
              size={48}
              enablePlayClick={true}
              onPlayClick={() => handlePlaySong(song)}
            />
            <div class="flex-1 min-w-0">
              <HighlightedMarqueeText
                text={song.title}
                highlight={song.highlight}
                isHovering={isHovering()}
                class="body-sm text-[var(--color-text-primary)]"
              />
              <div class="caption text-[var(--color-text-secondary)] truncate">
                {song.artist_names.join(", ")} • {song.album_title || "unknown"}
              </div>
            </div>
            <div class="caption text-[var(--color-text-tertiary)] mr-2">
              {song.duration ? formatDuration(song.duration) : ""}
            </div>
            <div class="px-2 py-1 rounded bg-[var(--color-accent-500)]/10 text-[var(--color-accent-500)] text-xs font-medium">
              song
            </div>
          </div>
        );
      }

      case "artist": {
        const artist = item.data as SearchArtistResult;
        const [isHovering, setIsHovering] = createSignal(false);
        return (
          <div
            class="
              flex items-center gap-3 px-4 py-3
              hover:bg-[var(--color-bg-hover)]
              cursor-pointer
              border-b border-[var(--color-border-default)]
            "
            onClick={() => handleNavigateToArtist(artist.id)}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
          >
            <div class="w-12 h-12 rounded-full bg-[var(--color-bg-tertiary)] overflow-hidden flex items-center justify-center">
              <Icon name="user" size={24} color="var(--color-text-tertiary)" />
            </div>
            <div class="flex-1 min-w-0">
              <HighlightedMarqueeText
                text={artist.name}
                highlight={artist.highlight}
                isHovering={isHovering()}
                class="body-sm font-medium text-[var(--color-text-primary)]"
              />
              <div class="caption text-[var(--color-text-secondary)]">
                {artist.album_count} albums • {artist.song_count} songs
              </div>
            </div>
            <div class="px-2 py-1 rounded bg-[var(--color-accent-500)]/10 text-[var(--color-accent-500)] text-xs font-medium">
              artist
            </div>
          </div>
        );
      }

      case "album": {
        const album = item.data as SearchAlbumResult;
        const [isHovering, setIsHovering] = createSignal(false);
        return (
          <div
            class="
              flex items-center gap-3 px-4 py-3
              hover:bg-[var(--color-bg-hover)]
              cursor-pointer
              border-b border-[var(--color-border-default)]
            "
            onClick={() => handleNavigateToAlbum(album.id)}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
          >
            <MediaThumbnail
              thumbnailUrl={
                album.thumbnail_url ? `${baseUrl}${album.thumbnail_url}` : null
              }
              size={48}
              enablePlayClick={false}
            />
            <div class="flex-1 min-w-0">
              <HighlightedMarqueeText
                text={album.title}
                highlight={album.highlight}
                isHovering={isHovering()}
                class="body-sm font-medium text-[var(--color-text-primary)]"
              />
              <div class="caption text-[var(--color-text-secondary)] truncate">
                {album.artist_names.join(", ")} • {album.song_count} songs
              </div>
            </div>
            <div class="px-2 py-1 rounded bg-[var(--color-accent-500)]/10 text-[var(--color-accent-500)] text-xs font-medium">
              album
            </div>
          </div>
        );
      }

      case "genre": {
        const genre = item.data as SearchGenreResult;
        const [isHovering, setIsHovering] = createSignal(false);
        return (
          <div
            class="
              flex items-center gap-3 px-4 py-3
              hover:bg-[var(--color-bg-hover)]
              cursor-pointer
              border-b border-[var(--color-border-default)]
            "
            onClick={() => handleNavigateToGenre(genre.genre_id)}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
          >
            <div class="flex items-center justify-center w-12 h-12 rounded bg-[var(--color-bg-tertiary)]">
              <Icon name="music" size={24} color="var(--color-text-tertiary)" />
            </div>
            <div class="flex-1 min-w-0">
              <HighlightedMarqueeText
                text={genre.genre}
                isHovering={isHovering()}
                class="body-sm font-medium text-[var(--color-text-primary)]"
              />
              <div class="caption text-[var(--color-text-secondary)]">
                {genre.artist_count} artists • {genre.song_count} songs
              </div>
            </div>
            <div class="px-2 py-1 rounded bg-[var(--color-accent-500)]/10 text-[var(--color-accent-500)] text-xs font-medium">
              genre
            </div>
          </div>
        );
      }

      case "playlist": {
        const playlist = item.data as SearchPlaylistResult;
        const [isHovering, setIsHovering] = createSignal(false);
        return (
          <div
            class="
              flex items-center gap-3 px-4 py-3
              hover:bg-[var(--color-bg-hover)]
              cursor-pointer
              border-b border-[var(--color-border-default)]
            "
            onClick={() => handleNavigateToPlaylist(playlist.id)}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
          >
            <MediaThumbnail
              thumbnailUrl={
                playlist.thumbnail_url
                  ? `${baseUrl}${playlist.thumbnail_url}`
                  : null
              }
              size={48}
              enablePlayClick={false}
            />
            <div class="flex-1 min-w-0">
              <HighlightedMarqueeText
                text={playlist.title}
                highlight={playlist.highlight}
                isHovering={isHovering()}
                class="body-sm font-medium text-[var(--color-text-primary)]"
              />
              <div class="caption text-[var(--color-text-secondary)] truncate">
                {playlist.song_count} songs
                {playlist.description && ` • ${playlist.description}`}
              </div>
            </div>
            <div class="px-2 py-1 rounded bg-[var(--color-accent-500)]/10 text-[var(--color-accent-500)] text-xs font-medium">
              playlist
            </div>
          </div>
        );
      }
    }
  };

  // get total count
  const totalCount = createMemo(() => {
    const pages = searchQuery.data?.pages || [];
    if (pages.length === 0) return 0;
    return pages[0].total_count;
  });

  return (
    <div class="h-full flex flex-col bg-[var(--color-bg-primary)]">
      {/* header */}
      <div class="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border-default)]">
        <div>
          <h1 class="heading-lg text-[var(--color-text-primary)]">
            search results
          </h1>
          <Show when={query().length >= 2}>
            <p class="body-sm text-[var(--color-text-secondary)] mt-1">
              {totalCount()} results for "{query()}"
            </p>
          </Show>
        </div>
      </div>

      {/* results */}
      <div
        ref={setScrollParent}
        class="flex-1 overflow-y-auto"
        style={{ "will-change": "transform" }}
      >
        <Show
          when={!searchQuery.isLoading}
          fallback={
            <div class="flex items-center justify-center h-full">
              <div class="flex flex-col items-center gap-3">
                <div class="animate-spin">
                  <Icon
                    name="loader"
                    size={32}
                    color="var(--color-accent-500)"
                  />
                </div>
                <p class="body-sm text-[var(--color-text-secondary)]">
                  searching...
                </p>
              </div>
            </div>
          }
        >
          <Show
            when={allResults().length > 0}
            fallback={
              <div class="flex items-center justify-center h-full">
                <div class="text-center max-w-md">
                  <div class="mb-4 flex justify-center">
                    <Icon
                      name="search"
                      size={48}
                      color="var(--color-text-tertiary)"
                    />
                  </div>
                  <h2 class="heading-md text-[var(--color-text-primary)] mb-2">
                    no results found
                  </h2>
                  <p class="body-sm text-[var(--color-text-secondary)]">
                    {query().length < 2
                      ? "type at least 2 characters to search"
                      : `no results found for "${query()}"`}
                  </p>
                </div>
              </div>
            }
          >
            <div
              style={{
                height: `${virtualizer()?.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              <For each={virtualizer()?.getVirtualItems()}>
                {(virtualItem) => {
                  const result = allResults()[virtualItem.index];
                  return (
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                      data-index={virtualItem.index}
                    >
                      {renderResult(result)}
                    </div>
                  );
                }}
              </For>
            </div>

            {/* loading more indicator */}
            <Show when={searchQuery.isFetchingNextPage}>
              <div class="flex items-center justify-center py-4">
                <div class="animate-spin">
                  <Icon
                    name="loader"
                    size={24}
                    color="var(--color-accent-500)"
                  />
                </div>
              </div>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
}
