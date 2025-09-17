import { createSignal, Show, onMount, createEffect } from "solid-js";
import { Modal } from "../ui/Modal";
import type { Song } from "../../../../lib/music/schemas/song";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";
import { useAuth } from "../../../../hooks/auth";
import { SongMetadataView } from "../songs/SongMetadataView";
import { SongEditForm } from "../songs/SongEditForm";
import { SongBulkEditForm } from "../songs/SongBulkEditForm";
import { SongPagination } from "../songs/SongPagination";

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
  const [formData, setFormData] = createSignal<any>({});

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
      if (totalSongs() > 1) {
        setIsBulkMode(true);
      } else {
        setIsBulkMode(false);
      }
    }
  });

  // navigation handlers
  const goToPrevious = () => {
    if (currentSongIndex() > 0) {
      setCurrentSongIndex(currentSongIndex() - 1);
    }
  };

  const goToNext = () => {
    if (currentSongIndex() < totalSongs() - 1) {
      setCurrentSongIndex(currentSongIndex() + 1);
    }
  };

  // mode toggle
  const toggleBulkMode = () => {
    setIsBulkMode(!isBulkMode());
  };

  // form change handler
  const handleFormChange = (data: any) => {
    setFormData(data);
  };

  // save handler
  const handleSave = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // TODO: implement save logic via api client
      console.log("saving song data:", {
        songs: props.songs,
        formData: formData(),
        isBulkMode: isBulkMode(),
      });

      events.emit("notification:show", {
        message: isBulkMode()
          ? `updated ${totalSongs()} songs`
          : "song updated successfully",
        type: "success",
      });

      // trigger data reload
      events.emit("data:reload", { type: "songs" });

      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to save changes");
    } finally {
      setIsLoading(false);
    }
  };

  const getModalTitle = () => {
    if (!isEditing()) {
      return totalSongs() > 1
        ? `song info (${totalSongs()} songs)`
        : "song info";
    }
    return isBulkMode() ? `edit ${totalSongs()} songs` : `edit song info`;
  };

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      size="lg"
      title={getModalTitle()}
    >
      <div class="flex flex-col min-h-96 max-h-[80vh]">
        {/* error display */}
        <Show when={error()}>
          <div class="bg-red-500/10 border border-red-500/20 text-red-400 p-3 mb-4">
            {error()}
          </div>
        </Show>

        {/* scrollable content area */}
        <div class="flex-1 overflow-y-auto">
          <Show when={!isEditing()}>
            {/* view-only mode */}
            <SongMetadataView
              songs={props.songs}
              currentSongIndex={currentSongIndex()}
            />
          </Show>

          <Show when={isEditing()}>
            <Show when={isBulkMode() && totalSongs() > 1}>
              {/* bulk edit mode */}
              <SongBulkEditForm
                songs={props.songs}
                onFormChange={handleFormChange}
              />
            </Show>

            <Show when={(!isBulkMode() || totalSongs() === 1) && currentSong()}>
              {/* single song edit mode */}
              <SongEditForm
                song={currentSong()!}
                onFormChange={handleFormChange}
              />
            </Show>
          </Show>
        </div>

        {/* sticky footer with pagination and actions */}
        <Show when={isEditing()}>
          <SongPagination
            currentIndex={currentSongIndex()}
            totalSongs={totalSongs()}
            isBulkMode={isBulkMode()}
            isLoading={isLoading()}
            onPrevious={goToPrevious}
            onNext={goToNext}
            onToggleBulkMode={toggleBulkMode}
            onCancel={props.onClose}
            onSave={handleSave}
          />
        </Show>

        {/* view-only mode footer */}
        <Show when={!isEditing()}>
          <div class="sticky bottom-0 bg-black border-t border-gray-700 p-4">
            <div class="flex items-center justify-between">
              {/* pagination for view-only mode */}
              <Show when={totalSongs() > 1}>
                <div class="flex items-center gap-2">
                  <button
                    class={`
                      px-3 py-1 text-sm transition-colors
                      ${
                        currentSongIndex() > 0
                          ? "text-white hover:text-magenta-400 hover:bg-gray-800"
                          : "text-gray-600 cursor-not-allowed"
                      }
                    `}
                    disabled={currentSongIndex() <= 0}
                    onClick={goToPrevious}
                  >
                    ← previous
                  </button>

                  <div class="text-sm text-gray-400 px-3">
                    {currentSongIndex() + 1} of {totalSongs()}
                  </div>

                  <button
                    class={`
                      px-3 py-1 text-sm transition-colors
                      ${
                        currentSongIndex() < totalSongs() - 1
                          ? "text-white hover:text-magenta-400 hover:bg-gray-800"
                          : "text-gray-600 cursor-not-allowed"
                      }
                    `}
                    disabled={currentSongIndex() >= totalSongs() - 1}
                    onClick={goToNext}
                  >
                    next →
                  </button>
                </div>
              </Show>

              {/* close button */}
              <button
                class="px-4 py-2 text-gray-400 hover:text-white transition-colors"
                onClick={props.onClose}
              >
                close
              </button>
            </div>
          </div>
        </Show>
      </div>
    </Modal>
  );
}
