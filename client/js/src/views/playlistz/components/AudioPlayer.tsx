/* @jsxImportSource solid-js */
import { Show } from "solid-js";
import { audioState, togglePlayback } from "../services/audioService.js";

interface AudioPlayerProps {
  class?: string;
  onClick?: () => void;
}

export function AudioPlayer(props: AudioPlayerProps) {
  const handleClick = () => {
    if (props.onClick) {
      props.onClick();
    } else {
      togglePlayback();
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={!audioState.currentSong() && !props.onClick}
      class={`inline-flex items-center justify-center w-12 h-12 bg-magenta-500 hover:bg-magenta-600 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-full text-white transition-colors ${props.class || ""}`}
      title={audioState.isPlaying() ? "Pause playlist" : "Play playlist"}
    >
      <Show
        when={audioState.isPlaying()}
        fallback={
          <svg class="w-6 h-6 ml-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fill-rule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
              clip-rule="evenodd"
            />
          </svg>
        }
      >
        <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
          <path
            fill-rule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
            clip-rule="evenodd"
          />
        </svg>
      </Show>
    </button>
  );
}
