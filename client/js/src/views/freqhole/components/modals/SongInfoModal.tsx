import { createSignal, Show, onMount, createEffect } from "solid-js";
import { Modal } from "../ui/Modal";
import type { Song } from "../../../../lib/music/schemas/song";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";
import { useAuth } from "../../../../hooks/auth";
import { apiClient } from "../../../../lib/api-client";
import { SongMetadataView } from "../songs/SongMetadataView";
import { SongEditForm } from "../songs/SongEditForm";
import { SongBulkEditForm } from "../songs/SongBulkEditForm";
import type { EditableSongFields } from "../../../../lib/music/schemas/form-schemas";

interface SongInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  songs: Song[];
}

export function SongInfoModal(props: SongInfoModalProps) {
  const events = useGlobalEvents();
  const auth = useAuth();
  const [currentSongIndex, setCurrentSongIndex] = createSignal(0);
  const [isBulkMode, setIsBulkMode] = createSignal(false);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [formChanges, setFormChanges] = createSignal<
    Partial<EditableSongFields>
  >({});

  const totalSongs = () => props.songs.length;
  const currentSong = () => props.songs[currentSongIndex()];
  const isEditing = () => auth.isAdmin;
  const hasChanges = () => Object.keys(formChanges()).length > 0;

  // initialize bulk mode for multi-song selections
  onMount(() => {
    if (totalSongs() > 1) {
      setIsBulkMode(true);
    }
  });

  // reset when modal opens/closes or songs change
  createEffect(() => {
    if (props.isOpen && props.songs.length > 0) {
      setCurrentSongIndex(0);
      setError(null);
      setFormChanges({});
      if (totalSongs() > 1) {
        setIsBulkMode(true);
      } else {
        setIsBulkMode(false);
      }
    }
  });

  // navigation handlers
  const goToPrevious = () => {
    setCurrentSongIndex((prev) => (prev > 0 ? prev - 1 : totalSongs() - 1));
  };

  const goToNext = () => {
    setCurrentSongIndex((prev) => (prev < totalSongs() - 1 ? prev + 1 : 0));
  };

  // form change handler
  const handleFormChange = (changes: Partial<EditableSongFields>) => {
    setFormChanges(changes);
  };

  // schema-driven save handler
  const handleSave = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const changes = formChanges();
      if (Object.keys(changes).length === 0) {
        console.log("no changes to save");
        props.onClose();
        return;
      }

      const songIds = isBulkMode()
        ? props.songs.map((s) => s.id)
        : [currentSong()!.id];

      const promises = [];

      // schema-driven API calls - the methods automatically handle field categorization
      if (auth.isAdmin) {
        // metadata updates (handled automatically by schema-driven method)
        promises.push(
          apiClient
            .bulkUpdateSongsFromChanges({
              song_ids: songIds,
              updates: changes,
            })
            .catch((err) => {
              // if no metadata fields, this is expected and ok
              if (err.message?.includes("no metadata updates")) {
                return null;
              }
              throw err;
            })
        );
      }

      // user preference updates (handled automatically by schema-driven method)
      promises.push(
        apiClient
          .bulkUpdateUserPreferencesFromChanges({
            song_ids: songIds,
            updates: changes,
          })
          .catch((err) => {
            // if no user preference fields, this is expected and ok
            if (err.message?.includes("no user preference updates")) {
              return null;
            }
            throw err;
          })
      );

      const results = await Promise.all(promises);
      const validResults = results.filter(Boolean);

      if (validResults.length > 0) {
        // collect updated songs from all API responses
        const updatedSongs = validResults.flatMap((result) => {
          if (
            result &&
            typeof result === "object" &&
            "updated_songs" in result
          ) {
            return result.updated_songs;
          }
          return [];
        });

        if (updatedSongs.length > 0) {
          // emit targeted update with actual server response data
          events.emit("songs:updated", {
            songs: updatedSongs,
            operation: isBulkMode() ? "bulk-update" : "single-update",
          });
        } else {
          // fallback to full reload if no updated songs in response
          events.emit("data:reload", { type: "songs" });
        }
      }

      // success feedback
      const songCount = isBulkMode() ? totalSongs() : 1;
      events.emit("notification:show", {
        message: `updated ${songCount} song${songCount === 1 ? "" : "s"}`,
        type: "success",
      });

      props.onClose();
    } catch (err) {
      console.error("save failed:", err);
      setError(err instanceof Error ? err.message : "failed to save changes");
    } finally {
      setIsLoading(false);
    }
  };

  // keyboard navigation
  const handleKeyDown = (e: KeyboardEvent) => {
    if (!props.isOpen || isEditing()) return;

    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        goToPrevious();
        break;
      case "ArrowRight":
        e.preventDefault();
        goToNext();
        break;
      case "Escape":
        e.preventDefault();
        props.onClose();
        break;
    }
  };

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
  });

  return (
    <Show when={props.isOpen}>
      <Modal
        isOpen={props.isOpen}
        onClose={() => props.onClose()}
        size="lg"
        showCloseButton={false}
      >
        <div class="space-y-6">
          {/* header */}
          <div class="flex items-center justify-between">
            <h2 class="text-xl font-bold text-white">
              {isBulkMode() ? "bulk song info" : "song info"}
            </h2>
            <div class="flex items-center gap-2">
              {totalSongs() > 1 && (
                <button
                  onClick={() => setIsBulkMode(!isBulkMode())}
                  class="px-3 py-1 text-sm bg-gray-700 text-white hover:bg-gray-600 transition-colors"
                  disabled={isLoading()}
                >
                  {isBulkMode() ? "single edit" : "bulk edit"}
                </button>
              )}
              <button
                onClick={() => props.onClose()}
                class="text-gray-400 hover:text-white transition-colors"
                disabled={isLoading()}
              >
                ✕
              </button>
            </div>
          </div>

          {/* error display */}
          <Show when={error()}>
            <div class="p-4 bg-red-900/20 border border-red-600 text-red-200">
              {error()}
            </div>
          </Show>

          {/* content */}
          <div class="space-y-6">
            {isBulkMode() ? (
              // bulk edit mode - uses schema-driven form
              <>
                <div class="text-sm text-gray-400">
                  editing {totalSongs()} songs
                </div>
                {isEditing() ? (
                  <SongBulkEditForm
                    songs={props.songs}
                    onFormChange={handleFormChange}
                  />
                ) : (
                  <div class="text-gray-400">
                    bulk editing requires admin privileges
                  </div>
                )}
              </>
            ) : (
              // single song mode
              <>
                {/* song content - uses schema-driven form */}
                <Show when={currentSong()}>
                  {isEditing() ? (
                    <Show when={currentSong()?.id} keyed>
                      {(songId) => (
                        <SongEditForm
                          song={currentSong()!}
                          songs={props.songs}
                          currentIndex={currentSongIndex()}
                          onFormChange={handleFormChange}
                          onSongChange={(index) => setCurrentSongIndex(index)}
                        />
                      )}
                    </Show>
                  ) : (
                    <SongMetadataView
                      songs={[currentSong()!]}
                      currentSongIndex={0}
                    />
                  )}
                </Show>
              </>
            )}
          </div>

          {/* actions */}
          <div class="flex justify-end gap-3 pt-4 border-t border-gray-700">
            {/* cancel and save buttons - always shown when editing */}
            <Show when={isEditing()}>
              <button
                onClick={() => props.onClose()}
                class="px-4 py-2 text-gray-300 hover:text-white transition-colors"
                disabled={isLoading()}
              >
                cancel
              </button>
              <button
                onClick={handleSave}
                class="px-4 py-2 bg-magenta-600 text-white hover:bg-magenta-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isLoading() || !hasChanges()}
              >
                {isLoading() ? "saving..." : "save changes"}
              </button>
            </Show>

            {/* close button for view-only mode */}
            <Show when={!isEditing()}>
              <button
                onClick={() => props.onClose()}
                class="px-4 py-2 text-gray-300 hover:text-white transition-colors"
              >
                close
              </button>
            </Show>
          </div>
        </div>
      </Modal>
    </Show>
  );
}
