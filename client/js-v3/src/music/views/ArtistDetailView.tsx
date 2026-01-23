// artist detail view - shows artist info with songs grouped by album
import { useNavigate, useParams } from "@solidjs/router";
import { createMemo, For, Show } from "solid-js";
import { setQueue } from "../../app/services/storage/db";
import {
  AlbumSection,
  type AlbumSectionSong,
} from "../../components/albums/AlbumSection";
import { Button } from "../../components/buttons/Button";
import { ContextMenu } from "../../components/overlays/ContextMenu";
import { FavoriteToggle } from "../../components/ratings/FavoriteToggle";
import { getCurrentRemote, getDataSource } from "../data";
import { useArtistQuery, useArtistSongsQuery } from "../queries/songs";
import { playSong } from "../services/audio/player";
import {
  useAlbumContextMenu,
  useArtistContextMenu,
  useSongContextMenu,
} from "../services/contextMenu";
import type { Song } from "../services/storage/types";
import { getBlobImageUrl } from "../utils/images";
import { buildRoute } from "../utils/routing";
import { sortSongsCanonical } from "../utils/songSort";

// format album duration to human readable
function formatAlbumDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

interface AlbumGroup {
  albumId: string;
  albumTitle: string;
  year: number | null;
  songs: AlbumSectionSong[];
  totalDuration: number;
  artworkUrl: string | null;
  isFavorite: boolean;
}

export function ArtistDetailView() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();

  // fetch artist entity to get favorite status and metadata
  const artistQuery = useArtistQuery(() => params.id);

  // fetch artist songs using tanstack query (works with local + remote)
  const artistSongsQuery = useArtistSongsQuery(() => params.id);

  // map to song array
  const songs = createMemo(() => {
    const result = artistSongsQuery.data;
    if (!result || result.items.length === 0) return [];
    return result.items;
  });

  // for remote sources, extract artist info from first song
  // for local sources, use song metadata
  const artistInfo = createMemo(() => {
    const songList = songs();
    if (songList.length === 0) return null;

    const firstSong = songList[0];
    return {
      artist_id: firstSong.artist_id,
      name: firstSong.artist_name,
    };
  });

  // group songs by album
  const albumGroups = createMemo((): AlbumGroup[] => {
    const songList = songs();
    if (songList.length === 0) return [];

    const groups = new Map<string, AlbumGroup>();

    songList.forEach((song) => {
      if (!groups.has(song.album_id)) {
        groups.set(song.album_id, {
          albumId: song.album_id,
          albumTitle: song.album_title,
          year: song.year,
          songs: [],
          totalDuration: 0,
          artworkUrl: getBlobImageUrl(song.thumbnail_blob_id),
          isFavorite: song.album_is_favorite ?? false,
        });
      }

      const group = groups.get(song.album_id)!;
      group.songs.push({
        id: song.id,
        sha256: song.sha256,
        title: song.title,
        trackNumber: song.track_number,
        discNumber: song.disc_number,
        duration: song.duration_seconds,
        isFavorite: song.is_favorite,
      });
      group.totalDuration += song.duration_seconds;
    });

    // sort albums by title
    const sortedGroups = Array.from(groups.values()).sort((a, b) =>
      a.albumTitle.localeCompare(b.albumTitle),
    );

    // songs are already sorted by disc/track when we convert them
    sortedGroups.forEach((group) => {
      group.songs.sort((a, b) => {
        if (a.discNumber !== b.discNumber) {
          return a.discNumber - b.discNumber;
        }
        return a.trackNumber - b.trackNumber;
      });
    });

    return sortedGroups;
  });

  const totalSongs = () => songs().length ?? 0;
  const totalDuration = () =>
    songs().reduce((sum, song) => sum + song.duration_seconds, 0) ?? 0;

  // play all artist songs
  const handlePlayArtist = async () => {
    const songList = songs();
    if (songList.length === 0) return;

    await setQueue(songList);
    await playSong(songList[0]);
  };

  // shuffle all songs
  const handleShuffleArtist = async () => {
    const songList = songs();
    if (songList.length === 0) return;

    const shuffled = [...songList].sort(() => Math.random() - 0.5);
    await setQueue(shuffled);
    await playSong(shuffled[0]);
  };

  // add all songs to queue
  const handleAddArtistToQueue = async () => {
    const songList = songs();
    if (songList.length === 0) return;

    const currentQueue = songs() ?? [];
    await setQueue([...currentQueue, ...songList]);
  };

  // context menu for artist avatar
  const artistContextMenuActions = createMemo(() => {
    const info = artistInfo();
    if (!info) return [];

    return useArtistContextMenu(
      {
        id: info.artist_id,
        name: info.name,
        song_count: totalSongs(),
      },
      {
        showPlayActions: false, // we have buttons for this
        onPlayAll: handlePlayArtist,
        onShuffle: handleShuffleArtist,
        onAddToQueue: handleAddArtistToQueue,
        isFavorite: artistQuery.data?.is_favorite ?? false,
      },
    );
  });

  // play specific album
  const handlePlayAlbum = async (albumId: string) => {
    const album = albumGroups().find((g) => g.albumId === albumId);
    if (!album || album.songs.length === 0) return;

    // get actual Song objects for queue
    const albumSongs = songs().filter((s) => s.album_id === albumId);
    const sortedSongs = sortSongsCanonical(albumSongs);

    await setQueue(sortedSongs);
    await playSong(sortedSongs[0]);
  };

  // add album to queue
  const handleAddAlbumToQueue = async (albumId: string) => {
    const albumSongs = songs().filter((s) => s.album_id === albumId);
    const sortedSongs = sortSongsCanonical(albumSongs);

    const currentQueue = songs() ?? [];
    await setQueue([...currentQueue, ...sortedSongs]);
  };

  const handleSongDoubleClick = async (
    song: AlbumSectionSong,
    albumId: string,
  ) => {
    // set queue to all album songs and play the clicked one
    const albumSongs = songs().filter((s) => s.album_id === albumId);
    const sortedSongs = sortSongsCanonical(albumSongs);

    await setQueue(sortedSongs);
    await playSong(song.id);
  };

  const handleAlbumClick = (albumId: string) => {
    navigate(buildRoute(`/albums/${albumId}`));
  };

  return (
    <div class="flex flex-col h-full">
      <Show when={artistInfo()} fallback={<div class="p-4">loading...</div>}>
        {(info) => (
          <>
            {/* header with artist info */}
            <div class="flex gap-6 p-6">
              {/* artist avatar placeholder */}
              <ContextMenu actions={artistContextMenuActions()}>
                <div class="w-48 h-48 bg-[var(--color-bg-elevated)] rounded-full flex items-center justify-center flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity">
                  <span class="text-6xl text-[var(--color-text-tertiary)]">
                    {info().name[0].toUpperCase()}
                  </span>
                </div>
              </ContextMenu>

              {/* artist info */}
              <div class="flex flex-col justify-center gap-2 min-w-0">
                <div class="text-xs uppercase text-[var(--color-text-tertiary)] font-medium tracking-wide">
                  artist
                </div>
                <h1 class="text-4xl font-bold text-[var(--color-text-primary)] truncate">
                  {info().name}
                </h1>
                <div class="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                  <span>
                    {albumGroups().length}{" "}
                    {albumGroups().length === 1 ? "album" : "albums"}
                  </span>
                  <span>•</span>
                  <span>
                    {totalSongs()} {totalSongs() === 1 ? "song" : "songs"}
                  </span>
                  <span>•</span>
                  <span>{formatAlbumDuration(totalDuration())}</span>
                </div>

                {/* play button and favorite toggle */}
                <div class="mt-4 flex items-center gap-3">
                  <Button variant="primary" onClick={handlePlayArtist}>
                    play all
                  </Button>
                  <FavoriteToggle
                    targetType="artist"
                    targetId={info().artist_id}
                    isFavorite={artistQuery.data?.is_favorite ?? false}
                  />
                </div>
              </div>
            </div>

            {/* albums list with songs */}
            <div class="flex-1 overflow-auto">
              <div class="p-6 space-y-6">
                <For each={albumGroups()}>
                  {(album) => (
                    <AlbumSection
                      albumId={album.albumId}
                      albumTitle={album.albumTitle}
                      year={album.year}
                      songs={album.songs}
                      totalDuration={album.totalDuration}
                      artworkUrl={album.artworkUrl}
                      isFavorite={album.isFavorite}
                      onAlbumClick={handleAlbumClick}
                      onPlayAlbum={() => handlePlayAlbum(album.albumId)}
                      onAddToQueue={() => handleAddAlbumToQueue(album.albumId)}
                      onSongDoubleClick={(song) =>
                        handleSongDoubleClick(song, album.albumId)
                      }
                      getAlbumContextMenuActions={() =>
                        useAlbumContextMenu(
                          {
                            id: album.albumId,
                            title: album.albumTitle,
                            song_count: album.songs.length,
                          },
                          {
                            showPlayActions: true,
                            isFavorite: false, // album-level favorites not yet implemented on frontend
                          },
                        )
                      }
                      getSongContextMenuActions={(song) => {
                        // find full song data
                        const fullSong = songs().find((s) => s.id === song.id);
                        if (!fullSong) return [];
                        return useSongContextMenu(fullSong, {
                          showPlayActions: true,
                          isFavorite: fullSong.is_favorite ?? false,
                        });
                      }}
                    />
                  )}
                </For>
              </div>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
