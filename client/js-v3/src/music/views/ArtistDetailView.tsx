// artist detail view - shows artist info with songs grouped by album
import { useNavigate, useParams } from "@solidjs/router";
import { createMemo, createResource, For, Show } from "solid-js";
import { setQueue } from "../../app/services/storage/db";
import {
  AlbumSection,
  type AlbumSectionSong,
} from "../../components/albums/AlbumSection";
import { Button } from "../../components/buttons/Button";
import { playSong } from "../services/audio/player";
import {
  getArtistById,
  querySongsWithDetails,
  songsVersion,
} from "../services/storage/db";
import type { Song } from "../services/storage/types";
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
}

export function ArtistDetailView() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();

  // fetch artist and songs
  const [data] = createResource(
    () => [params.id, songsVersion()] as const,
    async ([artistId]) => {
      const artist = await getArtistById(artistId);
      if (!artist) return null;

      const songResults = await querySongsWithDetails({ artistId });
      const songs = songResults.map((r) => r.song);

      return {
        artist,
        songs,
      };
    },
  );

  // group songs by album
  const albumGroups = createMemo((): AlbumGroup[] => {
    const d = data();
    if (!d) return [];

    const groups = new Map<string, AlbumGroup>();

    d.songs.forEach((song) => {
      if (!groups.has(song.album_id)) {
        groups.set(song.album_id, {
          albumId: song.album_id,
          albumTitle: song.album_title,
          year: song.year,
          songs: [],
          totalDuration: 0,
        });
      }

      const group = groups.get(song.album_id)!;
      group.songs.push({
        id: song.song_id,
        title: song.title,
        trackNumber: song.track_number,
        discNumber: song.disc_number,
        duration: song.duration_seconds,
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

  const totalSongs = () => data()?.songs.length ?? 0;
  const totalDuration = () =>
    data()?.songs.reduce((sum, song) => sum + song.duration_seconds, 0) ?? 0;

  // play all artist songs
  const handlePlayArtist = async () => {
    const d = data();
    if (!d || d.songs.length === 0) return;

    await setQueue(d.songs);
    await playSong(d.songs[0].song_id);
  };

  // play specific album
  const handlePlayAlbum = async (albumId: string) => {
    const d = data();
    if (!d) return;

    const album = albumGroups().find((g) => g.albumId === albumId);
    if (!album || album.songs.length === 0) return;

    // get actual Song objects for queue
    const albumSongs = d.songs.filter((s) => s.album_id === albumId);
    const sortedSongs = sortSongsCanonical(albumSongs);

    await setQueue(sortedSongs);
    await playSong(sortedSongs[0].song_id);
  };

  // add album to queue
  const handleAddAlbumToQueue = async (albumId: string) => {
    const d = data();
    if (!d) return;

    const albumSongs = d.songs.filter((s) => s.album_id === albumId);
    const sortedSongs = sortSongsCanonical(albumSongs);

    const currentQueue = d.songs ?? [];
    await setQueue([...currentQueue, ...sortedSongs]);
  };

  const handleSongDoubleClick = async (
    song: AlbumSectionSong,
    albumId: string,
  ) => {
    const d = data();
    if (!d) return;

    // set queue to all album songs and play the clicked one
    const albumSongs = d.songs.filter((s) => s.album_id === albumId);
    const sortedSongs = sortSongsCanonical(albumSongs);

    await setQueue(sortedSongs);
    await playSong(song.id);
  };

  const handleAlbumClick = (albumId: string) => {
    navigate(`/albums/${albumId}`);
  };

  return (
    <div class="flex flex-col h-full">
      <Show when={data()} fallback={<div class="p-4">loading...</div>}>
        {(d) => (
          <>
            {/* header with artist info */}
            <div class="flex gap-6 p-6 border-b border-[var(--color-border-default)]">
              {/* artist avatar placeholder */}
              <div class="w-48 h-48 bg-[var(--color-bg-elevated)] rounded-full flex items-center justify-center flex-shrink-0">
                <span class="text-6xl text-[var(--color-text-tertiary)]">
                  {d().artist.name[0].toUpperCase()}
                </span>
              </div>

              {/* artist info */}
              <div class="flex flex-col justify-center gap-2 min-w-0">
                <div class="text-xs uppercase text-[var(--color-text-tertiary)] font-medium tracking-wide">
                  artist
                </div>
                <h1 class="text-4xl font-bold text-[var(--color-text-primary)] truncate">
                  {d().artist.name}
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

                {/* play button */}
                <div class="mt-4">
                  <Button variant="primary" onClick={handlePlayArtist}>
                    play all
                  </Button>
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
                      onAlbumClick={handleAlbumClick}
                      onPlayAlbum={() => handlePlayAlbum(album.albumId)}
                      onAddToQueue={() => handleAddAlbumToQueue(album.albumId)}
                      onSongDoubleClick={(song) =>
                        handleSongDoubleClick(song, album.albumId)
                      }
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
