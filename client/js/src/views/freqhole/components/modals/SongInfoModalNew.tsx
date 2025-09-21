import { createSignal, Show, onMount, createEffect } from "solid-js";
import { Modal } from "../ui/Modal";
import type { Song } from "../../../../lib/music/schemas/song";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";
import { useAuth } from "../../../../hooks/auth";
import { apiClient } from "../../../../lib/api-client";
import { SongMetadataView } from "../songs/SongMetadataView";
import { SongEditFormNew } from "../songs/SongEditFormNew";
import { SongBulkEditFormNew } from "../songs/SongBulkEditFormNew";
import { SongPagination } from "../songs/SongPagination";
import {
  getMetadataFieldKeys,
  getUserPreferenceFieldKeys,
  type EditableSongFields,
} from "../../../../lib/music/schemas/form-schemas";

interface SongInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  songs: Song[];
}

export function SongInfoModalNew(props: SongInfoModalProps) {
  const events = useGlobalEvents();
  const auth = useAuth();
  const [currentSongIndex, setCurrentSongIndex] = createSignal(0);
  const [isBulkMode, setIsBulkMode] = createSignal(false);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [formData, setFormData] = createSignal<Partial<EditableSongFields>>({});

  const totalSongs = () => props.songs.length;
  const currentSong = () => props.songs[currentSongIndex()];
  const isEditing = () => auth.isAdmin;

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
      setFormData({});
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

  // form change handler - receives schema-validated changes
  const handleFormChange = (changes: Partial<EditableSongFields>) => {
    setFormData(changes);
  };

  // schema-driven save handler
  const handleSave = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const changes = formData();

      if (Object.keys(changes).length === 0) {
        console.log("no changes to save");
        props.onClose();
        return;
      }

      const songIds = props.songs.map((s) => s.id);

      // use schema-driven field categorization
      const metadataFieldKeys = new Set(getMetadataFieldKeys());
      const userPrefFieldKeys = new Set(getUserPreferenceFieldKeys());

      const metadataUpdates = Object.fromEntries(
        Object.entries(changes).filter(([key]) =>
          metadataFieldKeys.has(key as any)
        )
      );

      const userPrefUpdates = Object.fromEntries(
        Object.entries(changes).filter(([key]) =>
          userPrefFieldKeys.has(key as any)
        )
      );

      const promises = [];

      // admin metadata updates using new schema-driven method
      if (Object.keys(metadataUpdates).length > 0 && auth.isAdmin) {
        promises.push(
          apiClient.bulkUpdateSongsFromChanges({
            song_ids: songIds,
            updates: metadataUpdates,
          })
        );
      }

      // user preference updates using new schema-driven method
      if (Object.keys(userPrefUpdates).length > 0) {
        promises.push(
          apiClient.bulkUpdateUserPreferencesFromChanges({
            song_ids: songIds,
            updates: userPrefUpdates,
          })
        );
      }

      if (promises.length > 0) {
        const results = await Promise.all(promises);

        // collect updated songs from all API responses
        const updatedSongs = results.flatMap((result) => {
          if ("updated_songs" in result) {
            return result.updated_songs;
          }
          if ("updated_preferences" in result) {
            // for user preferences, we need to merge with existing song data
            // for now, trigger full reload since we don't have the full song objects
            return [];
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
      events.emit("notification:show", {
        message: `updated ${totalSongs()} song(s)`,
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
      <Modal isOpen={props.isOpen} onClose={props.onClose} size="lg">
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
                onClick={props.onClose}
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
              // bulk edit mode
              <>
                <div class="text-sm text-gray-400">
                  editing {totalSongs()} songs
                </div>
                {isEditing() ? (
                  <SongBulkEditFormNew
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
                {/* song navigation */}
                <Show when={totalSongs() > 1}>
                  <SongPagination
                    currentIndex={currentSongIndex()}
                    totalSongs={totalSongs()}
                    isBulkMode={false}
                    isLoading={isLoading()}
                    onPrevious={goToPrevious}
                    onNext={goToNext}
                    onToggleBulkMode={() => setIsBulkMode(true)}
                    onCancel={props.onClose}
                    onSave={handleSave}
                  />
                </Show>

                {/* song content */}
                <Show when={currentSong()}>
                  {isEditing() ? (
                    <SongEditFormNew
                      song={currentSong()!}
                      onFormChange={handleFormChange}
                    />
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
          <Show when={isEditing()}>
            <div class="flex justify-end gap-3 pt-4 border-t border-gray-700">
              <button
                onClick={props.onClose}
                class="px-4 py-2 text-gray-300 hover:text-white transition-colors"
                disabled={isLoading()}
              >
                cancel
              </button>
              <button
                onClick={handleSave}
                class="px-4 py-2 bg-magenta-600 text-white hover:bg-magenta-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isLoading() || Object.keys(formData()).length === 0}
              >
                {isLoading() ? "saving..." : "save changes"}
              </button>
            </div>
          </Show>
        </div>
      </Modal>
    </Show>
  );
}
