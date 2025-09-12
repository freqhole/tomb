import { For, Show } from "solid-js";
import { useSongInteractions } from "../../../../services/songInteractions";
import { useSelection } from "../../../../hooks/useSelection";
import { useGlobalEvents } from "../../../../hooks/useGlobalEvents";
import { apiClient } from "../../../../../../lib/api-client";
import type { Song } from "../../../../../../lib/music/schemas";

interface MobileSongListProps {
  songs: Song[];
  loading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  class?: string;
}

export function MobileSongList(props: MobileSongListProps) {
  const songInteractions = useSongInteractions();
  const events = useGlobalEvents();

  // Selection state
  const selection = useSelection({
    onSelectionChange: (selectedIds: Set<string>) => {
      console.log(
        `#TODO mobile song list selection changed: ${selectedIds.size} songs selected`
      );
    },
  });

  // Clear selection when songs change
  events.on("selection:clear", () => {
    selection.clearSelection();
  });

  return (
    <div class={`${props.class || ""}`}>
      {/* Song List */}
      <div class="space-y-1">
        <For each={props.songs}>
          {(song, index) => (
            <div
              class={`p-3 hover:bg-magenta-600/20 transition-colors cursor-pointer group border border-transparent rounded-lg ${
                selection.isSelected(song.id)
                  ? "bg-magenta-600/30 border-magenta-400/50"
                  : ""
              }`}
              onClick={(e) => {
                if (e.detail === 1) {
                  // Single click - handle selection
                  if (e.shiftKey && selection.lastSelectedIndex() >= 0) {
                    selection.selectRange(
                      selection.lastSelectedIndex(),
                      index(),
                      props.songs
                    );
                  } else {
                    selection.handleRowClick(song, index(), e);
                  }
                }
              }}
              onDblClick={() => {
                // Double click - play song
                songInteractions.playSong(song, false);
              }}
              onMouseDown={(e) =>
                selection.handleRowMouseDown(song, index(), e)
              }
              onContextMenu={(e) => {
                // If right-clicking on unselected song, select it first
                if (!selection.isSelected(song.id)) {
                  selection.setSelectedItems(new Set([song.id]));
                  selection.setLastSelectedIndex(index());
                }

                const selectedSongs = selection.getSelectedSongs(props.songs);
                if (selectedSongs.length > 1) {
                  songInteractions.handleBulkRightClick(e, selectedSongs);
                } else {
                  songInteractions.handleRightClick(e, song);
                }
              }}
            >
              <div class="flex items-center gap-3">
                {/* Selection Indicator / Track Number */}
                <div class="w-6 flex-shrink-0 text-center">
                  <Show when={selection.isSelected(song.id)}>
                    <div class="text-magenta-400 text-sm">
                      <svg
                        class="w-4 h-4 mx-auto"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                      </svg>
                    </div>
                  </Show>
                  <Show when={!selection.isSelected(song.id)}>
                    <div class="group-hover:hidden text-gray-400 text-sm">
                      {index() + 1}
                    </div>
                    <button
                      class="hidden group-hover:block text-gray-400 hover:text-magenta-400 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        songInteractions.playSong(song);
                      }}
                    >
                      <svg
                        class="w-4 h-4 mx-auto"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </button>
                  </Show>
                </div>

                {/* Album Art */}
                <div class="w-10 h-10 bg-magenta-800/30 rounded flex-shrink-0 flex items-center justify-center">
                  <Show
                    when={song.thumbnail_blob_id}
                    fallback={
                      <svg
                        class="w-5 h-5 text-magenta-400"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                      </svg>
                    }
                  >
                    <img
                      src={`${apiClient.getBaseUrl()}/api/blobs/${song.thumbnail_blob_id}`}
                      alt={song.title}
                      class="w-10 h-10 rounded object-cover"
                    />
                  </Show>
                </div>

                {/* Song Info - Stacked */}
                <div class="flex-1 min-w-0">
                  <div class="text-white font-medium truncate group-hover:text-magenta-300 transition-colors">
                    {song.display_title}
                  </div>
                  <div class="text-gray-300 text-sm truncate">
                    {song.artist || "Unknown Artist"}
                  </div>
                  <Show when={song.album}>
                    <div class="text-gray-400 text-xs truncate">
                      {song.album}
                    </div>
                  </Show>
                </div>

                {/* Actions */}
                <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  {/* Duration */}
                  <div class="text-gray-400 text-xs min-w-10 text-right">
                    {songInteractions.formatDuration(song.duration_seconds)}
                  </div>

                  {/* Favorite indicator */}
                  <Show when={song.user_is_favorite}>
                    <div class="text-magenta-500">
                      <svg
                        class="w-4 h-4"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                      </svg>
                    </div>
                  </Show>

                  {/* Add to Queue Button */}
                  <button
                    class="p-1 text-gray-400 hover:text-magenta-400 hover:bg-magenta-600/30 rounded transition-all"
                    onClick={(e) => {
                      e.stopPropagation();
                      songInteractions.queueSong(song);
                    }}
                    title="Add to queue"
                  >
                    <svg
                      class="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )}
        </For>
      </div>

      {/* Loading indicator */}
      <Show when={props.loading}>
        <div class="p-6 text-center">
          <div class="text-gray-400">loading more songs...</div>
        </div>
      </Show>

      {/* Load more button */}
      <Show when={props.hasMore && !props.loading && props.onLoadMore}>
        <div class="p-4 text-center">
          <button
            class="px-6 py-3 bg-magenta-600/30 hover:bg-magenta-600/50 text-white rounded-lg transition-colors"
            onClick={props.onLoadMore}
          >
            Load More Songs
          </button>
        </div>
      </Show>

      {/* No more songs indicator */}
      <Show when={!props.hasMore && props.songs.length > 0}>
        <div class="p-6 text-center">
          <div class="text-gray-600 text-xs opacity-50">— end of songs —</div>
        </div>
      </Show>
    </div>
  );
}
