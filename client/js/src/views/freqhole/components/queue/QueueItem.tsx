import { storeActions } from "../../store";

interface QueueItemProps {
  song: any;
  index: number;
  isCurrentlyPlaying: boolean;
  onRemove: () => void;
}

export function QueueItem(props: QueueItemProps) {
  // Detect if we're on mobile
  const isMobile = () => {
    return window.innerWidth <= 768 || "ontouchstart" in window;
  };

  const formatDuration = (seconds: number | undefined) => {
    if (!seconds) return "--:--";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleAdvanceToSong = () => {
    if (!props.isCurrentlyPlaying) {
      storeActions.setCurrentIndex(props.index);
      storeActions.playSong(props.song);
    }
  };

  return (
    <div
      class={`flex items-center p-3 rounded-lg group transition-all duration-200 border border-transparent cursor-pointer ${
        props.isCurrentlyPlaying
          ? "bg-magenta-600/30 text-white"
          : "hover:bg-magenta-600/20 text-white"
      }`}
      onClick={() => {
        if (isMobile()) {
          handleAdvanceToSong();
        }
      }}
      onDblClick={() => {
        if (!isMobile()) {
          handleAdvanceToSong();
        }
      }}
      title={
        props.isCurrentlyPlaying
          ? "currently playing"
          : isMobile()
            ? "tap to play"
            : "double-click to play"
      }
    >
      <div class="flex items-center gap-3 flex-1 min-w-0">
        <div class="w-6 text-center text-xs text-gray-400">
          {props.index + 1}
        </div>

        <div class="flex-1 min-w-0">
          <h4 class="text-sm font-medium truncate">
            {props.song.title || "Unknown Title"}
          </h4>
          <p class="text-xs text-gray-400 truncate">
            {props.song.artist || "Unknown Artist"}
          </p>
        </div>

        <div class="text-xs text-gray-400">
          {formatDuration(props.song.duration_seconds)}
        </div>
      </div>

      <button
        class="opacity-0 group-hover:opacity-100 p-2 ml-2 text-gray-500 hover:text-red-400 hover:bg-red-500/20 rounded-lg transition-all duration-200"
        onClick={(e) => {
          e.stopPropagation();
          props.onRemove();
        }}
        title="remove from queue"
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
  );
}
