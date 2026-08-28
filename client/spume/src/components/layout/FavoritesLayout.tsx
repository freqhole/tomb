// favorites layout - presentational component for displaying favorites with toggle filters
import { createSignal, createMemo, For, Show, onMount, onCleanup } from "solid-js";
import { Icon } from "../icons/registry";
import { IconButton } from "../buttons/IconButton";
import { MediaThumbnail } from "../media/MediaThumbnail";
import { FavoriteHeart } from "../ratings/FavoriteHeart";
import { SongCard } from "../cards/SongCard";
import { AlbumCard } from "../cards/AlbumCard";
import { ArtistCard } from "../cards/ArtistCard";
import { PlaylistCard } from "../cards/PlaylistCard";
import { VideoCard } from "../../video/components/VideoCard";
import { VideoSeriesCard } from "../../video/components/VideoSeriesCard";
import { ContextMenu, type MenuAction } from "../overlays/ContextMenu";
import { formatDuration } from "../../utils/formatDuration";
import type {
  Song,
  AlbumSummary,
  ArtistSummary,
  PlaylistSummary,
  GenreRef,
} from "../../music/data/types";
import type { VideoSummary, VideoSeries } from "../../video/data/types";
import { useScrollRestore } from "../../utils/scrollRestore";

// individual filter types (no "all" — toggles are additive)
export type FavoriteFilterType = "songs" | "albums" | "artists" | "playlists" | "videos" | "series";

// keep backward compat export
export type FavoriteType = FavoriteFilterType;

export type FavoriteItem =
  | (Song & { type: "song" })
  | (AlbumSummary & { type: "album" })
  | (ArtistSummary & { type: "artist" })
  | (PlaylistSummary & { type: "playlist" })
  | (VideoSummary & { type: "video" })
  | (VideoSeries & { type: "video_series" });

export interface FavoritesLayoutProps {
  /** all favorites to display */
  favorites: FavoriteItem[];
  /** whether data is loading */
  isLoading?: boolean;
  /** container height in pixels (full window minus player bar) */
  height: number;
  /** callback when filter changes */
  onFilterChange?: (activeFilters: Set<FavoriteFilterType>) => void;
  /** play all favorites matching the currently active filters (expanding
   *  albums/artists/playlists into their songs) */
  onPlayAllFavorites?: (activeFilters: Set<FavoriteFilterType>) => void | Promise<void>;
  /** shuffle-play all favorites matching the currently active filters */
  onShuffleAllFavorites?: (activeFilters: Set<FavoriteFilterType>) => void | Promise<void>;
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
  /** video card callbacks */
  onVideoClick?: (video: VideoSummary) => void;
  onVideoPlay?: (video: VideoSummary) => void;
  getVideoContextMenuActions?: (video: VideoSummary) => MenuAction[];
  onVideoFavoriteToggle?: (videoId: string, isFavorite: boolean) => void;
  /** video series card callbacks */
  onSeriesClick?: (series: VideoSeries) => void;
  onSeriesPlay?: (series: VideoSeries) => void;
  getSeriesContextMenuActions?: (series: VideoSeries) => MenuAction[];
  onSeriesFavoriteToggle?: (seriesId: string, isFavorite: boolean) => void;
  /** navigation callbacks */
  onArtistNavigate?: (artistId: string) => void;
  onAlbumNavigate?: (albumId: string) => void;
  onGenreClick?: (genre: GenreRef) => void;
}

// all filter types
const ALL_FILTERS: FavoriteFilterType[] = [
  "songs",
  "albums",
  "artists",
  "playlists",
  "videos",
  "series",
];

export function FavoritesLayout(props: FavoritesLayoutProps) {
  // all toggles start on
  const [activeFilters, setActiveFilters] = createSignal<Set<FavoriteFilterType>>(
    new Set(ALL_FILTERS)
  );
  // tracks which of the play/shuffle actions is currently fetching + queueing
  // songs, so the buttons can show immediate feedback (loading spinner) for
  // however long that takes - can be a while for lots of songs/a slow remote.
  const [pendingAction, setPendingAction] = createSignal<"play" | "shuffle" | null>(null);
  let scrollContainerRef: HTMLDivElement | undefined;

  // scroll restoration
  const { restoreScroll, saveScroll } = useScrollRestore("favorites");

  // measure the real available width (not just the viewport) so the toggle
  // row can react to the queue sidebar opening/closing - tailwind's
  // wide:/xl: classes only see window.innerWidth, so on a merely-"wide"
  // window with the (inline, width-taking) queue sidebar open, they'd keep
  // rendering full-width buttons that overflow and get clipped under the
  // floating top nav pill.
  const [containerWidth, setContainerWidth] = createSignal(
    typeof window !== "undefined" ? window.innerWidth : 1024
  );
  let resizeObserver: ResizeObserver | undefined;

  onMount(() => {
    if (scrollContainerRef) {
      restoreScroll(scrollContainerRef);
      setContainerWidth(scrollContainerRef.clientWidth);
      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) setContainerWidth(entry.contentRect.width);
      });
      resizeObserver.observe(scrollContainerRef);
    }
  });

  onCleanup(() => {
    if (scrollContainerRef) {
      saveScroll(scrollContainerRef);
    }
    resizeObserver?.disconnect();
  });

  // three tiers based on measured width: full label+count, icon+count only,
  // or icon-only (tightest - e.g. wide window with queue sidebar open)
  const compactLevel = createMemo<"full" | "compact" | "icon-only">(() => {
    const w = containerWidth();
    if (w < 480) return "icon-only";
    if (w < 900) return "compact";
    return "full";
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

  // long-press a toggle to solo it (deactivate every other filter)
  const isolateFilter = (type: FavoriteFilterType) => {
    const next = new Set<FavoriteFilterType>([type]);
    props.onFilterChange?.(next);
    setActiveFilters(next);
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
    videos: "video",
    series: "video_series",
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
    const videos = props.favorites.filter((f) => f.type === "video").length;
    const series = props.favorites.filter((f) => f.type === "video_series").length;
    return { songs, albums, artists, playlists, videos, series };
  });

  // icon mapping for filter types
  const filterIcons: Record<FavoriteFilterType, string> = {
    songs: "music",
    albums: "album",
    artists: "artist",
    playlists: "playlist",
    videos: "video",
    series: "videoSeries",
  };

  // render toggle button
  const LONG_PRESS_MS = 500;

  const ToggleButton = (buttonProps: {
    type: FavoriteFilterType;
    label: string;
    count: number;
  }) => {
    const isActive = () => activeFilters().has(buttonProps.type);
    const iconName = () => filterIcons[buttonProps.type] as any;

    // long-press (or long mousedown, for desktop) solos this filter -
    // suppresses the click handler's normal toggle behavior once it fires.
    let pressTimer: ReturnType<typeof setTimeout> | undefined;
    let longPressFired = false;

    const clearPressTimer = () => {
      if (pressTimer !== undefined) {
        clearTimeout(pressTimer);
        pressTimer = undefined;
      }
    };
    onCleanup(clearPressTimer);

    const startPressTimer = () => {
      longPressFired = false;
      clearPressTimer();
      pressTimer = setTimeout(() => {
        longPressFired = true;
        isolateFilter(buttonProps.type);
      }, LONG_PRESS_MS);
    };

    // sized by the measured container width - see compactLevel above
    const level = () => compactLevel();
    const showIcon = () => level() !== "full";
    const showLabel = () => level() === "full";
    const showCount = () => level() !== "icon-only" && buttonProps.count > 0;

    const paddingClasses = () => (level() === "icon-only" ? "p-2 aspect-square" : "px-2 py-1.5");

    return (
      <button
        class={`flex-shrink-0 ${paddingClasses()} text-sm rounded-lg transition-all flex items-center justify-center gap-1 select-none ${
          isActive()
            ? "bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)]"
            : "bg-[var(--color-bg-elevated)] text-[var(--color-text-disabled)] hover:bg-[var(--color-bg-elevated-hover)] hover:text-[var(--color-text-secondary)]"
        }`}
        onPointerDown={startPressTimer}
        onPointerUp={clearPressTimer}
        onPointerLeave={clearPressTimer}
        onPointerCancel={clearPressTimer}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          if (longPressFired) {
            longPressFired = false;
            return;
          }
          toggleFilter(buttonProps.type);
        }}
        aria-label={buttonProps.label}
        title={`${buttonProps.label} (long-press to solo)`}
      >
        <Show when={showIcon()}>
          <Icon name={iconName()} size={18} />
        </Show>
        <Show when={showLabel()}>
          <span>{buttonProps.label}</span>
        </Show>
        <Show when={showCount()}>
          <span
            class={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${
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
      case "video": {
        const video = item as VideoSummary & { type: "video" };
        const card = (
          <VideoCard
            video={video}
            isFavorite={true}
            onClick={props.onVideoClick}
            onPlay={props.onVideoPlay}
            onFavoriteToggle={props.onVideoFavoriteToggle}
          />
        );
        return props.getVideoContextMenuActions ? (
          <ContextMenu actions={props.getVideoContextMenuActions(video)}>{card}</ContextMenu>
        ) : (
          card
        );
      }
      case "video_series": {
        const series = item as VideoSeries & { type: "video_series" };
        const card = (
          <VideoSeriesCard
            series={series}
            isFavorite={true}
            onClick={props.onSeriesClick}
            onPlay={props.onSeriesPlay}
            onFavoriteToggle={props.onSeriesFavoriteToggle}
          />
        );
        return props.getSeriesContextMenuActions ? (
          <ContextMenu actions={props.getSeriesContextMenuActions(series)}>{card}</ContextMenu>
        ) : (
          card
        );
      }
    }
  };

  // run play/shuffle-all, tracking which one is in flight so the buttons can
  // show a loading spinner for however long the fetch + queue takes
  const handlePlayAll = async () => {
    if (pendingAction()) return;
    setPendingAction("play");
    try {
      await props.onPlayAllFavorites?.(activeFilters());
    } finally {
      setPendingAction(null);
    }
  };

  const handleShuffleAll = async () => {
    if (pendingAction()) return;
    setPendingAction("shuffle");
    try {
      await props.onShuffleAllFavorites?.(activeFilters());
    } finally {
      setPendingAction(null);
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
        {/* play/shuffle all (respecting active filters) + filter toggles, all
            in one always-horizontally-scrollable row. justify-start on
            narrow avoids the justify-end + overflow-x-auto clipping bug
            (start-of-row items get hidden with no way to scroll back to
            them); wide:justify-end hugs the row to the top-right, away from
            the floating nav pill in the top-left corner, without needing a
            permanent vertical offset - wide screens rarely have enough
            items to overflow, so the clipping risk there is negligible. */}
        <div
          class="flex gap-2 overflow-x-auto scrollbar-hide py-2 mb-4 sticky top-0 z-50 justify-start wide:justify-end bg-[var(--color-bg-primary)]/40 backdrop-blur-sm rounded-lg"
          style={{ "padding-left": "var(--chrome-traffic-lights-inset, 0px)" }}
        >
          <IconButton
            icon="play"
            size="default"
            variant="ghost"
            class="flex-shrink-0 bg-[var(--color-bg-elevated)]/70 backdrop-blur-sm"
            disabled={filteredFavorites().length === 0 || pendingAction() !== null}
            loading={pendingAction() === "play"}
            onClick={handlePlayAll}
            aria-label="play all favorites"
            title="play all favorites"
          />
          <IconButton
            icon="shuffle"
            size="default"
            variant="ghost"
            class="flex-shrink-0 bg-[var(--color-bg-elevated)]/70 backdrop-blur-sm"
            disabled={filteredFavorites().length === 0 || pendingAction() !== null}
            loading={pendingAction() === "shuffle"}
            onClick={handleShuffleAll}
            aria-label="shuffle favorites"
            title="shuffle favorites (replaces current queue)"
          />
          <ToggleButton type="songs" label="songs" count={counts().songs} />
          <ToggleButton type="albums" label="albums" count={counts().albums} />
          <ToggleButton type="artists" label="artists" count={counts().artists} />
          <ToggleButton type="playlists" label="playlists" count={counts().playlists} />
          <ToggleButton type="videos" label="videos" count={counts().videos} />
          <ToggleButton type="series" label="series" count={counts().series} />
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
