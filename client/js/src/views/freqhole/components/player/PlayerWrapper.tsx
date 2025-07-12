import { Player } from "./Player";
import { useQueue, storeActions } from "../../store";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";
import { createEffect } from "solid-js";

export function PlayerWrapper() {
  const [queue] = useQueue();
  const events = useGlobalEvents();

  // Listen for player events and sync with store
  createEffect(() => {
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
        storeActions.playSong(nextSong);
      }
    });

    events.on("queue:previous", () => {
      const prevIndex = queue.currentIndex - 1;
      if (prevIndex >= 0) {
        const prevSong = queue.items[prevIndex];
        storeActions.setCurrentIndex(prevIndex);
        storeActions.playSong(prevSong);
      }
    });
  });

  return <Player />;
}
