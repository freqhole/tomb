import {
  Show,
  For,
  onMount,
  onCleanup,
  createSignal,
  createEffect,
} from "solid-js";
import { CloseIcon, QueueIcon } from "../icons";
import { useMusicPlayer } from "../../context/FreqholeContext";

export const QueueViewer = () => {
  const player = useMusicPlayer();
  const [isSmallScreen, setIsSmallScreen] = createSignal(false);

  // Check screen size for responsive behavior
  const checkScreenSize = () => {
    const isMobile = window.innerWidth < 768;
    setIsSmallScreen(isMobile);
  };

  // Persist queue panel state
  onMount(() => {
    // Check initial screen size
    checkScreenSize();

    const savedQueueState = localStorage.getItem("freqhole-queue-visible");
    if (savedQueueState === "true") {
      player.setShowQueue(true);
    }

    // Listen for window resize
    window.addEventListener("resize", checkScreenSize);

    onCleanup(() => {
      window.removeEventListener("resize", checkScreenSize);
    });
  });

  // Auto-save queue state when it changes
  createEffect(() => {
    localStorage.setItem(
      "freqhole-queue-visible",
      player.showQueue().toString()
    );
  });

  // Keyboard shortcut for closing queue
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Escape" && player.showQueue()) {
        e.preventDefault();
        player.toggleQueue();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      document.removeEventListener("keydown", handleKeyDown);
    });
  });

  return (
    <Show when={player.showQueue()}>
      <div
        class={`${isSmallScreen() ? "fixed inset-0 z-50 bg-black/90" : "fixed top-0 right-0 bottom-0 w-80 z-50"} bg-black/40 backdrop-blur-sm flex flex-col animate-slideInRight shadow-2xl ${isSmallScreen() ? "" : "border-l border-white/10"}`}
      >
        <div
          class={`p-6 flex justify-between items-center bg-black/30 border-b border-white/10 ${isSmallScreen() ? "pt-8" : ""}`}
        >
          <div class="flex items-center gap-3">
            {player.playQueue().length > 0 && (
              <span class="px-2 py-1 bg-primary-500/80 text-white text-xs rounded-full font-medium">
                {player.playQueue().length} song
                {player.playQueue().length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div class="flex gap-2">
            <Show when={player.playQueue().length > 0}>
              <button
                onClick={player.clearQueue}
                class="bg-white/10 border-none text-white px-3 py-2 rounded cursor-pointer text-xs transition-all duration-300 flex items-center gap-1 hover:bg-red-500/80 hover:scale-105"
                title="Clear queue"
              >
                clear
              </button>
            </Show>
            <button
              onClick={player.toggleQueue}
              class="bg-white/10 border-none text-white px-2 py-2 rounded cursor-pointer text-xs transition-all duration-300 flex items-center gap-1 hover:bg-primary-500/80 hover:scale-105"
              title="Close queue (Esc)"
            >
              <CloseIcon />
            </button>
          </div>
        </div>
        <div
          class={`flex-1 overflow-y-auto p-4 custom-scrollbar ${isSmallScreen() ? "pb-20" : ""}`}
        >
          <For each={player.playQueue()}>
            {(item, index) => (
              <div
                class={`flex items-center justify-between p-3 cursor-pointer queue-item-hover rounded-lg mb-2 group ${
                  index() === player.currentQueueIndex()
                    ? "bg-primary-500/20 border border-primary-500/30"
                    : "hover:bg-white/10"
                }`}
                onClick={() => player.jumpToIndex(index())}
              >
                <div class="flex-1 min-w-0">
                  <h4 class="m-0 text-sm font-medium text-white truncate">
                    {item.song.title}
                  </h4>
                  <p class="mt-1 mb-0 text-xs text-white/70 truncate">
                    {item.song.artist || "Unknown Artist"}
                  </p>
                  {index() === player.currentQueueIndex() && (
                    <div class="flex items-center gap-1 mt-1">
                      <div class="w-2 h-2 bg-primary-500 rounded-full now-playing-pulse"></div>
                      <span class="text-xs text-primary-400 font-medium">
                        Now Playing
                      </span>
                    </div>
                  )}
                </div>
                <button
                  class="bg-none border-none text-white/50 cursor-pointer p-2 transition-all duration-300 flex items-center hover:text-red-400 hover:bg-red-500/10 rounded-md opacity-0 group-hover:opacity-100 hover:scale-110"
                  onClick={(e) => {
                    e.stopPropagation();
                    player.removeFromQueue(item.id);
                  }}
                  title="Remove from queue"
                >
                  <CloseIcon />
                </button>
              </div>
            )}
          </For>
          <Show when={player.playQueue().length === 0}>
            <div class={`text-center ${isSmallScreen() ? "p-20" : "p-12"}`}>
              <div class="w-16 h-16 mx-auto mb-4 bg-white/5 rounded-full flex items-center justify-center">
                <QueueIcon className="text-white/30 w-8 h-8" />
              </div>
              <p class="text-white/50 text-sm">Queue is empty</p>
              <p class="text-white/30 text-xs mt-2">
                Add songs to see them here
              </p>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
};
