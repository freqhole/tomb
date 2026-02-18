// album detail view - shows album info and songs list
import { useNavigate, useParams } from "@solidjs/router";
import { createMemo, For, Show } from "solid-js";
import { useQueryClient } from "@tanstack/solid-query";
import { playQueue } from "../services/queue/queue";
import { Button } from "../../components/buttons/Button";
import { Icon, IconNames } from "../../components/icons/registry";
import { DetailViewWrapper } from "../../components/layout/DetailViewWrapper";
import { MediaImage } from "../../components/media/MediaImage";
import { ContextMenu } from "../../components/overlays/ContextMenu";
import { FavoriteHeart } from "../../components/ratings/FavoriteHeart";
import { Rating } from "../../components/ratings/Rating";
import { SongRow } from "../../components/songs/SongRow";
import { formatDuration, formatLongDuration } from "../../utils/formatDuration";
import { getCurrentRemote, getDataSource } from "../data";
import { showAlbumEditor, showImageCarousel } from "../hooks/modals";
import { useAlbumQuery, useAlbumSongsQuery } from "../queries/songs";
import { useSetRatingMutation } from "../queries/ratings";
import { useToggleFavoriteMutation } from "../queries/favorites";
import { queryKeys } from "../queries/queryKeys";
import { useAlbumContextMenu, useSongContextMenu } from "../hooks/contextMenu";
import { getAlbumById } from "../services/storage/db";
import type { Song } from "../services/storage/types";
import { buildRoute } from "../utils/routing";
import { sortSongsCanonical } from "../utils/songSort";

export function AlbumDetailView() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // fetch album entity to get favorite status and metadata
  const albumQuery = useAlbumQuery(() => params.id);

  // rating mutation
  const setRatingMutation = useSetRatingMutation();

  // favorite mutation
  const toggleFavoriteMutation = useToggleFavoriteMutation();

  // handle song rating change
  const handleSongRatingChange = (songId: string, rating: number) => {
    setRatingMutation.mutate({
      targetType: "song",
      targetId: songId,
      rating,
    });
  };

  // handle album favorite toggle
  const handleAlbumFavoriteToggle = (isFavorite: boolean) => {
    const album = albumQuery.data;
    // use the album's actual album_id for the mutation (to update the correct record in storage)
    // but we also need to update the query cache which is keyed by params.id
    const albumId = album?.album_id || params.id;
    toggleFavoriteMutation.mutate(
      {
        targetType: "album",
        targetId: albumId,
        isFavorite,
      },
      {
        onSuccess: () => {
          // manually update the query cache using the route param id (the query key)
          queryClient.setQueryData(queryKeys.albums.detail(params.id), (old: any) =>
            old ? { ...old, is_favorite: isFavorite } : old
          );
        },
      }
    );
  };

  // handle song favorite toggle
  const handleSongFavoriteToggle = (songId: string, isFavorite: boolean) => {
    const song = songs().find((s) => s.id === songId);
    toggleFavoriteMutation.mutate({
      targetType: "song",
      targetId: songId,
      sha256: song?.sha256,
      isFavorite,
    });
  };

  // fetch album songs using tanstack query (works with local + remote)
  const albumSongsQuery = useAlbumSongsQuery(() => params.id);

  // map and sort songs
  const songs = createMemo(() => {
    const result = albumSongsQuery.data;
    if (!result || result.items.length === 0) return [];
    return sortSongsCanonical(result.items);
  });

  // calculate total duration
  const totalDuration = createMemo(() => {
    return songs().reduce((sum, song) => sum + song.duration_seconds, 0);
  });

  // for remote sources, extract album info from first song
  // for local sources, query album metadata
  const albumInfo = createMemo(() => {
    const songList = songs();
    if (songList.length === 0) return null;

    const firstSong = songList[0];
    return {
      album_id: firstSong.album_id,
      title: firstSong.album_title,
      artist_id: firstSong.artist_id,
      year: firstSong.year,
    };
  });

  // play entire album
  const handlePlayAlbum = async () => {
    const songList = songs();
    if (songList.length === 0) return;
    const info = albumInfo();
    await playQueue(songList, {
      source: { type: "album", label: info?.title ?? "album", entity_id: info?.album_id },
    });
  };

  const handleSongDoubleClick = async (song: Song) => {
    const songList = songs();
    if (songList.length === 0) return;

    // set queue to all album songs and play the clicked one
    const startIndex = songList.findIndex((s) => s.sha256 === song.sha256);
    const info = albumInfo();
    await playQueue(songList, {
      startIndex: Math.max(0, startIndex),
      source: { type: "album", label: info?.title ?? "album", entity_id: info?.album_id },
    });
  };

  const handleArtistClick = () => {
    const info = albumInfo();
    if (!info?.artist_id) return;
    navigate(buildRoute(`/artists/${info.artist_id}`));
  };

  // get album artwork from first song's album_images
  const albumArtworkUrl = createMemo(() => {
    const songList = songs();
    if (songList.length === 0) return null;
    // use album_images to construct URL
    const images = songList[0].album_images;
    if (!images?.length) return null;
    const primaryImage = images.find((img) => img.is_primary) || images[0];
    return primaryImage.remote_url || null;
  });

  // context menu for album image
  const albumContextMenuActions = createMemo(() => {
    const info = albumInfo();
    if (!info) return [];

    return useAlbumContextMenu(
      {
        id: info.album_id || params.id,
        title: info.title || "",
        artist_name: songs()[0]?.artist_name,
        artist_id: info.artist_id,
        song_count: songs().length,
      },
      {
        showPlayActions: true,
        isFavorite: albumQuery.data?.is_favorite ?? false,
      }
    );
  });

  // open image carousel with all album + song images (no waveforms)
  const handleAlbumImageClick = () => {
    const imageUrls: string[] = [];
    const seen = new Set<string>();

    const addImage = (img: { remote_url?: string; local_blob_id?: string; blob_type: string }) => {
      if (img.blob_type === "waveform") return;
      const url = img.remote_url || img.local_blob_id;
      if (url && !seen.has(url)) {
        seen.add(url);
        imageUrls.push(url);
      }
    };

    // album images from the album entity (same source as edit modal)
    const albumImages = albumQuery.data?.images;
    if (albumImages?.length) {
      for (const img of albumImages) addImage(img);
    }

    // also collect from song-level album_images as fallback
    const songList = songs();
    const firstSongAlbumImages = songList[0]?.album_images;
    if (firstSongAlbumImages?.length) {
      for (const img of firstSongAlbumImages) addImage(img);
    }

    // collect song images across all songs
    for (const song of songList) {
      if (song.images?.length) {
        for (const img of song.images) addImage(img);
      }
    }

    if (imageUrls.length === 0) return;

    showImageCarousel({
      images: imageUrls,
      title: `${albumInfo()?.title || "album"} images`,
    });
  };

  // context menu for song rows
  const getSongContextMenuActions = (song: Song) => {
    return useSongContextMenu(song, {
      showPlayActions: true,
      isFavorite: song.is_favorite ?? false,
    });
  };

  return (
    <DetailViewWrapper pageTitle="album" pageCount={songs().length} onBack={buildRoute("/albums")}>
      <div class="flex flex-col h-full">
        <Show when={albumInfo()} fallback={<div class="p-4">loading...</div>}>
          {(info) => (
            <>
              {/* header with album info - responsive layout */}
              <div class="flex flex-col justify-between md:flex-row gap-4 md:gap-6 p-4 md:p-6">
                {/* album info */}
                <div class="flex flex-col justify-center gap-1 min-w-0 text-center md:mt-[50px] md:gap-2 md:text-left">
                  <h1 class="text-2xl md:text-5xl font-bold text-[var(--color-text-primary)] truncate">
                    {info().title}
                  </h1>
                  <div class="flex flex-wrap items-center justify-center md:justify-start gap-x-2 gap-y-1 text-sm md:text-xl text-[var(--color-text-secondary)]">
                    <button
                      onClick={handleArtistClick}
                      class="hover:text-[var(--color-text-primary)] hover:underline"
                    >
                      {songs()[0]?.artist_name || "unknown artist"}
                    </button>
                    {info().year && (
                      <>
                        <span>•</span>
                        <span>{info().year}</span>
                      </>
                    )}
                    <span>•</span>
                    <span>
                      {songs().length} {songs().length === 1 ? "song" : "songs"}
                    </span>
                    <span>•</span>
                    <span>{formatLongDuration(totalDuration())}</span>
                  </div>

                  {/* genres and tags */}
                  <Show
                    when={
                      (songs()[0]?.album_genres?.length ?? 0) > 0 ||
                      (songs()[0]?.album_tags?.length ?? 0) > 0
                    }
                  >
                    <div class="flex flex-wrap gap-1.5 justify-center md:justify-start mt-1">
                      <For each={songs()[0]?.album_genres ?? []}>
                        {(genre) => (
                          <button
                            class="px-2 py-0.5 bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] rounded-full text-xs transition-colors hover:bg-[var(--color-bg-hover)] cursor-pointer"
                            onClick={() => navigate(buildRoute(`/genres/${genre.id}`))}
                          >
                            {genre.name}
                          </button>
                        )}
                      </For>
                      <For each={songs()[0]?.album_tags ?? []}>
                        {(tag) => (
                          <span class="px-2 py-0.5 bg-[var(--color-accent-primary)]/10 text-[var(--color-accent-primary)] rounded-full text-xs">
                            #{tag}
                          </span>
                        )}
                      </For>
                    </div>
                  </Show>

                  {/* play button, edit button, and favorite toggle */}
                  <div class="mt-3 md:mt-4 flex items-center justify-center md:justify-start gap-2 md:gap-3">
                    <Button variant="primary" onClick={handlePlayAlbum}>
                      <span class="hidden md:inline">play album</span>
                      <span class="md:hidden">play</span>
                    </Button>
                    <button
                      onClick={() =>
                        showAlbumEditor({
                          albumId: info().album_id || params.id,
                          onMergeNavigate: (newAlbumId) => navigate(`/albums/${newAlbumId}`),
                        })
                      }
                      class="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded transition-colors"
                      title="edit album info"
                    >
                      <Icon name={IconNames.edit} />
                    </button>
                    <FavoriteHeart
                      isFavorite={albumQuery.data?.is_favorite ?? false}
                      onToggle={handleAlbumFavoriteToggle}
                    />
                    <Rating
                      rating={albumQuery.data?.user_rating ?? 0}
                      size="md"
                      onRatingChange={(rating) => {
                        setRatingMutation.mutate({
                          targetType: "album",
                          targetId: info().album_id || params.id,
                          rating,
                        });
                      }}
                    />
                  </div>
                </div>

                {/* album artwork */}
                <ContextMenu actions={albumContextMenuActions()}>
                  <div
                    class="w-32 h-32 md:w-64 md:h-64 mx-auto md:mx-0 bg-[var(--color-bg-elevated)] rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden cursor-pointer hover:border-l-[var(--color-accent-500)] border-transparent border-2"
                    title="view album images"
                    onClick={handleAlbumImageClick}
                  >
                    <MediaImage
                      images={songs()[0]?.album_images}
                      imageUrl={albumArtworkUrl() || null}
                      alt={info().title}
                      class="w-full h-full object-cover"
                      domainType="album"
                    />
                  </div>
                </ContextMenu>
              </div>

              {/* songs list */}
              <div class="flex-1 overflow-auto">
                <div class="px-4 md:px-6 py-2 md:py-4 space-y-1">
                  <For each={songs()}>
                    {(song) => {
                      const trackDisplay =
                        song.disc_number > 1
                          ? `${song.disc_number}-${song.track_number}`
                          : song.track_number;

                      return (
                        <SongRow
                          title={song.title}
                          trackNumber={trackDisplay}
                          duration={formatDuration(song.duration_seconds)}
                          onDoubleClick={() => handleSongDoubleClick(song)}
                          showPlayOnHover={true}
                          contextMenuActions={getSongContextMenuActions(song)}
                          isFavorite={song.is_favorite}
                          rating={song.user_rating}
                          onRatingChange={(rating) => handleSongRatingChange(song.id, rating)}
                          onFavoriteToggle={(isFavorite) =>
                            handleSongFavoriteToggle(song.id, isFavorite)
                          }
                          songId={song.id}
                          sha256={song.sha256}
                        />
                      );
                    }}
                  </For>
                </div>
              </div>
            </>
          )}
        </Show>
      </div>
    </DetailViewWrapper>
  );
}
