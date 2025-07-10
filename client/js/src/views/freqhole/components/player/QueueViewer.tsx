/* @jsxImportSource solid-js */
import { Show, For } from "solid-js";
import { CloseIcon } from "../icons";
import { useMusicPlayer } from "../../context/FreqholeContext";

export const QueueViewer = () => {
  const player = useMusicPlayer();
  return (
    <Show when={player.showQueue()}>
      <div class="w-80 bg-black/30 flex flex-col animate-slideInRight">
        <div class="p-6 flex justify-between items-center bg-black/20">
          <h3 class="m-0 text-white text-lg font-medium lowercase">queue</h3>
          <div class="flex gap-2">
            <button
              onClick={player.clearQueue}
              class="bg-white/10 border-none text-white px-2 py-2 rounded cursor-pointer text-xs transition-colors duration-300 flex items-center gap-1 hover:bg-primary-500"
            >
              clear
            </button>
            <button
              onClick={player.toggleQueue}
              class="bg-white/10 border-none text-white px-2 py-2 rounded cursor-pointer text-xs transition-colors duration-300 flex items-center gap-1 hover:bg-primary-500"
            >
              <CloseIcon />
            </button>
          </div>
        </div>
        <div class="flex-1 overflow-y-auto p-4">
          <For each={player.playQueue()}>
            {(item, index) => (
              <div
                class={`flex items-center justify-between p-3 cursor-pointer transition-colors duration-300 rounded mb-2 ${
                  index() === player.currentQueueIndex()
                    ? "bg-primary-500/20"
                    : "hover:bg-white/10"
                }`}
                onClick={() => player.jumpToIndex(index())}
              >
                <div class="flex-1">
                  <h4 class="m-0 text-sm font-medium text-white">
                    {item.song.title}
                  </h4>
                  <p class="mt-1 mb-0 text-xs text-white/70">
                    {item.song.artist}
                  </p>
                </div>
                <button
                  class="bg-none border-none text-white/50 cursor-pointer p-1 transition-colors duration-300 flex items-center hover:text-primary-500"
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
            <div class="text-center p-8 text-white/50">queue is empty</div>
          </Show>
        </div>
      </div>
    </Show>
  );
};
