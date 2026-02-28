// favorites layout - presentational component for displaying favorites with toggle filters
import { createSignal, createMemo, For, Show, onMount, onCleanup } from "solid-js";
import { Icon } from "../icons/registry";
import { MediaThumbnail } from "../media/MediaThumbnail";
import { FavoriteHeart } from "../ratings/FavoriteHeart";
import { SongCard } from "../cards/SongCard";
import { AlbumCard } from "../cards/AlbumCard";
import { ArtistCard } from "../cards/ArtistCard";
import { PlaylistCard } from "../cards/PlaylistCard";
import { ContextMenu, type MenuAction } from "../overlays/ContextMenu";
import { formatDuration } from "../../utils/formatDuration";
import type {
  Song,
  AlbumSummary,
  ArtistSummary,
  PlaylistSummary,
  GenreRef,
} from "../../music/data/types";
import { useScrollRestore } from "../../utils/scrollRestore";

// individual filter types (no "all" — toggles are additive)
export type FavoriteFilterType = "songs" | "albums" | "artists" | "playlists";

// keep backward compat export
export type FavoriteType = FavoriteFilterType;

export type FavoriteItem =
  | (Song & { type: "song" })
  | (AlbumSummary & { type: "album" })
  | (ArtistSummary & { type: "artist" })
  | (PlaylistSummary & { type: "playlist" });

export interface FavoritesLayoutProps {
  /** all favorites to display */
  favorites: FavoriteItem[];
  /** whether data is loading */
  isLoading?: boolean;
  /** container height in pixels (full window minus player bar) */
  height: number;
  /** compact mode - show icon-only toggle buttons between wide-xl */
  compactMode?: boolean;
  /** callback when filter changes */
  onFilterChange?: (activeFilters: Set<FavoriteFilterType>) => void;
  /** song card callbacks */
  onSongClick?: (song: Song) => void;
  onSongPlay?: (song: Song) => void;
  getSongContextMenuActions?: (song: Song) => MenuAction[];
  onSongFavoriteToggle?: (songId: string, isFavorite: boolean) => void;
  /** album card callbacks */
  onAlbumClick?: (album: AlbumSummary) => void;
  onAlbumPlay?: (album: AlbumSummary) => void;
  getAlbumContextMenuActions?: (album: AlbumSummary) => MenuAction[];
  onAlbumFavoriteToggle?: (albumId: string, isFavorite: boolean) => void;
  /** artist card callbacks */
  onArtistClick?: (artist: ArtistSummary) => void;
  onArtistPlay?: (artist: ArtistSummary) => void;
  getArtistContextMenuActions?: (artist: ArtistSummary) => MenuAction[];
  onArtistFavoriteToggle?: (artistId: string, isFavorite: boolean) => void;
  /** playlist card callbacks */
  onPlaylistClick?: (playlist: PlaylistSummary) => void;
  onPlaylistPlay?: (playlist: PlaylistSummary) => void;
  getPlaylistContextMenuActions?: (playlist: PlaylistSummary) => MenuAction[];
  onPlaylistFavoriteToggle?: (playlistId: string, isFavorite: boolean) => void;
  /** navigation callbacks */
  onArtistNavigate?: (artistId: string) => void;
  onAlbumNavigate?: (albumId: string) => void;
  onGenreClick?: (genre: GenreRef) => void;
}

// all filter types
const ALL_FILTERS: FavoriteFilterType[] = ["songs", "albums", "artists", "playlists"];

export function FavoritesLayout(props: FavoritesLayoutProps) {
  // all toggles start on
  const [activeFilters, setActiveFilters] = createSignal<Set<FavoriteFilterType>>(
    new Set(ALL_FILTERS)
  );
  let scrollContainerRef: HTMLDivElement | undefined;

  // scroll restoration
  const { restoreScroll, saveScroll } = useScrollRestore("favorites");

  onMount(() => {
    if (scrollContainerRef) {
      restoreScroll(scrollContainerRef);
    }
  });

  onCleanup(() => {
    if (scrollContainerRef) {
      saveScroll(scrollContainerRef);
    }
  });

  const toggleFilter = (type: FavoriteFilterType) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        // don't allow toggling off the last active filter
        if (next.size <= 1) return prev;
        next.delete(type);
      } else {
        next.add(type);
      }
      props.onFilterChange?.(next);
      return next;
    });
  };

  // is only songs toggled on?
  const isSongsOnly = createMemo(() => {
    const filters = activeFilters();
    return filters.size === 1 && filters.has("songs");
  });

  // type map for filtering
  const typeMap: Record<FavoriteFilterType, string> = {
    songs: "song",
    albums: "album",
    artists: "artist",
    playlists: "playlist",
  };

  // filter favorites based on active toggles
  const filteredFavorites = createMemo(() => {
    const filters = activeFilters();
    // if all are active, no filtering needed
    if (filters.size === ALL_FILTERS.length) return props.favorites;
    return props.favorites.filter((fav) => {
      for (const filter of filters) {
        if (fav.type === typeMap[filter]) return true;
      }
      return false;
    });
  });

  // count by type for toggle badges
  const counts = createMemo(() => {
    const songs = props.favorites.filter((f) => f.type === "song").length;
    const albums = props.favorites.filter((f) => f.type === "album").length;
    const artists = props.favorites.filter((f) => f.type === "artist").length;
    const playlists = props.favorites.filter((f) => f.type === "playlist").length;
    return { songs, albums, artists, playlists };
  });

  // icon mapping for filter types
  const filterIcons: Record<FavoriteFilterType, string> = {
    songs: "music",
    albums: "album",
    artists: "artist",
    playlists: "playlist",
  };

  // render toggle button
  const ToggleButton = (buttonProps: {
    type: FavoriteFilterType;
    label: string;
    count: number;
  }) => {
    const isActive = () => activeFilters().has(buttonProps.type);
    const iconName = () => filterIcons[buttonProps.type] as any;
    
    // in compact mode, show icon-only between wide-xl
    const compactClasses = () =>
      props.compactMode
        ? "wide:p-2 wide:aspect-square xl:px-4 xl:py-2 xl:aspect-auto"
        : "wide:px-4 wide:py-2";
    
    return (
      <button
        class={`px-2 py-1.5 ${compactClasses()} text-sm wide:text-base rounded-lg transition-all flex items-center justify-center gap-1 ${
          isActive()
            ? "bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)]"
            : "bg-[var(--color-bg-elevated)] text-[var(--color-text-disabled)] hover:bg-[var(--color-bg-elevated-hover)] hover:text-[var(--color-text-secondary)]"
        }`}
        onClick={() => toggleFilter(buttonProps.type)}
        title={buttonProps.label}
      >
        {/* icon-only in compact mode between wide-xl */}
        <Show when={props.compactMode}>
          <Icon name={iconName()} size={18} className="wide:block xl:hidden" />
        </Show>
        {/* text label - hidden between wide-xl in compact mode */}
        <span class={props.compactMode ? "wide:hidden xl:inline" : ""}>{buttonProps.label}</span>
        <Show when={buttonProps.count > 0}>
          <span
            class={`ml-1 wide:ml-2 px-1.5 wide:px-2 py-0.5 rounded-full text-xs ${props.compactMode ? "wide:hidden xl:inline" : ""} ${
              isActive() ? "bg-[var(--color-text-on-accent)]/20" : "bg-[var(--color-bg-primary)]"
            }`}
          >
            {buttonProps.count}
          </span>
        </Show>
      </button>
    );
  };

  // render a single favorite card (used in the mixed grid)
  const renderFavoriteCard = (item: FavoriteItem) => {
    switch (item.type) {
      case "song": {
        const song = item as Song & { type: "song" };
        const card = (
          <SongCard
            song={song}
            onClick={props.onSongClick}
            onPlay={props.onSongPlay}
            onFavoriteToggle={props.onSongFavoriteToggle}
            onArtistClick={props.onArtistNavigate}
            onAlbumClick={props.onAlbumNavigate}
          />
        );
        return props.getSongContextMenuActions ? (
          <ContextMenu actions={props.getSongContextMenuActions(song)}>{card}</ContextMenu>
        ) : (
          card
        );
      }
      case "album": {
        const album = item as AlbumSummary & { type: "album" };
        const card = (
          <AlbumCard
            album={album}
            onClick={props.onAlbumClick}
            onPlay={props.onAlbumPlay}
            onFavoriteToggle={props.onAlbumFavoriteToggle}
            onArtistClick={props.onArtistNavigate}
            onGenreClick={props.onGenreClick}
          />
        );
        return props.getAlbumContextMenuActions ? (
          <ContextMenu actions={props.getAlbumContextMenuActions(album)}>{card}</ContextMenu>
        ) : (
          card
        );
      }
      case "artist": {
        const artist = item as ArtistSummary & { type: "artist" };
        const card = (
          <ArtistCard
            artist={artist}
            onClick={props.onArtistClick}
            onPlay={props.onArtistPlay}
            onFavoriteToggle={props.onArtistFavoriteToggle}
            onGenreClick={props.onGenreClick}
          />
        );
        return props.getArtistContextMenuActions ? (
          <ContextMenu actions={props.getArtistContextMenuActions(artist)}>{card}</ContextMenu>
        ) : (
          card
        );
      }
      case "playlist": {
        const playlist = item as PlaylistSummary & { type: "playlist" };
        const card = (
          <PlaylistCard
            playlist={playlist}
            onClick={props.onPlaylistClick}
            onPlay={props.onPlaylistPlay}
            onFavoriteToggle={props.onPlaylistFavoriteToggle}
          />
        );
        return props.getPlaylistContextMenuActions ? (
          <ContextMenu actions={props.getPlaylistContextMenuActions(playlist)}>{card}</ContextMenu>
        ) : (
          card
        );
      }
    }
  };

  return (
    <div
      style={{ height: `${props.height}px` }}
      class="overflow-y-auto"
      ref={scrollContainerRef!}
      onScroll={(e) => saveScroll(e.currentTarget)}
    >
      <div class="px-4 wide:px-6 pb-6">
        {/* filter toggles */}
        <div class="flex gap-2 overflow-x-auto wide:overflow-x-visible wide:flex-wrap scrollbar-hide py-2 mb-4 sticky top-0 z-50 justify-end">
          <ToggleButton type="songs" label="songs" count={counts().songs} />
          <ToggleButton type="albums" label="albums" count={counts().albums} />
          <ToggleButton type="artists" label="artists" count={counts().artists} />
          <ToggleButton type="playlists" label="playlists" count={counts().playlists} />
        </div>

        {/* content */}
        <Show
          when={!props.isLoading && filteredFavorites().length > 0}
          fallback={
            <div class="flex flex-col items-center justify-center py-32 text-center">
              <Show
                when={props.isLoading}
                fallback={
                  <>
                    <Icon name="favorite" size={64} color="var(--color-text-disabled)" />
                    <p class="text-[var(--color-text-secondary)] mt-4">no favorites yet</p>
                    <p class="text-[var(--color-text-muted)] text-sm mt-2">
                      heart items to see them here
                    </p>
                  </>
                }
              >
                <div class="text-[var(--color-text-secondary)]">loading...</div>
              </Show>
            </div>
          }
        >
          {/* song rows view when only songs toggled, otherwise card grid */}
          <Show
            when={isSongsOnly()}
            fallback={
              <div class="grid grid-cols-2 sm:grid-cols-3 wide:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4">
                <For each={filteredFavorites()}>{(item) => renderFavoriteCard(item)}</For>
              </div>
            }
          >
            <div class="space-y-1">
              <For each={filteredFavorites() as (Song & { type: "song" })[]}>
                {(song) => {
                  const subtitle = [song.artist_name, song.album_title]
                    .filter(Boolean)
                    .join(" \u2022 ");
                  const duration_display = formatDuration(song.duration_seconds);
                  const row = (
                    <div
                      class="flex items-center gap-3 p-2 rounded hover:bg-[var(--color-bg-elevated)] transition-colors cursor-pointer"
                      onDblClick={() => {
                        props.onSongPlay?.(song);
                      }}
                    >
                      <MediaThumbnail
                        images={song.images?.length ? song.images : song.album_images}
                        onPlayClick={() => {
                          props.onSongPlay?.(song);
                        }}
                        size={48}
                        class="flex-shrink-0"
                      />
                      <div class="flex-1 min-w-0">
                        <div class="text-[var(--color-text-primary)] font-medium truncate">
                          {song.title}
                        </div>
                        <Show when={subtitle}>
                          <div class="text-sm text-[var(--color-text-secondary)] truncate">
                            {subtitle}
                          </div>
                        </Show>
                      </div>
                      <div class="text-sm text-[var(--color-text-tertiary)] flex-shrink-0">
                        {duration_display}
                      </div>
                      <FavoriteHeart
                        isFavorite={song.is_favorite ?? false}
                        onToggle={(isFavorite) => props.onSongFavoriteToggle?.(song.id, isFavorite)}
                        size="sm"
                      />
                    </div>
                  );
                  return props.getSongContextMenuActions ? (
                    <ContextMenu actions={props.getSongContextMenuActions(song)}>{row}</ContextMenu>
                  ) : (
                    row
                  );
                }}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
