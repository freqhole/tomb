// favorites layout - presentational component for displaying favorites grid
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { Icon } from "../icons/registry";
import { MediaImage } from "../media/MediaImage";
import { MediaThumbnail } from "../media/MediaThumbnail";
import { FavoriteHeart } from "../ratings/FavoriteHeart";
import { SongCard } from "../cards/SongCard";
import { AlbumCard } from "../cards/AlbumCard";
import { ArtistCard } from "../cards/ArtistCard";
import { PlaylistCard } from "../cards/PlaylistCard";
import type { Song, AlbumSummary, ArtistSummary, PlaylistSummary } from "../../music/data/types";
import { getImageUrl } from "../../music/utils/format";

export type FavoriteType = "all" | "songs" | "albums" | "artists" | "playlists";

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
  /** initial filter type */
  initialFilter?: FavoriteType;
  /** callback when filter changes */
  onFilterChange?: (filter: FavoriteType) => void;
  /** song card callbacks */
  onSongClick?: (song: Song) => void;
  onSongPlay?: (song: Song) => void;
  onSongContextMenu?: (e: MouseEvent, song: Song) => void;
  onSongFavoriteToggle?: (songId: string, isFavorite: boolean) => void;
  /** album card callbacks */
  onAlbumClick?: (album: AlbumSummary) => void;
  onAlbumPlay?: (album: AlbumSummary) => void;
  onAlbumContextMenu?: (e: MouseEvent, album: AlbumSummary) => void;
  onAlbumFavoriteToggle?: (albumId: string, isFavorite: boolean) => void;
  /** artist card callbacks */
  onArtistClick?: (artist: ArtistSummary) => void;
  onArtistPlay?: (artist: ArtistSummary) => void;
  onArtistContextMenu?: (e: MouseEvent, artist: ArtistSummary) => void;
  onArtistFavoriteToggle?: (artistId: string, isFavorite: boolean) => void;
  /** playlist card callbacks */
  onPlaylistClick?: (playlist: PlaylistSummary) => void;
  onPlaylistPlay?: (playlist: PlaylistSummary) => void;
  onPlaylistContextMenu?: (e: MouseEvent, playlist: PlaylistSummary) => void;
  onPlaylistFavoriteToggle?: (playlistId: string, isFavorite: boolean) => void;
  /** navigation callbacks */
  onArtistNavigate?: (artistId: string) => void;
  onAlbumNavigate?: (albumId: string) => void;
  onGenreClick?: (genre: string) => void;
}

export function FavoritesLayout(props: FavoritesLayoutProps) {
  const [filterType, setFilterType] = createSignal<FavoriteType>(props.initialFilter || "all");

  const handleFilterChange = (type: FavoriteType) => {
    setFilterType(type);
    props.onFilterChange?.(type);
  };

  // filter favorites based on selected type and sort by timestamp
  const filteredFavorites = () => {
    const filter = filterType();
    let items = props.favorites;
    
    // filter by type if not "all"
    if (filter !== "all") {
      // map plural filter to singular type
      const typeMap: Record<string, string> = {
        songs: "song",
        albums: "album",
        artists: "artist",
        playlists: "playlist",
      };
      const targetType = typeMap[filter] || filter;
      items = items.filter((fav) => fav.type === targetType);
    }
    
    // return items as-is (already sorted by parent)
    return items;
  };

  // count by type for tab badges
  const counts = () => {
    const songs = props.favorites.filter((f) => f.type === "song").length;
    const albums = props.favorites.filter((f) => f.type === "album").length;
    const artists = props.favorites.filter((f) => f.type === "artist").length;
    const playlists = props.favorites.filter((f) => f.type === "playlist").length;
    return { songs, albums, artists, playlists, all: props.favorites.length };
  };

  // render tab button
  const TabButton = (buttonProps: {
    type: FavoriteType;
    label: string;
    count: number;
  }) => {
    const isActive = () => filterType() === buttonProps.type;
    return (
      <button
        class={`px-4 py-2 rounded-lg transition-all ${
          isActive()
            ? "bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)]"
            : "bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated-hover)] hover:text-[var(--color-text-primary)]"
        }`}
        onClick={() => handleFilterChange(buttonProps.type)}
      >
        {buttonProps.label}
        <Show when={buttonProps.count > 0}>
          <span
            class={`ml-2 px-2 py-0.5 rounded-full text-xs ${
              isActive()
                ? "bg-[var(--color-text-on-accent)]/20"
                : "bg-[var(--color-bg-primary)]"
            }`}
          >
            {buttonProps.count}
          </span>
        </Show>
      </button>
    );
  };

  return (
    <div class="h-full flex flex-col">
      {/* header with tabs */}
      <div class="p-6 border-b border-[var(--color-border-subtle)]">
        <h1 class="text-3xl font-bold text-[var(--color-text-primary)] mb-6">
          favorites
        </h1>

        {/* filter tabs */}
        <div class="flex gap-2 flex-wrap">
          <TabButton type="all" label="all" count={counts().all} />
          <TabButton type="songs" label="songs" count={counts().songs} />
          <TabButton type="albums" label="albums" count={counts().albums} />
          <TabButton type="artists" label="artists" count={counts().artists} />
          <TabButton
            type="playlists"
            label="playlists"
            count={counts().playlists}
          />
        </div>
      </div>

      {/* content area */}
      <div class="flex-1 overflow-y-auto p-6">
        <Show
          when={!props.isLoading && filteredFavorites().length > 0}
          fallback={
            <div class="flex flex-col items-center justify-center h-full text-center">
              <Show
                when={props.isLoading}
                fallback={
                  <>
                    <Icon
                      name="favorite"
                      size={64}
                      color="var(--color-text-disabled)"
                    />
                    <p class="text-[var(--color-text-secondary)] mt-4">
                      no favorites yet
                    </p>
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
          {/* render based on filter type */}
          <Switch>
            <Match when={filterType() === "all"}>
              <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
                <For each={filteredFavorites()}>
                  {(item) => (
                    <Switch>
                      <Match when={item.type === "song"}>
                        <SongCard
                          song={item as (Song & { type: "song" })}
                          onClick={props.onSongClick}
                          onPlay={props.onSongPlay}
                          onContextMenu={props.onSongContextMenu}
                          onFavoriteToggle={props.onSongFavoriteToggle}
                          onArtistClick={props.onArtistNavigate}
                          onAlbumClick={props.onAlbumNavigate}
                        />
                      </Match>
                      <Match when={item.type === "album"}>
                        <AlbumCard
                          album={item as (AlbumSummary & { type: "album" })}
                          onClick={props.onAlbumClick}
                          onPlay={props.onAlbumPlay}
                          onContextMenu={props.onAlbumContextMenu}
                          onFavoriteToggle={props.onAlbumFavoriteToggle}
                          onArtistClick={props.onArtistNavigate}
                          onGenreClick={props.onGenreClick}
                        />
                      </Match>
                      <Match when={item.type === "artist"}>
                        <ArtistCard
                          artist={item as (ArtistSummary & { type: "artist" })}
                          onClick={props.onArtistClick}
                          onPlay={props.onArtistPlay}
                          onContextMenu={props.onArtistContextMenu}
                          onFavoriteToggle={props.onArtistFavoriteToggle}
                          onGenreClick={props.onGenreClick}
                        />
                      </Match>
                      <Match when={item.type === "playlist"}>
                        <PlaylistCard
                          playlist={item as (PlaylistSummary & { type: "playlist" })}
                          onClick={props.onPlaylistClick}
                          onPlay={props.onPlaylistPlay}
                          onContextMenu={props.onPlaylistContextMenu}
                          onFavoriteToggle={props.onPlaylistFavoriteToggle}
                        />
                      </Match>
                    </Switch>
                  )}
                </For>
              </div>
            </Match>

            <Match when={filterType() === "songs"}>
              <div class="space-y-1">
                <For each={filteredFavorites() as (Song & { type: "song" })[]}>
                  {(song) => {
                    const subtitle = [song.artist_name, song.album_title].filter(Boolean).join(" • ");
                    const duration_display = song.duration_seconds 
                      ? `${Math.floor(song.duration_seconds / 60)}:${String(song.duration_seconds % 60).padStart(2, '0')}`
                      : '';
                    return (
                      <div 
                        class="flex items-center gap-3 p-2 rounded hover:bg-[var(--color-bg-elevated)] transition-colors cursor-pointer"
                        onDblClick={() => {
                          console.log("song row double click:", song.title);
                          props.onSongPlay?.(song);
                        }}
                      >
                        <Show when={song.thumbnail_blob_id}>
                          <MediaThumbnail
                          thumbnailUrl={getImageUrl(song.thumbnail_blob_id)!}
                            onPlayClick={() => {
                              console.log("media thumbnail click:", song.title);
                              props.onSongPlay?.(song);
                            }}
                            size={48}
                            class="flex-shrink-0"
                          />
                        </Show>
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
                  }}
                </For>
              </div>
            </Match>

            <Match when={filterType() === "albums"}>
              <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
                <For each={filteredFavorites() as (AlbumSummary & { type: "album" })[]}>
                  {(album) => (
                    <AlbumCard
                      album={album}
                      onClick={props.onAlbumClick}
                      onPlay={props.onAlbumPlay}
                      onContextMenu={props.onAlbumContextMenu}
                      onFavoriteToggle={props.onAlbumFavoriteToggle}
                      onArtistClick={props.onArtistNavigate}
                      onGenreClick={props.onGenreClick}
                    />
                  )}
                </For>
              </div>
            </Match>

            <Match when={filterType() === "artists"}>
              <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
                <For each={filteredFavorites() as (ArtistSummary & { type: "artist" })[]}>
                  {(artist) => (
                    <ArtistCard
                      artist={artist}
                      onClick={props.onArtistClick}
                      onPlay={props.onArtistPlay}
                      onContextMenu={props.onArtistContextMenu}
                      onFavoriteToggle={props.onArtistFavoriteToggle}
                      onGenreClick={props.onGenreClick}
                    />
                  )}
                </For>
              </div>
            </Match>

            <Match when={filterType() === "playlists"}>
              <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
                <For each={filteredFavorites() as (PlaylistSummary & { type: "playlist" })[]}>
                  {(playlist) => (
                    <PlaylistCard
                      playlist={playlist}
                      onClick={props.onPlaylistClick}
                      onPlay={props.onPlaylistPlay}
                      onContextMenu={props.onPlaylistContextMenu}
                      onFavoriteToggle={props.onPlaylistFavoriteToggle}
                    />
                  )}
                </For>
              </div>
            </Match>
          </Switch>
        </Show>
      </div>
    </div>
  );
}
