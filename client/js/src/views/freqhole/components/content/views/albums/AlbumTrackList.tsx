import { For, Show } from "solid-js";
import { useSelection } from "../../../../hooks/useSelection";
import { useGlobalEvents } from "../../../../hooks/useGlobalEvents";
import { useSongInteractions } from "../../../../services/songInteractions";
import type { Song } from "../../../../../../lib/music/schemas";

interface AlbumTrackListProps {
  tracks: Song[];
  loading: boolean;
  selectedAlbumArtist?: string | null;
  onArtistClick?: (artistName: string) => void;
  class?: string;
}

export function AlbumTrackList(props: AlbumTrackListProps) {
  const events = useGlobalEvents();
  const songInteractions = useSongInteractions();

  // Selection state
  const selection = useSelection({
    onSelectionChange: (selectedIds) => {
      console.log(
        `#TODO album track list selection changed: ${selectedIds.size} songs selected`
      );
    },
  });

  // Listen for selection clear events
  events.on("selection:clear", () => {
    selection.clearSelection();
  });

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "—";
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  return (
    <div class={`${props.class || ""}`}>
      <Show when={props.loading}>
        <div class="text-center py-8">
          <div class="text-magenta-400">Loading tracks...</div>
        </div>
      </Show>

      <Show
        when={!props.loading && props.tracks.length > 0}
        fallback={
          <Show when={!props.loading}>
            <div class="text-center py-8">
              <div class="text-gray-400">No tracks found</div>
            </div>
          </Show>
        }
      >
        <div class="space-y-1">
          <For each={props.tracks}>
            {(track, index) => (
              <div
                class={`p-3 rounded hover:bg-magenta-600/20 transition-colors cursor-pointer group ${
                  selection.isSelected(track.id)
                    ? "bg-magenta-600/30 border-magenta-400/50"
                    : ""
                }`}
                onClick={(e) => {
                  if (e.shiftKey && selection.lastSelectedIndex() >= 0) {
                    selection.selectRange(
                      selection.lastSelectedIndex(),
                      index(),
                      props.tracks
                    );
                  } else {
                    selection.handleRowClick(track, index(), e);
                  }
                }}
                onDblClick={() => songInteractions.handleDoubleClick(track)}
                onMouseDown={(e) =>
                  selection.handleRowMouseDown(track, index(), e)
                }
                onContextMenu={(e) => {
                  // If right-clicking on unselected track, select it first
                  if (!selection.isSelected(track.id)) {
                    selection.setSelectedItems(new Set([track.id]));
                    selection.setLastSelectedIndex(index());
                  }

                  const selectedTracks = selection.getSelectedSongs(
                    props.tracks
                  );
                  if (selectedTracks.length > 1) {
                    songInteractions.handleBulkRightClick(e, selectedTracks);
                  } else {
                    songInteractions.handleRightClick(e, track, {
                      hideViewAlbum: true,
                    });
                  }
                }}
              >
                <div class="flex items-center min-w-0">
                  <div class="w-8 text-gray-400 text-sm flex-shrink-0 text-center">
                    {track.track_number || "—"}
                  </div>
                  <div class="flex-1 min-w-0 pr-3 ml-3">
                    <div class="text-white font-medium truncate group-hover:text-magenta-300 transition-colors">
                      {track.title}
                    </div>
                    <div class="text-magenta-400 text-sm truncate">
                      <Show
                        when={
                          track.artist &&
                          track.artist !== props.selectedAlbumArtist
                        }
                      >
                        <button
                          class="hover:text-magenta-300 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (props.onArtistClick && track.artist) {
                              props.onArtistClick(track.artist);
                            }
                          }}
                        >
                          {track.artist}
                        </button>
                        <span class="mx-2">·</span>
                      </Show>
                      {formatDuration(track.duration_seconds)}
                    </div>
                  </div>
                  <div class="flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      class="p-1 rounded-full hover:bg-magenta-600/30 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        events.emit("song:queue", { song: track });
                      }}
                      title="Add to queue"
                    >
                      <svg
                        class="w-4 h-4 text-magenta-400"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
