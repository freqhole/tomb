/* @jsxImportSource solid-js */
import { createSignal, createEffect, onMount, onCleanup, Show } from "solid-js";
import { setupDB, createPlaylist } from "../services/indexedDBService.js";
import { usePlaylistsQuery } from "../hooks/usePlaylistsQuery.js";
import { cleanup as cleanupAudio } from "../services/audioService.js";
import {
  filterAudioFiles,
  processAudioFiles,
} from "../services/fileProcessingService.js";
import { addSongToPlaylist } from "../services/indexedDBService.js";
import { cleanupTimeUtils } from "../utils/timeUtils.js";

import type { Playlist } from "../types/playlist.js";

export function Playlistz() {
  // State
  const [selectedPlaylist, setSelectedPlaylist] = createSignal<Playlist | null>(
    null
  );
  const [isDragOver, setIsDragOver] = createSignal(false);
  const [isInitialized, setIsInitialized] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Reactive queries - use SolidJS hook for proper reactivity
  const playlists = usePlaylistsQuery();

  // Auto-clear errors after 5 seconds
  createEffect(() => {
    const errorMessage = error();
    if (errorMessage) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
    return undefined;
  });

  // Initialize database
  onMount(async () => {
    try {
      await setupDB();
      setIsInitialized(true);
      console.log("✅ Playlistz initialized with IndexedDB");
    } catch (err) {
      console.error("❌ Failed to initialize Playlistz:", err);
      setError(err instanceof Error ? err.message : "failed to initialize");
    }
  });

  // Cleanup on unmount
  onCleanup(() => {
    cleanupAudio();
    cleanupTimeUtils();
  });

  // Global drag and drop handlers
  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const items = e.dataTransfer?.items;
    if (items) {
      const hasAudioFiles = Array.from(items).some(
        (item) => item.kind === "file" && item.type.startsWith("audio/")
      );
      if (hasAudioFiles) {
        setIsDragOver(true);
      }
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Only hide overlay if leaving the root element
    if (e.target === e.currentTarget) {
      setIsDragOver(false);
    }
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer?.files;
    if (!files) return;

    const audioFiles = filterAudioFiles(files);
    if (audioFiles.length === 0) {
      setError("no audio files found in the dropped items");
      setTimeout(() => setError(null), 3000);
      return;
    }

    try {
      let targetPlaylist = selectedPlaylist();

      // If no playlist is selected, create a new one
      if (!targetPlaylist) {
        targetPlaylist = await createPlaylist({
          title: "new playlist",
          description: `created from ${audioFiles.length} dropped file${audioFiles.length > 1 ? "s" : ""}`,
          songIds: [],
        });
        setSelectedPlaylist(targetPlaylist);
      }

      // Process files and add to playlist
      const results = await processAudioFiles(audioFiles);
      const successfulFiles = results.filter((r) => r.success);

      // Actually add the songs to the playlist in IndexedDB
      for (const result of successfulFiles) {
        if (result.song) {
          await addSongToPlaylist(targetPlaylist.id, result.song.file, {
            title: result.song.title,
            artist: result.song.artist,
            album: result.song.album,
            duration: result.song.duration,
            image: result.song.image,
          });
        }
      }

      console.log(
        `✅ Added ${successfulFiles.length}/${audioFiles.length} files to playlist`
      );

      if (results.some((r) => !r.success)) {
        const errorCount = results.filter((r) => !r.success).length;
        setError(
          `${errorCount} file${errorCount > 1 ? "s" : ""} could not be processed`
        );
      }
    } catch (err) {
      console.error("Error handling dropped files:", err);
      setError("failed to process dropped files");
    }
  };

  // Set up global drag and drop listeners
  createEffect(() => {
    if (!isInitialized()) return;

    const root = document.documentElement;

    root.addEventListener("dragenter", handleDragEnter);
    root.addEventListener("dragover", handleDragOver);
    root.addEventListener("dragleave", handleDragLeave);
    root.addEventListener("drop", handleDrop);

    onCleanup(() => {
      root.removeEventListener("dragenter", handleDragEnter);
      root.removeEventListener("dragover", handleDragOver);
      root.removeEventListener("dragleave", handleDragLeave);
      root.removeEventListener("drop", handleDrop);
    });
  });

  // Handle creating new playlist
  const handleCreatePlaylist = async () => {
    try {
      console.log("🔨 Creating new playlist...");
      const newPlaylist = await createPlaylist({
        title: "new playlist",
        description: "",
        songIds: [],
      });
      console.log("✅ Created playlist:", newPlaylist);
      setSelectedPlaylist(newPlaylist);
      console.log("🎯 Set selected playlist to:", newPlaylist);
    } catch (err) {
      console.error("❌ Error creating playlist:", err);
      setError(
        err instanceof Error ? err.message : "failed to create playlist"
      );
    }
  };

  return (
    <div class="relative h-screen bg-black text-white overflow-hidden">
      {/* Background pattern */}
      <div
        class="absolute inset-0 opacity-5"
        style={{
          "background-image":
            "radial-gradient(circle at 25% 25%, #ff00ff 2px, transparent 2px)",
          "background-size": "50px 50px",
        }}
      />

      {/* Loading state or main content */}
      <Show
        when={isInitialized()}
        fallback={
          <div class="flex items-center justify-center h-full">
            <div class="text-center">
              <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-magenta-500 mb-4"></div>
              <p class="text-lg">loading playlistz...</p>
              <p class="text-sm mt-2">
                debug: isInitialized = {String(isInitialized())}
              </p>
            </div>
          </div>
        }
      >
        {/* Main content */}
        <div class="relative flex h-full">
          <Show
            when={selectedPlaylist()}
            fallback={
              <div class="flex-1 flex items-center justify-center">
                <div class="text-center text-gray-400">
                  <div class="text-2xl mb-4 font-bold">music</div>
                  <h2 class="text-2xl font-light mb-2">welcome to playlistz</h2>
                  <p class="text-lg mb-4">
                    create a playlist or drag audio files here to get started
                  </p>
                  <button
                    onClick={handleCreatePlaylist}
                    class="px-6 py-3 bg-magenta-500 text-white rounded-lg hover:bg-magenta-600 transition-colors"
                  >
                    + playlist
                  </button>
                  <div class="mt-4 text-sm text-magenta-300">
                    found {playlists().length} playlists
                    {playlists().length > 0 && (
                      <div class="mt-2">
                        <button
                          onClick={() => {
                            const firstPlaylist = playlists()[0];
                            if (firstPlaylist) {
                              setSelectedPlaylist(firstPlaylist);
                            }
                          }}
                          class="text-xs text-magenta-400 hover:text-magenta-300"
                        >
                          select existing playlist
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            }
          >
            {(playlist) => (
              <div class="flex-1 p-6">
                <div class="max-w-4xl mx-auto">
                  <div class="flex items-center justify-between mb-6">
                    <div>
                      <input
                        type="text"
                        value={playlist().title}
                        onInput={(e) => {
                          const updatedPlaylist = {
                            ...playlist(),
                            title: e.currentTarget.value,
                          };
                          setSelectedPlaylist(updatedPlaylist);
                        }}
                        class="text-3xl font-bold text-white bg-transparent border-none outline-none focus:bg-gray-800 px-2 py-1 rounded"
                      />
                      <div class="mt-2">
                        <input
                          type="text"
                          value={playlist().description || ""}
                          placeholder="add description..."
                          onInput={(e) => {
                            const updatedPlaylist = {
                              ...playlist(),
                              description: e.currentTarget.value,
                            };
                            setSelectedPlaylist(updatedPlaylist);
                          }}
                          class="text-gray-400 bg-transparent border-none outline-none focus:bg-gray-800 px-2 py-1 rounded w-full"
                        />
                      </div>
                    </div>
                    <button
                      onClick={() => setSelectedPlaylist(null)}
                      class="px-4 py-2 text-gray-400 hover:text-white border border-gray-600 rounded hover:border-gray-400 transition-colors"
                    >
                      back to playlists
                    </button>
                  </div>

                  <div class="bg-gray-900 bg-opacity-30 rounded-lg p-6">
                    <h2 class="text-xl font-semibold mb-4 text-white">songs</h2>
                    <Show
                      when={false}
                      fallback={
                        <div class="text-center py-12">
                          <div class="text-gray-400 text-2xl mb-4">
                            no songs yet
                          </div>
                          <p class="text-gray-400">
                            drag and drop audio files here to add them to this
                            playlist
                          </p>
                          <p class="text-xs text-gray-500 mt-2">
                            playlist id: {playlist().id}
                          </p>
                        </div>
                      }
                    >
                      <div class="space-y-2">
                        <div class="text-magenta-400">
                          songs will appear here (temporarily disabled for
                          debugging)
                        </div>
                      </div>
                    </Show>
                  </div>
                </div>
              </div>
            )}
          </Show>
        </div>
      </Show>

      {/* Global drag overlay */}
      <Show when={isDragOver()}>
        <div class="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 backdrop-blur-sm">
          <div class="text-center">
            <div class="text-4xl mb-6 font-bold">drop zone</div>
            <h2 class="text-4xl font-light mb-4 text-magenta-400">
              drop your music here
            </h2>
            <p class="text-xl text-gray-300">
              release to add files to{" "}
              {selectedPlaylist()?.title || "a new playlist"}
            </p>
            <div class="mt-6 flex justify-center">
              <div class="px-4 py-2 bg-magenta-500 bg-opacity-20 border-2 border-magenta-500 border-dashed rounded-lg">
                <p class="text-magenta-300">
                  supports MP3, WAV, FLAC, AIFF, and more
                </p>
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* Error notification */}
      <Show when={error()}>
        <div class="fixed top-4 right-4 z-50">
          <div class="bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg max-w-sm">
            <div class="flex items-center">
              <div class="flex-shrink-0">
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fill-rule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                    clip-rule="evenodd"
                  />
                </svg>
              </div>
              <div class="ml-3">
                <p class="text-sm font-medium">{error()}</p>
              </div>
              <div class="ml-4 flex-shrink-0">
                <button
                  onClick={() => setError(null)}
                  class="text-white hover:text-gray-200 focus:outline-none"
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
