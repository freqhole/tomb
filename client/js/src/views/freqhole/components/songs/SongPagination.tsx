import { Show } from "solid-js";

interface SongPaginationProps {
  currentIndex: number;
  totalSongs: number;
  isBulkMode: boolean;
  isLoading: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onToggleBulkMode: () => void;
  onCancel: () => void;
  onSave: () => void;
}

export function SongPagination(props: SongPaginationProps) {
  const canGoPrevious = () => props.currentIndex > 0;
  const canGoNext = () => props.currentIndex < props.totalSongs - 1;
  const saveButtonText = () => {
    if (props.isLoading) return "saving...";
    if (props.isBulkMode && props.totalSongs > 1) {
      return `save ${props.totalSongs} changes`;
    }
    return "save changes";
  };

  return (
    <div class="sticky bottom-0 bg-black p-4">
      <div class="flex items-center justify-between">
        {/* left side - pagination controls */}
        <div class="flex items-center gap-4">
          <Show when={props.totalSongs > 1}>
            {/* bulk mode toggle */}
            {/*<button
              class={`
                px-3 py-1 text-sm transition-colors
                ${
                  props.isBulkMode
                    ? "bg-magenta-600 text-white"
                    : "text-gray-400 hover:text-white hover:bg-gray-800"
                }
              `}
              onClick={props.onToggleBulkMode}
              disabled={props.isLoading}
              title={props.isBulkMode ? "switch to individual mode" : "switch to bulk mode"}
            >
              {props.isBulkMode ? "bulk edit" : "bulk edit"}
            </button>*/}

            {/* pagination controls - only show when not in bulk mode */}
            <Show when={!props.isBulkMode}>
              <div class="flex items-center gap-2">
                <button
                  class={`
                    px-3 py-1 text-sm transition-colors
                    ${
                      canGoPrevious()
                        ? "text-white hover:text-magenta-400 hover:bg-gray-800"
                        : "text-gray-600 cursor-not-allowed"
                    }
                  `}
                  disabled={!canGoPrevious() || props.isLoading}
                  onClick={props.onPrevious}
                >
                  ← previous
                </button>

                <div class="text-sm text-gray-400 px-3">
                  {props.currentIndex + 1} of {props.totalSongs}
                </div>

                <button
                  class={`
                    px-3 py-1 text-sm transition-colors
                    ${
                      canGoNext()
                        ? "text-white hover:text-magenta-400 hover:bg-gray-800"
                        : "text-gray-600 cursor-not-allowed"
                    }
                  `}
                  disabled={!canGoNext() || props.isLoading}
                  onClick={props.onNext}
                >
                  next →
                </button>
              </div>
            </Show>
          </Show>
        </div>

        {/* right side - action buttons */}
        <div class="flex items-center gap-3">
          <button
            class="px-4 py-2 text-gray-400 hover:text-white transition-colors"
            onClick={props.onCancel}
            disabled={props.isLoading}
          >
            cancel
          </button>
          <button
            class="px-4 py-2 bg-magenta-600 hover:bg-magenta-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={props.onSave}
            disabled={props.isLoading}
          >
            {saveButtonText()}
          </button>
        </div>
      </div>
    </div>
  );
}
