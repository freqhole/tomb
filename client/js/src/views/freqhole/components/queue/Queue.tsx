import { For, Show } from "solid-js";
import { useQueue, storeActions } from "../../store";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";
import { QueueHeader } from "./QueueHeader";
import { QueueItem } from "./QueueItem";

export function Queue() {
  const [queue] = useQueue();
  const events = useGlobalEvents();

  // Listen for queue events
  events.on("queue:add", ({ song }) => {
    storeActions.addToQueue(song);
  });

  events.on("queue:remove", ({ index }) => {
    storeActions.removeFromQueue(index);
  });

  events.on("queue:clear", () => {
    storeActions.clearQueue();
  });

  events.on("queue:replace", ({ songs }) => {
    storeActions.clearQueue();
    songs.forEach((song) => storeActions.addToQueue(song));
  });

  events.on("song:play", ({ song, replaceQueue }) => {
    if (replaceQueue) {
      storeActions.clearQueue();
      storeActions.addToQueue(song);
      storeActions.setCurrentIndex(0);
    } else {
      // Add to queue if not already there
      const existingIndex = queue.items.findIndex(item => item.id === song.id);
      if (existingIndex === -1) {
        storeActions.addToQueue(song);
        storeActions.setCurrentIndex(queue.items.length);
      } else {
        storeActions.setCurrentIndex(existingIndex);
      }
    }
    storeActions.playSong(song);
  });

  const handleRemoveFromQueue = (index: number) => {
    events.emit("queue:remove", { index });
  };

  const handleClearQueue = () => {
    events.emit("queue:clear", {});
  };

  const handlePlayFromQueue = (index: number) => {
    const song = queue.items[index];
    if (song) {
      storeActions.setCurrentIndex(index);
      events.emit("song:play", { song });
    }
  };

  return (
    <div class="flex flex-col h-full bg-black/80">
      <QueueHeader
        queueLength={queue.items.length}
        onClear={handleClearQueue}
      />

      <div class="flex-1 overflow-y-auto p-4">
        <Show
          when={queue.items.length > 0}
          fallback={
            <div class="text-center py-12">
              <div class="w-16 h-16 mx-auto mb-4 bg-gray-800 rounded-full flex items-center justify-center">
                <svg class="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
              </div>
              <p class="text-gray-400 text-sm">queue is empty</p>
              <p class="text-gray-500 text-xs mt-2">add songs to see them here</p>
            </div>
          }
        >
          <div class="space-y-1">
            <For each={queue.items}>
              {(song, index) => (
                <QueueItem
                  song={song}
                  index={index()}
                  isCurrentlyPlaying={index() === queue.currentIndex}
                  onPlay={() => handlePlayFromQueue(index())}
                  onRemove={() => handleRemoveFromQueue(index())}
                />
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
