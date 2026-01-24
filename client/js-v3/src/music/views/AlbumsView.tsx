// albums view - displays all albums in a grid
import { useNavigate, useSearchParams } from "@solidjs/router";
import { createEffect, createMemo, createSignal, on, Show } from "solid-js";
import { setQueue } from "../../app/services/storage/db";
import { Button } from "../../components/buttons/Button";
import type { CollectionCardData } from "../../components/cards/CollectionCard";
import {
  TagFilterPicker,
  type TagFilter,
} from "../../components/forms/TagFilterPicker";
import { VirtualAlbumGrid } from "../../components/virtualized/VirtualAlbumGrid";
import { getDataSource } from "../data";
import { useAlbumsQuery } from "../queries/songs";
import { useTagsQuery } from "../queries/tags";
import { playSong } from "../services/audio/player";
import { useAlbumContextMenu } from "../services/contextMenu";
import { getPrimaryImageUrl } from "../utils/images";
import { buildRoute } from "../utils/routing";
import { sortSongsCanonical } from "../utils/songSort";

export interface AlbumsViewProps {
  onAddMusic: () => void;
  onAlbumClick?: (albumId: string) => void;
}

export function AlbumsView(props: AlbumsViewProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // track query changes to force grid reset
  const [isResetting, setIsResetting] = createSignal(false);

  // tag filtering state
  const [tagFilters, setTagFilters] = createSignal<TagFilter[]>([]);

  // fetch available tags
  const tagsQuery = useTagsQuery();

  // fetch albums using query hook
  const albumsQuery = useAlbumsQuery({
    pageSize: 100,
    query: () => {
      const q = searchParams.q;
      return Array.isArray(q) ? q[0] : q;
    },
    tagFilters: () => tagFilters(),
  });

  // reset virtual grid when query param or tag filters change
  createEffect(() => {
    const q = searchParams.q;
    const queryParam = Array.isArray(q) ? q[0] : q;
    const filters = tagFilters();
    // briefly show resetting state to force grid to remount
    setIsResetting(true);
    setTimeout(() => setIsResetting(false), 0);
  });

  // auto-fetch next page when query becomes idle and has more data
  createEffect(
    on(
      () => ({
        hasNextPage: albumsQuery.hasNextPage,
        isFetchingNextPage: albumsQuery.isFetchingNextPage,
        isFetching: albumsQuery.isFetching,
      }),
      (state) => {
        // automatically load more if there's more data and we're not already fetching
        if (
          state.hasNextPage &&
          !state.isFetchingNextPage &&
          !state.isFetching
        ) {
          albumsQuery.fetchNextPage();
        }
      },
    ),
  );

  // format duration as mm:ss or hh:mm:ss
  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  };

  // flatten all pages into albums list
  const albums = (): CollectionCardData[] => {
    const pages = albumsQuery.data?.pages ?? [];
    const allAlbums = pages.flatMap((page) => page.items);

    // map AlbumSummary to CollectionCardData format
    return allAlbums.map((album) => {
      // format genres: "genre • sub_genre1 • sub_genre2"
      const genreText = [
        album.genre,
        ...(album.sub_genres || []),
      ].filter(Boolean).join(" • ") || null;

      return {
        id: album.album_id,
        title: album.title,
        subtitle: album.artist_name,
        domainType: "album" as const,
        artist: album.artist_name,
        year: album.year,
        trackCount: album.song_count,
        totalDuration: formatDuration(album.total_duration),
        imageUrl: getPrimaryImageUrl(album.images),
        isFavorite: album.is_favorite ?? false,
        genres: genreText,
        tags: album.tags,
      };
    });
  };

  // tag filter handlers
  const handleAddTag = (tag: string) => {
    setTagFilters([...tagFilters(), { tag, mode: "include" }]);
  };

  const handleRemoveTag = (tag: string) => {
    setTagFilters(tagFilters().filter((f) => f.tag !== tag));
  };

  const handleToggleMode = (tag: string) => {
    setTagFilters(
      tagFilters().map((f) =>
        f.tag === tag
          ? {
              tag: f.tag,
              mode: (f.mode === "include" ? "exclude" : "include") as
                | "include"
                | "exclude",
            }
          : f,
      ),
    );
  };

  const handleClearAllTags = () => {
    setTagFilters([]);
  };

  // convert tags to tag options for picker
  const availableTags = createMemo(() => {
    return (tagsQuery.data || []).map((tag) => ({
      value: tag.name,
      label: tag.name,
    }));
  });

  // play album: load all songs and start playing
  const handleAlbumPlay = async (album: CollectionCardData) => {
    try {
      const dataSource = getDataSource();
      if (!dataSource.getAlbumSongs) {
        console.error("album songs not supported by current data source");
        return;
      }

      // load all songs for this album
      const response = await dataSource.getAlbumSongs(album.id, {
        limit: 1000,
      });
      const songs = response.items;

      if (songs.length === 0) return;

      // sort canonically (disc -> track)
      const sortedSongs = sortSongsCanonical(songs);

      // set queue and play first song
      await setQueue(sortedSongs);
      await playSong(sortedSongs[0]);
    } catch (error) {
      console.error("failed to play album:", error);
    }
  };

  const handleAlbumClick = (album: CollectionCardData) => {
    navigate(buildRoute(`/albums/${album.id}`));
  };

  // build context menu actions for each album
  const getContextMenuActions = (album: CollectionCardData) => {
    return useAlbumContextMenu(
      {
        id: album.id,
        title: album.title,
        artist_name: album.artist,
        song_count: album.trackCount,
      },
      {
        showPlayActions: true,
        isFavorite: album.isFavorite ?? false,
      },
    );
  };

  return (
    <div class="flex flex-col h-full">
      {/* header */}
      <div class="flex items-center justify-between p-4 ml-[150px]">
        <div>
          <h1 class="text-2xl font-bold text-[var(--color-text-primary)]">
            albums
          </h1>
          <p class="text-sm text-[var(--color-text-secondary)]">
            {albumsQuery.isLoading
              ? "loading..."
              : `${albums().length} ${albums().length === 1 ? "album" : "albums"}`}
          </p>
        </div>
        <Button variant="primary" onClick={props.onAddMusic}>
          add music
        </Button>
      </div>

      {/* tag filter picker */}
      <div class="ml-[150px]">
        <TagFilterPicker
          availableTags={availableTags()}
          selectedFilters={tagFilters()}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          onToggleMode={handleToggleMode}
          onClearAll={handleClearAllTags}
          loading={tagsQuery.isLoading}
          compact={true}
        />
      </div>

      {/* album grid */}
      <div class="flex-1 overflow-hidden">
        {isResetting() ? (
          <div class="flex items-center justify-center h-full">
            <div class="text-[var(--color-text-secondary)]">loading...</div>
          </div>
        ) : (
          <Show
            when={albums().length > 0 || albumsQuery.isLoading}
            fallback={
              <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
                <div class="text-center max-w-md">
                  <p class="text-lg text-[var(--color-text-secondary)] mb-2">
                    no albums in your library yet
                  </p>
                  <p class="text-sm text-[var(--color-text-tertiary)] mb-6">
                    click "add music" above to import local audio files or
                    download from urls
                  </p>
                  <Button variant="primary" onClick={props.onAddMusic}>
                    add music
                  </Button>
                </div>
              </div>
            }
          >
            <VirtualAlbumGrid
              albums={albums()}
              onAlbumClick={handleAlbumClick}
              onAlbumPlay={handleAlbumPlay}
              getContextMenuActions={getContextMenuActions}
              showYear={true}
              showGenres={true}
              cardSize="medium"
              height={undefined}
            />
          </Show>
        )}
      </div>
    </div>
  );
}
