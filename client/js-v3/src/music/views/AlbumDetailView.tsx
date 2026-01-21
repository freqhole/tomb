// album detail view - shows album info and songs list
import { useNavigate, useParams } from "@solidjs/router";
import { createMemo, For, Show } from "solid-js";
import { setQueue } from "../../app/services/storage/db";
import { Button } from "../../components/buttons/Button";
import { MediaImage } from "../../components/media/MediaImage";
import { SongRow } from "../../components/songs/SongRow";
import { getCurrentRemote, getDataSource } from "../data";
import { useAlbumSongsQuery } from "../queries/songs";
import { playSong } from "../services/audio/player";
import { getAlbumById } from "../services/storage/db";
import type { Song } from "../services/storage/types";
import { getBlobImageUrl } from "../utils/images";
import { buildRoute } from "../utils/routing";
import { sortSongsCanonical } from "../utils/songSort";

// format seconds to MM:SS
function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function AlbumDetailView() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();

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

    await setQueue(songList);
    await playSong(songList[0]);
  };

  const handleSongDoubleClick = async (song: Song) => {
    const songList = songs();
    if (songList.length === 0) return;

    // set queue to all album songs and play the clicked one
    await setQueue(songList);
    await playSong(song);
  };

  const handleArtistClick = () => {
    const info = albumInfo();
    if (!info?.artist_id) return;
    navigate(buildRoute(`/artists/${info.artist_id}`));
  };

  // get album artwork from first song's thumbnail
  const albumArtworkUrl = createMemo(() => {
    const songList = songs();
    if (songList.length === 0) return null;
    // use thumbnail_blob_id from first song (denormalized field)
    return getBlobImageUrl(songList[0].thumbnail_blob_id);
  });

  return (
    <div class="flex flex-col h-full">
      <Show when={albumInfo()} fallback={<div class="p-4">loading...</div>}>
        {(info) => (
          <>
            {/* header with album info */}
            <div class="flex gap-6 p-6 border-b border-[var(--color-border-default)]">
              {/* album artwork */}
              <div class="w-48 h-48 bg-[var(--color-bg-elevated)] rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
                <Show
                  when={albumArtworkUrl()}
                  fallback={
                    <span class="text-[var(--color-text-tertiary)] text-sm">
                      no artwork
                    </span>
                  }
                >
                  <MediaImage
                    imageUrl={albumArtworkUrl()!}
                    alt={info().title}
                    class="w-full h-full object-cover"
                  />
                </Show>
              </div>

              {/* album info */}
              <div class="flex flex-col justify-center gap-2 min-w-0">
                <div class="text-xs uppercase text-[var(--color-text-tertiary)] font-medium tracking-wide">
                  album
                </div>
                <h1 class="text-4xl font-bold text-[var(--color-text-primary)] truncate">
                  {info().title}
                </h1>
                <div class="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
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
                  <span>{formatDuration(totalDuration())}</span>
                </div>

                {/* play button */}
                <div class="mt-4">
                  <Button variant="primary" onClick={handlePlayAlbum}>
                    play album
                  </Button>
                </div>
              </div>
            </div>

            {/* songs list */}
            <div class="flex-1 overflow-auto">
              <div class="p-6 space-y-1">
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
  );
}
