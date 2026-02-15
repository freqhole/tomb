// albums view - displays all albums in a grid with infinite scroll
import { useNavigate, useSearchParams } from "@solidjs/router";
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import { setPageInfo, clearPageInfo } from "../../app/services/pageInfo";
import { Button } from "../../components/buttons/Button";
import type { CollectionCardData } from "../../components/cards/CollectionCard";
import { SearchSortControls } from "../../components/controls/SearchSortControls";
import { TagFilterPicker, type TagFilter } from "../../components/forms/TagFilterPicker";
import { VirtualAlbumGrid } from "../../components/virtualized/VirtualAlbumGrid";
import { getDataSource } from "../data";
import { useAlbumsQuery, type AlbumSortField } from "../queries/songs";
import { useToggleFavoriteMutation } from "../queries/favorites";
import { useTagsQuery } from "../queries/tags";
import { playQueue } from "../services/audio/queue";
import { useAlbumContextMenu } from "../services/contextMenu";
import { buildRoute } from "../utils/routing";
import { sortSongsCanonical } from "../utils/songSort";
import { formatLongDuration } from "../../utils/formatDuration";

export interface AlbumsViewProps {
  onAddMusic: () => void;
  onAlbumClick?: (albumId: string) => void;
}

const albumSortFields = [
  { value: "added_at", label: "date added", description: "sort by date added" },
  { value: "title", label: "title", description: "sort by album title" },
  { value: "artist", label: "artist", description: "sort by artist name" },
  { value: "year", label: "year", description: "sort by release year" },
  { value: "song_count", label: "tracks", description: "sort by track count" },
];

export function AlbumsView(props: AlbumsViewProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // responsive grid height
  // header: 84px, tag picker: 26px, player bar: 80px = 190px total
  const TOTAL_CHROME_HEIGHT = 84 + 26 + 80;
  const [gridHeight, setGridHeight] = createSignal(window.innerHeight - TOTAL_CHROME_HEIGHT);

  onMount(() => {
    let resizeTimeout: number | undefined;
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = window.setTimeout(() => {
        setGridHeight(window.innerHeight - TOTAL_CHROME_HEIGHT);
      }, 100);
    };
    window.addEventListener("resize", handleResize);
    onCleanup(() => {
      clearTimeout(resizeTimeout);
      window.removeEventListener("resize", handleResize);
      clearPageInfo(); // clear page info when leaving view
    });
  });

  // track query changes to force grid reset
  const [isResetting, setIsResetting] = createSignal(false);

  // sorting state
  const [sortField, setSortField] = createSignal<AlbumSortField>("added_at");
  const [sortDirection, setSortDirection] = createSignal<"asc" | "desc">("desc");

  // tag filtering state
  const [tagFilters, setTagFilters] = createSignal<TagFilter[]>([]);

  // fetch available tags
  const tagsQuery = useTagsQuery();

  // favorites mutation
  const toggleFavoriteMutation = useToggleFavoriteMutation();

  // get search query from URL params
  const searchQuery = () => {
    const q = searchParams.q;
    return Array.isArray(q) ? q[0] : q;
  };

  // fetch albums using query hook with sorting
  const albumsQuery = useAlbumsQuery({
    pageSize: 50,
    query: searchQuery,
    tagFilters: () => tagFilters(),
    sortField: () => sortField(),
    sortDirection: () => sortDirection(),
  });

  // reset virtual grid when query param or tag filters change
  createEffect(
    on(
      () => [searchQuery(), tagFilters(), sortField(), sortDirection()] as const,
      () => {
        setIsResetting(true);
        setTimeout(() => setIsResetting(false), 0);
      },
      { defer: true }
    )
  );

  // load more when near end
  const loadMore = () => {
    if (albumsQuery.hasNextPage && !albumsQuery.isFetchingNextPage) {
      albumsQuery.fetchNextPage();
    }
  };

  // flatten all pages into albums list
  const albums = createMemo((): CollectionCardData[] => {
    const pages = albumsQuery.data?.pages ?? [];
    const allAlbums = pages.flatMap((page) => page.items);

    // map AlbumSummary to CollectionCardData format
    return allAlbums.map((album) => {
      // format genres (GenreRef[] -> string)
      const genreText = (album.genres || []).map((g) => g.name).join(" • ") || null;

      // extract year from release_date (YYYY, YYYY-MM, or YYYY-MM-DD)
      const year = album.release_date
        ? parseInt(album.release_date.substring(0, 4), 10)
        : album.year || null;

      return {
        id: album.album_id,
        title: album.title,
        subtitle: album.artist_name,
        domainType: "album" as const,
        artist: album.artist_name,
        year: year,
        trackCount: album.song_count,
        totalDuration: formatLongDuration(album.total_duration),
        imageUrl: undefined,
        images: album.images,
        isFavorite: album.is_favorite ?? false,
        genres: genreText,
        tags: album.tags,
      };
    });
  });

  // update page info for TopNav (mobile displays "albums (N)")
  createEffect(() => {
    const count = albums().length;
    setPageInfo({ title: "albums", count });
  });

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
              mode: (f.mode === "include" ? "exclude" : "include") as "include" | "exclude",
            }
          : f
      )
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
      await playQueue(sortedSongs);
    } catch (error) {
      console.error("failed to play album:", error);
    }
  };

  const handleAlbumClick = (album: CollectionCardData) => {
    navigate(buildRoute(`/albums/${album.id}`));
  };

  const handleFavoriteToggle = (albumId: string, isFavorite: boolean) => {
    toggleFavoriteMutation.mutate({
      targetType: "album",
      targetId: albumId,
      isFavorite,
    });
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
      }
    );
  };

  return (
    <div class="flex flex-col h-full">
      {/* header */}
      <div class="flex items-center justify-between p-4">
        <div class="hidden md:block mr-4">
          <h1 class="text-2xl font-bold text-[var(--color-text-primary)]">albums</h1>
          <p class="text-sm text-[var(--color-text-secondary)]">
            {albumsQuery.isLoading
              ? "loading..."
              : `${albums().length} ${albums().length === 1 ? "album" : "albums"}${albumsQuery.hasNextPage ? "+" : ""}`}
          </p>
        </div>
        <div class="flex-1 flex justify-between items-center gap-4">
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
          <SearchSortControls
            sortFields={albumSortFields}
            sortBy={sortField()}
            sortDirection={sortDirection()}
            onSortByChange={(field) => setSortField(field as AlbumSortField)}
            onSortDirectionChange={setSortDirection}
          />
        </div>
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
                    add music to import local audio files or download from urls
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
              onFavoriteToggle={(album, isFavorite) => handleFavoriteToggle(album.id, isFavorite)}
              getContextMenuActions={getContextMenuActions}
              onNearEnd={loadMore}
              showYear={true}
              showGenres={true}
              cardSize="medium"
              height={gridHeight()}
              scrollRestoreKey={`albums-${searchQuery() || ""}-${tagFilters()
                .map((f) => f.tag)
                .join(",")}`}
            />
            {albumsQuery.isFetchingNextPage && (
              <div class="p-4 text-center text-[var(--color-text-secondary)] text-sm">
                loading more albums...
              </div>
            )}
          </Show>
        )}
      </div>
    </div>
  );
}
