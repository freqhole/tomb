/* @jsxImportSource solid-js */
import { createSignal, Show, For, onCleanup } from "solid-js";
import { createRelativeTimeSignal } from "../utils/timeUtils.js";
import { deletePlaylist } from "../services/indexedDBService.js";
import type { Playlist } from "../types/playlist.js";

interface PlaylistManagerProps {
  playlists: Playlist[];
  selectedPlaylist: Playlist | null;
  onPlaylistSelect: (playlist: Playlist) => void;
  onCreatePlaylist: () => void;
}

export function PlaylistManager(props: PlaylistManagerProps) {
  const [searchTerm, setSearchTerm] = createSignal("");
  const [sortBy, setSortBy] = createSignal<
    "recent" | "alphabetical" | "oldest"
  >("recent");

  // Filter and sort playlists
  const filteredPlaylists = () => {
    let filtered = props.playlists;

    // Filter by search term
    const search = searchTerm().toLowerCase().trim();
    if (search) {
      filtered = filtered.filter(
        (playlist) =>
          playlist.title.toLowerCase().includes(search) ||
          (playlist.description &&
            playlist.description.toLowerCase().includes(search))
      );
    }

    // Sort playlists
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy()) {
        case "alphabetical":
          return a.title.localeCompare(b.title);
        case "oldest":
          return a.createdAt - b.createdAt;
        case "recent":
        default:
          return b.updatedAt - a.updatedAt;
      }
    });

    return sorted;
  };

  // Handle playlist deletion
  const handleDeletePlaylist = async (playlist: Playlist, e: Event) => {
    e.stopPropagation();

    if (
      confirm(
        `Are you sure you want to delete "${playlist.title}"? This will also delete all songs in the playlist.`
      )
    ) {
      try {
        await deletePlaylist(playlist.id);
        console.log(`✅ Deleted playlist: ${playlist.title}`);
      } catch (error) {
        console.error("Error deleting playlist:", error);
      }
    }
  };

  return (
    <div class="flex flex-col h-full">
      {/* Header */}
      <div class="p-4 border-b border-gray-700">
        <div class="flex items-center justify-between mb-4">
          <h1 class="text-xl font-semibold text-white">Playlists</h1>
          <button
            onClick={props.onCreatePlaylist}
            class="px-3 py-1.5 bg-magenta-500 text-white text-sm rounded-lg hover:bg-magenta-600 transition-colors focus:outline-none focus:ring-2 focus:ring-magenta-500 focus:ring-opacity-50"
            title="Create new playlist"
          >
            <svg
              class="w-4 h-4 inline mr-1"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fill-rule="evenodd"
                d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                clip-rule="evenodd"
              />
            </svg>
            New
          </button>
        </div>

        {/* Search */}
        <div class="mb-3">
          <input
            type="text"
            placeholder="Search playlists..."
            value={searchTerm()}
            onInput={(e) => setSearchTerm(e.currentTarget.value)}
            class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-magenta-500 focus:border-transparent"
          />
        </div>

        {/* Sort options */}
        <div class="flex text-sm">
          <button
            onClick={() => setSortBy("recent")}
            class={`px-3 py-1 rounded-l-lg border border-r-0 ${
              sortBy() === "recent"
                ? "bg-magenta-500 border-magenta-500 text-white"
                : "bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600"
            }`}
          >
            Recent
          </button>
          <button
            onClick={() => setSortBy("alphabetical")}
            class={`px-3 py-1 border border-r-0 ${
              sortBy() === "alphabetical"
                ? "bg-magenta-500 border-magenta-500 text-white"
                : "bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600"
            }`}
          >
            A-Z
          </button>
          <button
            onClick={() => setSortBy("oldest")}
            class={`px-3 py-1 rounded-r-lg border ${
              sortBy() === "oldest"
                ? "bg-magenta-500 border-magenta-500 text-white"
                : "bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600"
            }`}
          >
            Oldest
          </button>
        </div>
      </div>

      {/* Playlist list */}
      <div class="flex-1 overflow-y-auto">
        <Show
          when={filteredPlaylists().length > 0}
          fallback={
            <div class="p-4 text-center text-gray-400">
              <div class="text-4xl mb-2">🎵</div>
              <p class="text-sm">
                {searchTerm()
                  ? "No playlists match your search"
                  : "No playlists yet"}
              </p>
              {!searchTerm() && (
                <button
                  onClick={props.onCreatePlaylist}
                  class="mt-3 text-magenta-400 hover:text-magenta-300 text-sm underline"
                >
                  Create your first playlist
                </button>
              )}
            </div>
          }
        >
          <For each={filteredPlaylists()}>
            {(playlist) => {
              const relativeTime = createRelativeTimeSignal(playlist.updatedAt);

              onCleanup(() => {
                relativeTime.destroy();
              });

              return (
                <PlaylistItem
                  playlist={playlist}
                  isSelected={props.selectedPlaylist?.id === playlist.id}
                  onSelect={() => props.onPlaylistSelect(playlist)}
                  onDelete={(e) => handleDeletePlaylist(playlist, e)}
                  relativeTime={relativeTime.signal()}
                />
              );
            }}
          </For>
        </Show>
      </div>

      {/* Footer stats */}
      <div class="p-4 border-t border-gray-700 text-xs text-gray-400">
        <p>
          {props.playlists.length} playlist
          {props.playlists.length !== 1 ? "s" : ""}
        </p>
      </div>
    </div>
  );
}

// Individual playlist item component
function PlaylistItem(props: {
  playlist: Playlist;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: (e: Event) => void;
  relativeTime: string;
}) {
  const [showOptions, setShowOptions] = createSignal(false);

  const songCount = () => props.playlist.songIds?.length || 0;

  return (
    <div
      class={`relative p-4 border-b border-gray-800 cursor-pointer transition-colors ${
        props.isSelected
          ? "bg-magenta-500 bg-opacity-20 border-magenta-500"
          : "hover:bg-gray-800"
      }`}
      onClick={props.onSelect}
      onMouseEnter={() => setShowOptions(true)}
      onMouseLeave={() => setShowOptions(false)}
    >
      <div class="flex items-start">
        {/* Playlist thumbnail */}
        <div class="flex-shrink-0 w-12 h-12 bg-gray-700 rounded-lg mr-3 overflow-hidden">
          <Show
            when={props.playlist.image}
            fallback={
              <div class="w-full h-full flex items-center justify-center text-gray-400">
                <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.369 4.369 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
                </svg>
              </div>
            }
          >
            <img
              src={props.playlist.image}
              alt={props.playlist.title}
              class="w-full h-full object-cover"
            />
          </Show>
        </div>

        {/* Playlist info */}
        <div class="flex-1 min-w-0">
          <h3
            class={`font-medium truncate ${
              props.isSelected ? "text-white" : "text-gray-200"
            }`}
          >
            {props.playlist.title}
          </h3>

          <div class="flex items-center text-xs text-gray-400 mt-1">
            <span>
              {songCount()} song{songCount() !== 1 ? "s" : ""}
            </span>
            <span class="mx-1">•</span>
            <span>{props.relativeTime}</span>
          </div>

          {props.playlist.description && (
            <p class="text-xs text-gray-500 mt-1 truncate">
              {props.playlist.description}
            </p>
          )}
        </div>

        {/* Options menu */}
        <Show when={showOptions()}>
          <div class="absolute top-2 right-2">
            <button
              onClick={props.onDelete}
              class="p-1 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded"
              title="Delete playlist"
            >
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fill-rule="evenodd"
                  d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                  clip-rule="evenodd"
                />
              </svg>
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}
