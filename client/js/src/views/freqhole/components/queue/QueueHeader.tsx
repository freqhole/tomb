import { Show } from "solid-js";
import { storeActions } from "../../store";

interface QueueHeaderProps {
  queueLength: number;
  onClear: () => void;
}

export function QueueHeader(props: QueueHeaderProps) {
  const handleToggleQueue = () => {
    storeActions.toggleQueue();
  };

  return (
    <div class="p-4 bg-black/90">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <h3 class="text-lg font-semibold text-white">queue</h3>
          <Show when={props.queueLength > 0}>
            <span class="px-2 py-1 bg-magenta-500/30 text-magenta-300 text-xs rounded-full font-medium">
              {props.queueLength} song{props.queueLength !== 1 ? "s" : ""}
            </span>
          </Show>
        </div>

        <div class="flex gap-2">
          <Show when={props.queueLength > 0}>
            <button
              onClick={props.onClear}
              class="px-3 py-1 bg-gray-800 text-white text-xs rounded-lg hover:bg-red-500/80 focus:bg-red-600 transition-all duration-200"
              title="clear queue"
            >
              clear
            </button>
          </Show>

          <button
            onClick={handleToggleQueue}
            class="p-2 bg-gray-800 text-white rounded-lg hover:bg-magenta-500/20 focus:bg-magenta-500/30 transition-all duration-200"
            title="close queue"
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
