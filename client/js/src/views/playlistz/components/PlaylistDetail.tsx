/* @jsxImportSource solid-js */
import { createSignal, Show, For } from "solid-js";
import type { Playlist, Song } from "../types/playlist.js";
import {
  playPlaylist,
  audioState,
  playSong,
  togglePlayback,
} from "../services/audioService.js";
import { createImageUrlFromData } from "../services/imageService.js";
import { SongRow } from "./SongRow.js";

interface PlaylistDetailProps {
  playlist: Playlist;
  onPlaylistUpdate: (playlist: Playlist | null) => void;
}

export function PlaylistDetail(props: PlaylistDetailProps) {
  const [isEditing, setIsEditing] = createSignal(false);

  const handlePlayPlaylist = async () => {
    const currentPlaylist = audioState.currentPlaylist();

    // If this playlist is already playing, just toggle playback
    if (currentPlaylist?.id === props.playlist.id && audioState.currentSong()) {
      togglePlayback();
    } else {
      // Start playing this playlist from the beginning
      if (props.playlist.songIds?.length > 0) {
        await playPlaylist(props.playlist, 0);
      }
    }
  };

  const handleSongPlay = async (song: Song) => {
    // Check if this song is already the current song
    const currentSong = audioState.currentSong();
    const isPlaying = audioState.isPlaying();
    console.log(
      `🎵 handleSongPlay: clicked=${song.title}, current=${currentSong?.title}, isPlaying=${isPlaying}`
    );

    if (currentSong?.id === song.id) {
      // If it's the same song, just toggle playback (resume/pause)
      console.log("🎵 Same song, toggling playback");
      togglePlayback();
    } else {
      // Different song, load and play it
      console.log("🎵 Different song, loading new song");
      await playSong(song, props.playlist);
    }
  };

  const handleSongPause = () => {
    console.log(
      "🎵 handleSongPause called, isPlaying:",
      audioState.isPlaying()
    );
    if (audioState.isPlaying()) {
      console.log("🎵 Calling togglePlayback from handleSongPause");
      togglePlayback();
    }
  };

  return (
    <div class="h-full p-6 flex flex-col">
      <div class="max-w-4xl mx-auto flex-1 flex flex-col min-h-0">
        {/* Header */}
        <div class="flex items-start space-x-6 mb-8">
          {/* Playlist cover */}
          <div class="flex-shrink-0">
            <div class="w-48 h-48 bg-gray-700 rounded-lg overflow-hidden">
              <Show
                when={(() => {
                  console.log(
                    `🖼️ [DEBUG] PlaylistDetail - playlist:`,
                    props.playlist
                  );
                  console.log(
                    `🖼️ [DEBUG] PlaylistDetail - has imageData:`,
                    !!props.playlist.imageData
                  );
                  console.log(
                    `🖼️ [DEBUG] PlaylistDetail - has imageType:`,
                    !!props.playlist.imageType
                  );
                  console.log(
                    `🖼️ [DEBUG] PlaylistDetail - imageData size:`,
                    props.playlist.imageData?.byteLength
                  );
                  console.log(
                    `🖼️ [DEBUG] PlaylistDetail - imageType:`,
                    props.playlist.imageType
                  );
                  return props.playlist.imageData && props.playlist.imageType;
                })()}
                fallback={
                  <div class="w-full h-full flex items-center justify-center text-gray-400">
                    <svg
                      class="w-16 h-16"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.369 4.369 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
                    </svg>
                  </div>
                }
              >
                <img
                  src={(() => {
                    const url = createImageUrlFromData(
                      props.playlist.imageData!,
                      props.playlist.imageType!
                    );
                    console.log(
                      `🖼️ [DEBUG] PlaylistDetail - created image URL:`,
                      url
                    );
                    return url;
                  })()}
                  alt={props.playlist.title}
                  class="w-full h-full object-cover"
                />
              </Show>
            </div>
          </div>

          {/* Playlist info */}
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between mb-2">
              <h1 class="text-4xl font-bold text-white truncate">
                {props.playlist.title}
              </h1>
              <button
                onClick={() => setIsEditing(!isEditing())}
                class="px-3 py-1 text-sm text-gray-400 hover:text-white border border-gray-600 rounded hover:border-gray-400 transition-colors"
              >
                {isEditing() ? "Cancel" : "Edit"}
              </button>
            </div>

            <Show when={props.playlist.description}>
              <p class="text-gray-300 text-lg mb-4">
                {props.playlist.description}
              </p>
            </Show>

            <div class="flex items-center text-sm text-gray-400 space-x-4">
              <span>
                c reated{" "}
                {new Date(props.playlist.createdAt).toLocaleDateString()}
              </span>
            </div>

            {/* Play/Pause button */}
            <div class="mt-6">
              <button
                onClick={handlePlayPlaylist}
                class="inline-flex items-center justify-center w-16 h-16 bg-magenta-500 hover:bg-magenta-600 rounded-full text-white transition-colors"
                title={
                  audioState.currentPlaylist()?.id === props.playlist.id &&
                  audioState.isPlaying()
                    ? "pause"
                    : "play all"
                }
              >
                <Show
                  when={
                    audioState.currentPlaylist()?.id === props.playlist.id &&
                    audioState.isPlaying()
                  }
                  fallback={
                    <svg
                      class="w-8 h-8 ml-1"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  }
                >
                  <svg class="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fill-rule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
                      clip-rule="evenodd"
                    />
                  </svg>
                </Show>
              </button>
            </div>
          </div>
        </div>

        {/* Songs list */}
        <div class="bg-gray-900 bg-opacity-30 rounded-lg p-6 flex-1 flex flex-col min-h-0">
          <h2 class="text-xl font-semibold mb-4 text-white">songs</h2>

          <Show
            when={(props.playlist.songIds?.length || 0) > 0}
            fallback={
              <div class="text-center py-12">
                <div class="text-gray-400 text-4xl mb-4">🎵</div>
                <p class="text-gray-400 text-lg">
                  no songs in this playlist yet
                </p>
                <p class="text-gray-500 text-sm mt-2">
                  drag and drop audio files here to add them
                </p>
              </div>
            }
          >
            <div class="space-y-2 overflow-y-auto flex-1">
              <For each={props.playlist.songIds || []}>
                {(songId, index) => {
                  return (
                    <SongRow
                      songId={songId}
                      index={index()}
                      onPlay={handleSongPlay}
                      onPause={handleSongPause}
                    />
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
