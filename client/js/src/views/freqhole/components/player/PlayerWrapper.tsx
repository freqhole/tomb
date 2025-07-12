import { usePlayer, useQueue, storeActions } from "../../store";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";

export function PlayerWrapper() {
  const [player] = usePlayer();
  const [queue] = useQueue();
  const events = useGlobalEvents();

  // Listen for player events and sync with store
  events.on("player:play", () => {
    storeActions.togglePlay();
  });

  events.on("player:pause", () => {
    storeActions.togglePlay();
  });

  events.on("player:volume", ({ volume }) => {
    storeActions.setVolume(volume);
  });

  events.on("player:seek", ({ time }) => {
    storeActions.setCurrentTime(time);
  });

  events.on("queue:next", () => {
    const nextIndex = queue.currentIndex + 1;
    if (nextIndex < queue.items.length) {
      const nextSong = queue.items[nextIndex];
      storeActions.setCurrentIndex(nextIndex);
      events.emit("song:play", { song: nextSong });
    }
  });

  events.on("queue:previous", () => {
    const prevIndex = queue.currentIndex - 1;
    if (prevIndex >= 0) {
      const prevSong = queue.items[prevIndex];
      storeActions.setCurrentIndex(prevIndex);
      events.emit("song:play", { song: prevSong });
    }
  });

  // For now, we'll use the existing Player component
  // TODO: Update existing Player to use store instead of old context
  return (
    <div class="bg-black">
      <div class="flex items-center justify-between p-4">
        <div class="flex items-center gap-4 flex-1">
          {/* Song Info */}
          {player.currentSong ? (
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 bg-gray-800 rounded-lg flex items-center justify-center">
                <svg
                  class="w-6 h-6 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                  />
                </svg>
              </div>
              <div class="min-w-0">
                <div class="text-white font-medium truncate">
                  {player.currentSong.title}
                </div>
                <div class="text-gray-400 text-sm truncate">
                  {player.currentSong.artist}
                </div>
              </div>
            </div>
          ) : (
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 bg-gray-800 rounded-lg flex items-center justify-center">
                <svg
                  class="w-6 h-6 text-gray-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                  />
                </svg>
              </div>
              <div class="text-gray-500 text-sm">no song playing</div>
            </div>
          )}
        </div>

        {/* Player Controls */}
        <div class="flex items-center gap-2">
          <button
            onClick={() => events.emit("queue:previous", {})}
            class="p-2 text-gray-400 hover:text-white hover:bg-magenta-600/30 rounded-lg transition-all duration-200"
            disabled={queue.currentIndex <= 0}
          >
            <svg
              class="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>

          <button
            onClick={() =>
              events.emit(player.isPlaying ? "player:pause" : "player:play", {})
            }
            class="p-3 bg-magenta-600 text-black font-medium rounded-lg hover:bg-magenta-500 border border-transparent hover:border-magenta-400 focus:bg-magenta-700 transition-all duration-200"
            disabled={!player.currentSong}
          >
            {player.isPlaying ? (
              <svg
                class="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M10 9v6m4-6v6"
                />
              </svg>
            ) : (
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <button
            onClick={() => events.emit("queue:next", {})}
            class="p-2 text-gray-400 hover:text-white hover:bg-magenta-600/30 rounded-lg transition-all duration-200"
            disabled={queue.currentIndex >= queue.items.length - 1}
          >
            <svg
              class="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        </div>

        {/* Queue Toggle */}
        <div class="flex items-center gap-4 flex-1 justify-end">
          <button
            onClick={() => storeActions.toggleQueue()}
            class="p-2 text-gray-400 hover:text-white hover:bg-magenta-600/30 rounded-lg transition-all duration-200"
            title="toggle queue"
          >
            <svg
              class="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 6h16M4 10h16M4 14h16M4 18h16"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
