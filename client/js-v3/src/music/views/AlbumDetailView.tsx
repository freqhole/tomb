// album detail view - shows album info and songs list
import { useNavigate, useParams } from "@solidjs/router";
import { createResource, For, Show } from "solid-js";
import { setQueue } from "../../app/services/storage/db";
import { Button } from "../../components/buttons/Button";
import { SongRow } from "../../components/songs/SongRow";
import { playSong } from "../services/audio/player";
import {
  getAlbumById,
  querySongsWithDetails,
  songsVersion,
} from "../services/storage/db";
import type { Song } from "../services/storage/types";
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

  // fetch album and songs
  const [data] = createResource(
    () => [params.id, songsVersion()] as const,
    async ([albumId]) => {
      const album = await getAlbumById(albumId);
      if (!album) return null;

      const songResults = await querySongsWithDetails({ albumId });
      const songs = songResults.map((r) => r.song);
      const sortedSongs = sortSongsCanonical(songs);

      // calculate total duration
      const totalDuration = sortedSongs.reduce(
        (sum, song) => sum + song.duration_seconds,
        0,
      );

      return {
        album,
        songs: sortedSongs,
        songResults,
        totalDuration,
      };
    },
  );

  // play entire album
  const handlePlayAlbum = async () => {
    const d = data();
    if (!d || d.songs.length === 0) return;

    await setQueue(d.songs);
    await playSong(d.songs[0].song_id);
  };

  const handleSongClick = (song: Song) => {
    // could show song details or other action
  };

  const handleSongDoubleClick = async (song: Song) => {
    const d = data();
    if (!d) return;

    // set queue to all album songs and play the clicked one
    await setQueue(d.songs);
    await playSong(song.song_id);
  };

  const handleArtistClick = () => {
    const d = data();
    if (!d || !d.album.artist_id) return;
    navigate(`/artists/${d.album.artist_id}`);
  };

  return (
    <div class="flex flex-col h-full">
      <Show when={data()} fallback={<div class="p-4">loading...</div>}>
        {(d) => (
          <>
            {/* header with album info */}
            <div class="flex gap-6 p-6 border-b border-[var(--color-border-default)]">
              {/* album artwork placeholder */}
              <div class="w-48 h-48 bg-[var(--color-bg-elevated)] rounded-lg flex items-center justify-center flex-shrink-0">
                <span class="text-[var(--color-text-tertiary)] text-sm">
                  no artwork
                </span>
              </div>

              {/* album info */}
              <div class="flex flex-col justify-center gap-2 min-w-0">
                <div class="text-xs uppercase text-[var(--color-text-tertiary)] font-medium tracking-wide">
                  album
                </div>
                <h1 class="text-4xl font-bold text-[var(--color-text-primary)] truncate">
                  {d().album.title}
                </h1>
                <div class="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                  <button
                    onClick={handleArtistClick}
                    class="hover:text-[var(--color-text-primary)] hover:underline"
                  >
                    {d().songs[0]?.artist_name || "unknown artist"}
                  </button>
                  {d().album.year && (
                    <>
                      <span>•</span>
                      <span>{d().album.year}</span>
                    </>
                  )}
                  <span>•</span>
                  <span>
                    {d().songs.length}{" "}
                    {d().songs.length === 1 ? "song" : "songs"}
                  </span>
                  <span>•</span>
                  <span>{formatDuration(d().totalDuration)}</span>
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
                <For each={d().songs}>
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
