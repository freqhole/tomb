import { Show } from "solid-js";
import { storeActions } from "../../store";

interface QueueHeaderProps {
  queueLength: number;
  onClear: () => void;
  activeTab: "queue" | "history";
  onTabChange: (tab: "queue" | "history") => void;
}

export function QueueHeader(props: QueueHeaderProps) {
  const handleToggleQueue = () => {
    storeActions.toggleQueue();
  };

  return (
    <div class="p-4 bg-black/90">
      {/* Tab Navigation */}
      <div class="flex items-center justify-between mb-4">
        <div class="flex">
          <button
            onClick={() => props.onTabChange("queue")}
            class={`px-3 py-1 text-sm font-medium transition-colors ${
              props.activeTab === "queue"
                ? "text-magenta-300 border-b-2 border-magenta-500"
                : "text-gray-400 hover:text-white"
            }`}
          >
            queue
          </button>
          <button
            onClick={() => props.onTabChange("history")}
            class={`px-3 py-1 text-sm font-medium transition-colors ml-4 ${
              props.activeTab === "history"
                ? "text-magenta-300 border-b-2 border-magenta-500"
                : "text-gray-400 hover:text-white"
            }`}
          >
            history
          </button>
        </div>

        <button
          onClick={handleToggleQueue}
          class="p-2 text-gray-400 hover:text-white hover:bg-magenta-600/30 rounded-lg transition-all duration-200"
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

      {/* Queue info and controls - always visible */}
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <Show when={props.activeTab === "queue" && props.queueLength > 0}>
            <span class="px-2 py-1 bg-magenta-500/30 text-magenta-300 text-xs rounded-full font-medium">
              {props.queueLength} song{props.queueLength !== 1 ? "s" : ""}
            </span>
          </Show>
          <Show when={props.activeTab === "history"}>
            <span class="text-gray-400 text-sm">recent listening activity</span>
          </Show>
        </div>

        <div class="flex gap-6">
          <Show when={props.activeTab === "queue" && props.queueLength > 0}>
            <button
              onClick={props.onClear}
              class="px-3 py-1 bg-magenta-600 text-black font-medium text-xs rounded-lg hover:bg-magenta-500 border border-transparent hover:border-magenta-400 transition-all duration-200"
              title="clear queue"
            >
              clear
            </button>
          </Show>
        </div>
      </div>
    </div>
  );
}
