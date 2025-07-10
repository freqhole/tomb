/* @jsxImportSource solid-js */
import { createSignal, Show, For } from "solid-js";
import { useFreqhole } from "../context";
// import { Panel } from "./layout/Panel";
import { PlayIcon, AddIcon, QueueIcon } from "./icons";

export function MusicView() {
  const freqhole = useFreqhole();
  const [selectedSongs, setSelectedSongs] = createSignal<string[]>([]);

  // Get filtered songs based on current view and search
  const getDisplaySongs = () => {
    if (freqhole.music.state.isSearchActive()) {
      return freqhole.music.state.searchResults();
    }
    return freqhole.music.state.songs();
  };

  const handlePlaySong = (song: any) => {
    freqhole.actions.playAndQueue(song);
  };

  const handleAddToQueue = (song: any) => {
    freqhole.player.addToQueue(song);
  };

  const handleAddToPlaylist = (songs: any[]) => {
    freqhole.actions.addToPlaylistWithModal(songs);
  };

  const toggleSongSelection = (songId: string) => {
    setSelectedSongs((prev) =>
      prev.includes(songId)
        ? prev.filter((id) => id !== songId)
        : [...prev, songId]
    );
  };

  const getSelectedSongsData = () => {
    const songs = getDisplaySongs();
    const selected = selectedSongs();
    return songs.filter((song) => selected.includes(song.id));
  };

  const formatDuration = (seconds: number | undefined) => {
    if (!seconds) return "--:--";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div class="h-full flex flex-col">
      {/* Header Actions */}
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center space-x-4">
          <h2 class="text-xl font-bold text-white">
            {freqhole.music.state.isSearchActive()
              ? "Search Results"
              : "Music Library"}
          </h2>
          <Show when={freqhole.music.state.isSearchActive()}>
            <span class="text-sm text-gray-400">
              {freqhole.music.state.searchResults().length} results for "
              {freqhole.music.state.searchQuery()}"
            </span>
          </Show>
        </div>

        <div class="flex items-center space-x-2">
          <Show when={selectedSongs().length > 0}>
            <button
              class="px-3 py-1 bg-primary-500 text-white border border-transparent hover:bg-primary-600 hover:border-primary-300 transition-all duration-200 text-sm metro-button-hover"
              onClick={() => handleAddToPlaylist(getSelectedSongsData())}
            >
              Add {selectedSongs().length} to Playlist
            </button>
            <button
              class="px-3 py-1 bg-dark-200 text-white border border-transparent hover:bg-primary-500 hover:border-primary-300 transition-all duration-200 text-sm metro-button-hover"
              onClick={() => setSelectedSongs([])}
            >
              Clear Selection
            </button>
          </Show>
        </div>
      </div>

      {/* Loading State */}
      <Show when={freqhole.music.state.loading()}>
        <div class="flex items-center justify-center py-8">
          <div class="text-gray-400">Loading music...</div>
        </div>
      </Show>

      {/* Error State */}
      <Show when={freqhole.music.state.error()}>
        <div class="flex items-center justify-between bg-red-900/20 border border-red-500/30 p-4 rounded mb-4">
          <div class="text-red-400">{freqhole.music.state.error()}</div>
          <button
            class="px-3 py-1 bg-red-500 text-white hover:bg-red-600 transition-colors text-sm"
            onClick={() => freqhole.music.actions.clearError()}
          >
            Dismiss
          </button>
        </div>
      </Show>

      {/* Songs List */}
      <div class="flex-1 overflow-auto">
        <Show
          when={!freqhole.music.state.loading() && getDisplaySongs().length > 0}
          fallback={
            <div class="flex items-center justify-center py-8">
              <div class="text-gray-400">
                {freqhole.music.state.isSearchActive()
                  ? "No search results found"
                  : "No music found"}
              </div>
            </div>
          }
        >
          <div class="space-y-1">
            <For each={getDisplaySongs()}>
              {(song) => (
                <div
                  class={`flex items-center p-3 border border-transparent hover:bg-dark-200 hover:border-primary-300 cursor-pointer transition-all duration-200 metro-item-hover ${
                    selectedSongs().includes(song.id)
                      ? "bg-primary-500/20 border-primary-500/50"
                      : ""
                  }`}
                  onClick={() => toggleSongSelection(song.id)}
                >
                  {/* Selection Checkbox */}
                  <div class="w-5 h-5 mr-3 flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={selectedSongs().includes(song.id)}
                      class="w-4 h-4 text-primary-500 bg-dark-300 border-gray-600 rounded focus:ring-primary-500"
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSongSelection(song.id)}
                    />
                  </div>

                  {/* Song Info */}
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between">
                      <div class="flex-1 min-w-0">
                        <h3 class="text-white font-medium truncate">
                          {song.title}
                        </h3>
                        <p class="text-gray-400 text-sm truncate">
                          {song.artist} {song.album && `• ${song.album}`}
                        </p>
                      </div>
                      <div class="flex items-center space-x-2 ml-4">
                        <span class="text-gray-400 text-sm">
                          {formatDuration(song.duration_seconds)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div class="flex items-center space-x-2 ml-4">
                    <button
                      class="p-2 hover:bg-primary-500 hover:border-primary-300 border border-transparent rounded transition-all duration-200 metro-button-hover"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePlaySong(song);
                      }}
                      title="Play"
                    >
                      <PlayIcon className="w-4 h-4 text-white" />
                    </button>
                    <button
                      class="p-2 hover:bg-primary-500 hover:border-primary-300 border border-transparent rounded transition-all duration-200 metro-button-hover"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddToQueue(song);
                      }}
                      title="Add to Queue"
                    >
                      <QueueIcon className="w-4 h-4 text-white" />
                    </button>
                    <button
                      class="p-2 hover:bg-primary-500 hover:border-primary-300 border border-transparent rounded transition-all duration-200 metro-button-hover"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddToPlaylist([song]);
                      }}
                      title="Add to Playlist"
                    >
                      <AddIcon className="w-4 h-4 text-white" />
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* Current Playing Indicator */}
      <Show when={freqhole.player.currentSong()}>
        <div class="mt-4 p-3 bg-primary-500/20 border border-primary-500/50 rounded">
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-3">
              <div class="w-2 h-2 bg-primary-500 rounded-full animate-pulse"></div>
              <div>
                <div class="text-white font-medium">
                  {freqhole.player.currentSong()?.title}
                </div>
                <div class="text-gray-400 text-sm">
                  {freqhole.player.currentSong()?.artist}
                </div>
              </div>
            </div>
            <div class="text-primary-400 text-sm">Now Playing</div>
          </div>
        </div>
      </Show>
    </div>
  );
}
