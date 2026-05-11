// album detail view - shows album info and songs list
import { useNavigate, useParams, useSearchParams } from "@solidjs/router";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { useQueryClient } from "@tanstack/solid-query";
import { appState } from "../../app/services/storage/db";
import { playQueue } from "../services/queue/queue";
import { highlightedSongId, setHighlightedSongId } from "../state/highlightedSong";
import { Button } from "../../components/buttons/Button";
import { Icon, IconNames } from "../../components/icons/registry";
import { DetailViewWrapper } from "../../components/layout/DetailViewWrapper";
import { MediaImage } from "../../components/media/MediaImage";
import { ContextMenu } from "../../components/overlays/ContextMenu";
import { FavoriteHeart } from "../../components/ratings/FavoriteHeart";
import { Rating } from "../../components/ratings/Rating";
import { SongRow } from "../../components/songs/SongRow";
import { formatDuration, formatLongDuration } from "../../utils/formatDuration";
import { canUpdateAlbum } from "../data/permissions";
import { showAlbumEditor, showImageCarousel } from "../hooks/modals";
import { useAlbumQuery, useAlbumSongsQuery } from "../queries/songs";
import { useSetRatingMutation } from "../queries/ratings";
import { useToggleFavoriteMutation } from "../queries/favorites";
import { queryKeys } from "../queries/queryKeys";
import { useAlbumContextMenu, useSongContextMenu } from "../hooks/contextMenu";
import type { Song } from "../services/storage/types";
import type { ImageMetadata } from "../services/storage/types";
import { buildRoute } from "../utils/routing";
import { sortSongsCanonical } from "../utils/songSort";
import { EntityLinks } from "../../components/media/EntityLinks";
import { TaxonChipList } from "../../components/badges/TaxonChips";
import MarqueeText from "../../components/text/MarqueeText";
import { resolveBlobUrl, usesBlobResolver } from "../services/storage/blobResolver";
import { ShareButton } from "../../components/buttons/ShareButton";
import { createCurrentRemoteFull } from "../../app/services/remotes/currentRemoteFull";
import type { SendPayload } from "../services/send/sendToRemote";
import type { RemoteSong } from "../data/remote/adapters";
import { isCharnelMode } from "../../app/services/charnel";
import { showStationSelector } from "../hooks/stationSelectorState";
import { getCurrentRemote } from "../data";

export function AlbumDetailView() {
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
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

  // optional deep-link support: /albums/:id?song_id=... to focus/highlight
  // a specific song row after navigation from shares/playerbar.
  createEffect(() => {
    const raw = searchParams.song_id;
    const songId = Array.isArray(raw) ? raw[0] : raw;
    if (typeof songId !== "string") return;
    const trimmed = songId.trim();
    if (!trimmed) return;
    setHighlightedSongId(trimmed);
  });

  // current remote (full Remote record) — used as the source for "send to remote".
  const currentRemoteFull = createCurrentRemoteFull();

  // build a SendPayload describing this album for the send-to-remote flyout.
  const buildSendPayload = (): SendPayload => {
    const songList = songs();
    const info = albumInfo();
    return {
      kind: "album",
      albumId: info?.album_id ?? params.id,
      title: info?.title ?? songList[0]?.album_title ?? "unknown album",
      artistName: songList[0]?.artist_name ?? "unknown artist",
      albumType: songList[0]?.album_type ?? null,
      releaseDate: null,
      label: null,
      genres: songList[0]?.album_genres?.map((g) => g.name).filter(Boolean) ?? [],
      songs: songList as unknown as RemoteSong[],
    };
  };

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
  const handleAlbumImageClick = async () => {
    const seen = new Set<string>();
    const imageItems: Array<{ blobId?: string; url?: string; serverId?: string }> = [];

    const addImage = (img: ImageMetadata) => {
      if (img.blob_type === "waveform") return;
      const key = img.remote_blob_id || img.local_blob_id || img.remote_url;
      if (!key || seen.has(key)) return;
      seen.add(key);
      imageItems.push({
        blobId: img.remote_blob_id || img.local_blob_id,
        url: img.remote_url,
        serverId: img.remote_server_id,
      });
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

    if (imageItems.length === 0) return;

    // check if we need blob resolution (P2P or tauri-managed)
    const firstWithServerId = imageItems.find((item) => item.serverId);
    const needsResolution = firstWithServerId
      ? await usesBlobResolver(firstWithServerId.serverId!)
      : false;

    let imageUrls: string[];
    if (needsResolution) {
      // resolve all images via blobResolver
      imageUrls = (
        await Promise.all(
          imageItems.map(async (item) => {
            if (item.blobId && item.serverId) {
              try {
                return await resolveBlobUrl(item.blobId, item.serverId, "image");
              } catch {
                return item.url ?? null;
              }
            }
            return item.url ?? null;
          })
        )
      ).filter((u): u is string => u !== null);
    } else {
      // standard HTTP - use URLs directly
      imageUrls = imageItems.map((item) => item.url).filter((u): u is string => !!u);
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

  // genres/tags overflow state (collapse to 2 lines on narrow screens)
  const [tagsExpanded, setTagsExpanded] = createSignal(false);
  const [tagsOverflowing, setTagsOverflowing] = createSignal(false);

  // reset when album changes
  createEffect(() => {
    params.id;
    setTagsExpanded(false);
  });

  return (
    <DetailViewWrapper pageTitle="album" pageCount={songs().length} onBack={buildRoute("/albums")}>
      <div class="flex flex-col h-full">
        <Show when={albumInfo()} fallback={<div class="p-4">loading...</div>}>
          {(info) => (
            <>
              {/* header with album info - responsive layout */}
              <div class="flex flex justify-between px-1 wide:gap-6 wide:p-6">
                {/* album info */}
                <div class="flex flex-col justify-center min-w-0 wide:mt-[50px] wide:gap-2 wide:text-left">
                  <h1 class="text-2xl wide:text-5xl font-bold text-[var(--color-text-primary)]">
                    <MarqueeText text={info().title} class="pb-1" />
                  </h1>
                  <div class="flex flex-col wide:flex-wrap gap-y-0.5 wide:gap-x-2 wide:gap-y-1 wide:text-xl text-[var(--color-text-secondary)]">
                    <button
                      onClick={handleArtistClick}
                      class="hover:text-[var(--color-text-primary)] hover:underline text-left"
                    >
                      <MarqueeText text={songs()[0]?.artist_name || "unknown artist"} />
                    </button>
                    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      {info().year && <span>{info().year}</span>}
                      <span>•</span>
                      <span>
                        {songs().length} {songs().length === 1 ? "song" : "songs"}
                      </span>
                      <span>•</span>
                      <span>{formatLongDuration(totalDuration())}</span>
                    </div>
                  </div>

                  {/* genres, tags, and links — collapsed to 2 lines on narrow screens */}
                  <Show
                    when={
                      (songs()[0]?.album_genres?.length ?? 0) > 0 ||
                      (songs()[0]?.album_taxons?.length ?? 0) > 0 ||
                      (songs()[0]?.album_tags?.length ?? 0) > 0 ||
                      (albumQuery.data?.urls?.length ?? 0) > 0
                    }
                  >
                    <div class="mt-1">
                      <div
                        ref={(el) => {
                          const check = () => {
                            if (!tagsExpanded()) {
                              setTagsOverflowing(el.scrollHeight > el.clientHeight);
                            }
                          };
                          requestAnimationFrame(check);
                          const obs = new ResizeObserver(check);
                          obs.observe(el);
                        }}
                        class={`flex flex-wrap gap-1.5 wide:justify-start ${
                          !tagsExpanded() ? "max-h-[3.25rem] overflow-hidden wide:max-h-none" : ""
                        }`}
                      >
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
                        {/* non-genre taxons (label, mood, era, region, ...) */}
                        <TaxonChipList taxons={songs()[0]?.album_taxons} excludeKinds={["genre"]} />
                        <For each={songs()[0]?.album_tags ?? []}>
                          {(tag) => (
                            <span class="px-2 py-0.5 bg-[var(--color-accent-primary)]/10 text-[var(--color-accent-primary)] rounded-full text-xs">
                              #{tag}
                            </span>
                          )}
                        </For>
                        <EntityLinks urls={albumQuery.data?.urls} />
                      </div>
                      <Show when={tagsOverflowing() || tagsExpanded()}>
                        <button
                          onClick={() => setTagsExpanded((v) => !v)}
                          class="pb-2 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] wide:hidden"
                        >
                          {tagsExpanded() ? "see less" : "see more"}
                        </button>
                      </Show>
                    </div>
                  </Show>

                  {/* play button, edit button, and favorite toggle */}
                  <div class="mt-0 wide:mt-4 flex items-center wide:justify-start gap-2 wide:gap-3">
                    <Button variant="primary" onClick={handlePlayAlbum}>
                      <span class="hidden wide:inline">play album</span>
                      <span class="wide:hidden">play</span>
                    </Button>
                    <Show when={isCharnelMode() || !!getCurrentRemote()}>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          void showStationSelector(
                            {
                              kind: "album",
                              albumId: albumInfo()?.album_id ?? params.id,
                              albumTitle: albumInfo()?.title ?? "",
                            },
                            getCurrentRemote()?.remote_id
                          )
                        }
                      >
                        +radio
                      </Button>
                    </Show>
                    <Show when={canUpdateAlbum()}>
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
                    </Show>
                    <FavoriteHeart
                      isFavorite={albumQuery.data?.is_favorite ?? false}
                      onToggle={handleAlbumFavoriteToggle}
                    />
                    <ShareButton
                      target={{
                        kind: "album",
                        id: albumInfo()?.album_id ?? params.id,
                        displayTitle: albumInfo()?.title ?? "",
                      }}
                      source={() => currentRemoteFull()}
                      buildSendPayload={buildSendPayload}
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
                    class="relative group w-32 h-32 wide:w-64 wide:h-64 mx-auto wide:mx-0 bg-[var(--color-bg-elevated)] rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden cursor-pointer hover:border-l-[var(--color-accent-500)] border-transparent border-2"
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
                    <div class="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <Icon
                        name={IconNames.carousel}
                        size={32}
                        className="text-white drop-shadow-lg"
                      />
                    </div>
                  </div>
                </ContextMenu>
              </div>

              {/* songs list */}
              <div class="flex-1 overflow-auto">
                <div class="px-4 wide:px-6 py-2 wide:py-4 space-y-1">
                  <For each={songs()}>
                    {(song) => {
                      const trackDisplay =
                        song.disc_number > 1
                          ? `${song.disc_number}-${song.track_number}`
                          : song.track_number;

                      const isHighlighted = () => highlightedSongId() === song.id;
                      const isPlaying = () => appState()?.current_sha256 === song.sha256;
                      let rowEl!: HTMLDivElement;

                      createEffect(() => {
                        if (isHighlighted()) {
                          rowEl.scrollIntoView({ behavior: "smooth", block: "center" });
                        }
                      });

                      return (
                        <div ref={rowEl}>
                          <SongRow
                            title={song.title}
                            artist={
                              song.album_type === "compilation" && song.track_artist?.trim()
                                ? song.track_artist
                                : undefined
                            }
                            trackNumber={trackDisplay}
                            duration={formatDuration(song.duration_seconds)}
                            playCount={song.play_count ?? null}
                            isPlaying={isPlaying()}
                            onDoubleClick={() => handleSongDoubleClick(song)}
                            showPlayOnHover={true}
                            contextMenuActions={getSongContextMenuActions(song)}
                            isFavorite={song.is_favorite}
                            isHighlighted={isHighlighted()}
                            rating={song.user_rating}
                            onRatingChange={(rating) => handleSongRatingChange(song.id, rating)}
                            onFavoriteToggle={(isFavorite) =>
                              handleSongFavoriteToggle(song.id, isFavorite)
                            }
                            songId={song.id}
                            sha256={song.sha256}
                          />
                        </div>
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
