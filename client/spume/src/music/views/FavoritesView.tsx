// favorites view - displays all favorited items with infinite scroll
import { useNavigate } from "@solidjs/router";
import { createEffect, createMemo, on, onCleanup, Show } from "solid-js";
import {
  FavoritesLayout,
  type FavoriteItem as LayoutFavoriteItem,
} from "../../components/layout/FavoritesLayout";
import { playQueue } from "../services/queue/queue";
import { setPageInfo, clearPageInfo } from "../../app/services/pageInfo";
import { getDataSource, RemoteOfflineError } from "../data";
import { appState } from "../../app/services/storage/db";
import type {
  FavoriteItem,
  Song,
  AlbumSummary,
  ArtistSummary,
  PlaylistSummary,
  GenreRef,
} from "../data/types";
import { useFavoritesInfiniteQuery, useToggleFavoriteMutation } from "../queries/favorites";
import {
  useSongContextMenu,
  useAlbumContextMenu,
  useArtistContextMenu,
  usePlaylistContextMenu,
} from "../hooks/contextMenu";
import { routes } from "../utils/routing";
import { useViewportHeight, getNavHeight } from "../../utils/viewport";

export interface FavoritesViewProps {
  onAddMusic: () => void;
  onSongDoubleClick?: (song: Song) => void;
}

export function FavoritesView(props: FavoritesViewProps) {
  const navigate = useNavigate();
  const toggleFavorite = useToggleFavoriteMutation();

  // responsive height — reactive to safari toolbar changes
  const viewportHeight = useViewportHeight();
  const playerBarHeight = () => ((appState()?.queue.length || 0) > 0 ? 80 : 0);
  const containerHeight = () => viewportHeight() - getNavHeight() - playerBarHeight();

  // infinite query for favorites
  const favoritesQuery = useFavoritesInfiniteQuery({
    pageSize: 50,
  });

  // auto-fetch next page when query becomes idle and has more data
  createEffect(
    on(
      () => ({
        hasNextPage: favoritesQuery.hasNextPage,
        isFetchingNextPage: favoritesQuery.isFetchingNextPage,
        isFetching: favoritesQuery.isFetching,
      }),
      (state) => {
        if (state.hasNextPage && !state.isFetchingNextPage && !state.isFetching) {
          favoritesQuery.fetchNextPage();
        }
      }
    )
  );

  // transform app domain FavoriteItem to layout's expected format
  const allFavorites = createMemo((): LayoutFavoriteItem[] => {
    const pages = favoritesQuery.data?.pages ?? [];
    const items = pages.flatMap((page) => page.items);

    const result = items.map((item: FavoriteItem): LayoutFavoriteItem => {
      // these items ARE favorites by definition (they're from the favorites endpoint)
      // so we explicitly set is_favorite: true regardless of what the server returned
      // #TODO: ideally the server should just return is_favorite: true for these itemsz to avoid confusion
      switch (item.type) {
        case "song":
          return { ...item.data, type: "song", is_favorite: true };
        case "album":
          return { ...item.data, type: "album", is_favorite: true };
        case "artist":
          return { ...item.data, type: "artist", is_favorite: true };
        case "playlist":
          return { ...item.data, type: "playlist", is_favorite: true };
      }
    });

    return result;
  });

  // update page info for TopNav (mobile displays "favorites (N)")
  createEffect(() => {
    const count = allFavorites().length;
    setPageInfo({ title: "favorites", count });
  });

  // clear page info when leaving view
  onCleanup(() => {
    clearPageInfo();
  });

  // song handlers
  const handleSongClick = (_song: Song) => {
    // single click - could navigate to song detail if we had one
  };

  const handleSongDoubleClick = (song: Song) => {
    props.onSongDoubleClick?.(song);
  };

  const getSongContextMenuActions = (song: Song) => {
    return useSongContextMenu(song, {
      showPlayActions: true,
      isFavorite: song.is_favorite ?? false,
    });
  };

  const handleSongFavoriteToggle = (songId: string, isFavorite: boolean) => {
    const song = allFavorites().find((f) => f.type === "song" && (f as any).id === songId) as
      | Song
      | undefined;
    if (!song) return;

    toggleFavorite.mutate({
      targetType: "song",
      targetId: songId,
      sha256: song.sha256,
      isFavorite,
    });
  };

  // album handlers
  const handleAlbumClick = (album: AlbumSummary) => {
    navigate(routes.album(album.album_id));
  };

  const handleAlbumPlay = async (album: AlbumSummary) => {
    try {
      const dataSource = getDataSource();
      const songsResponse = await dataSource.getSongs({
        album_id: album.album_id,
        limit: 1000,
      });

      const songs = songsResponse.items;
      if (songs.length === 0) {
        console.warn("album has no songs");
        return;
      }

      const sortedSongs = songs; // TODO: use sortSongsCanonical when available
      await playQueue(sortedSongs, {
        source: { type: "album", label: album.title, entity_id: album.album_id },
      });
    } catch (error) {
      console.error("failed to play album:", error);
    }
  };

  const getAlbumContextMenuActions = (album: AlbumSummary) => {
    return useAlbumContextMenu(
      {
        id: album.album_id,
        title: album.title,
        artist_name: album.artist_name,
        artist_id: album.artist_id,
        song_count: album.song_count,
      },
      {
        showPlayActions: true,
        isFavorite: album.is_favorite ?? false,
      }
    );
  };

  const handleAlbumFavoriteToggle = (albumId: string, isFavorite: boolean) => {
    toggleFavorite.mutate({
      targetType: "album",
      targetId: albumId,
      isFavorite,
    });
  };

  // artist handlers
  const handleArtistClick = (artist: ArtistSummary) => {
    navigate(routes.artist(artist.artist_id));
  };

  const handleArtistPlay = async (artist: ArtistSummary) => {
    try {
      const dataSource = getDataSource();
      const songsResponse = await dataSource.getSongs({
        artist_id: artist.artist_id,
        limit: 1000,
      });

      const songs = songsResponse.items;
      if (songs.length === 0) {
        console.warn("artist has no songs");
        return;
      }

      const sortedSongs = songs; // TODO: use sortSongsCanonical when available
      await playQueue(sortedSongs, {
        source: {
          type: "artist",
          label: artist.name,
          entity_id: artist.artist_id,
          image: artist.images?.[0],
        },
      });
    } catch (error) {
      console.error("failed to play artist:", error);
    }
  };

  const getArtistContextMenuActions = (artist: ArtistSummary) => {
    return useArtistContextMenu(
      {
        id: artist.artist_id,
        name: artist.name,
      },
      {
        showPlayActions: true,
        isFavorite: artist.is_favorite ?? false,
      }
    );
  };

  const handleArtistFavoriteToggle = (artistId: string, isFavorite: boolean) => {
    toggleFavorite.mutate({
      targetType: "artist",
      targetId: artistId,
      isFavorite,
    });
  };

  // playlist handlers
  const handlePlaylistClick = (playlist: PlaylistSummary) => {
    navigate(routes.playlist(playlist.playlist_id));
  };

  const handlePlaylistPlay = async (playlist: PlaylistSummary) => {
    try {
      const dataSource = getDataSource();
      if (!dataSource.getPlaylistSongs) {
        console.warn("playlist songs not supported");
        return;
      }

      const songsResponse = await dataSource.getPlaylistSongs(playlist.playlist_id, {
        limit: 1000,
      });

      const songs = songsResponse.items;
      if (songs.length === 0) {
        console.warn("playlist has no songs");
        return;
      }

      await playQueue(songs, {
        source: {
          type: "playlist",
          label: playlist.title,
          entity_id: playlist.playlist_id,
          image: playlist.images?.[0],
        },
      });
    } catch (error) {
      console.error("failed to play playlist:", error);
    }
  };

  const getPlaylistContextMenuActions = (playlist: PlaylistSummary) => {
    return usePlaylistContextMenu(
      {
        id: playlist.playlist_id,
        title: playlist.title,
      },
      {
        showPlayActions: true,
        isFavorite: playlist.is_favorite ?? false,
      }
    );
  };

  const handlePlaylistFavoriteToggle = (playlistId: string, isFavorite: boolean) => {
    toggleFavorite.mutate({
      targetType: "playlist",
      targetId: playlistId,
      isFavorite,
    });
  };

  // navigation handlers
  const handleArtistNavigate = (artistId: string) => {
    navigate(routes.artist(artistId));
  };

  const handleAlbumNavigate = (albumId: string) => {
    navigate(routes.album(albumId));
  };

  const handleGenreClick = (_genre: GenreRef) => {
    // genre detail view was removed in the taxonomy refactor; click is a
    // no-op until phase-9 replaces it with a taxon picker.
  };

  return (
    <Show
      when={!favoritesQuery.isError}
      fallback={
        <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
          <div class="text-center max-w-md">
            {favoritesQuery.error instanceof RemoteOfflineError ? (
              <>
                <p class="text-lg text-[var(--color-text-secondary)] mb-2">
                  {(favoritesQuery.error as RemoteOfflineError).remoteName} is offline
                </p>
                <p class="text-sm text-[var(--color-text-muted)]">
                  switch to a different remote or use local library
                </p>
              </>
            ) : (
              <p class="text-lg text-[var(--color-text-secondary)] mb-2">
                failed to load favorites
              </p>
            )}
          </div>
        </div>
      }
    >
      <FavoritesLayout
        favorites={allFavorites()}
        isLoading={favoritesQuery.isLoading || favoritesQuery.isFetching}
        height={containerHeight()}
        onSongClick={handleSongClick}
        onSongPlay={handleSongDoubleClick}
        getSongContextMenuActions={getSongContextMenuActions}
        onSongFavoriteToggle={handleSongFavoriteToggle}
        onAlbumClick={handleAlbumClick}
        onAlbumPlay={handleAlbumPlay}
        getAlbumContextMenuActions={getAlbumContextMenuActions}
        onAlbumFavoriteToggle={handleAlbumFavoriteToggle}
        onArtistClick={handleArtistClick}
        onArtistPlay={handleArtistPlay}
        getArtistContextMenuActions={getArtistContextMenuActions}
        onArtistFavoriteToggle={handleArtistFavoriteToggle}
        onPlaylistClick={handlePlaylistClick}
        onPlaylistPlay={handlePlaylistPlay}
        getPlaylistContextMenuActions={getPlaylistContextMenuActions}
        onPlaylistFavoriteToggle={handlePlaylistFavoriteToggle}
        onArtistNavigate={handleArtistNavigate}
        onAlbumNavigate={handleAlbumNavigate}
        onGenreClick={handleGenreClick}
      />
    </Show>
  );
}
