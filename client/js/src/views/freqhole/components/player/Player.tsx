/* @jsxImportSource solid-js */
import { Show } from "solid-js";
import {
  PlayIcon,
  PauseIcon,
  PrevIcon,
  NextIcon,
  QueueIcon,
  VolumeIcon,
  MusicIcon,
} from "../icons";

import { Song, QueueItem } from "../../hooks";

export interface PlayerProps {
  currentSong: Song | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  currentQueueIndex: number;
  playQueue: QueueItem[];
  showQueue: boolean;
  canGoNext: boolean;
  canGoPrevious: boolean;
  isLoading?: boolean;
  error?: string | null;
  onTogglePlayback: () => void;
  onPlayPrevious: () => void;
  onPlayNext: () => void;
  onSeekTo: (percentage: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleQueue: () => void;
  formatTime: (seconds: number) => string;
}

export const Player = (props: PlayerProps) => {
  return (
    <Show when={props.currentSong}>
      <div class="sticky bottom-0 left-0 right-0 bg-black/50 backdrop-blur-xl px-8 py-4 flex items-center gap-8 z-50 metro-slide-up">
        <div class="flex items-center gap-4 min-w-60 w-full">
          <div class="w-12 h-12">
            <Show
              when={props.currentSong?.thumbnail_blob_id}
              fallback={
                <div class="w-12 h-12 bg-gradient-to-br from-gray-600 to-gray-700 rounded flex items-center justify-center text-white/30">
                  <MusicIcon />
                </div>
              }
            >
              <img
                src={`http://localhost:8080/api/blobs/${props.currentSong?.thumbnail_blob_id}`}
                alt={props.currentSong?.title}
                class="w-12 h-12 rounded object-cover"
              />
            </Show>
          </div>
          <div class="flex-1">
            <h4 class="text-base font-medium m-0 text-white">
              {props.currentSong?.title}
            </h4>
            <p class="text-sm font-light m-0 text-white/70">
              {props.currentSong?.artist}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-4">
          <button
            class="w-11 h-11 border-none rounded-full bg-white/10 text-white cursor-pointer transition-all duration-300 flex items-center justify-center hover:bg-white/20 hover:scale-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none"
            onClick={props.onPlayPrevious}
            disabled={!props.canGoPrevious}
          >
            <PrevIcon />
          </button>
          <button
            class="w-12 h-12 border-none rounded-full bg-gradient-to-br from-primary-500 to-primary-600 text-white cursor-pointer transition-all duration-300 flex items-center justify-center hover:from-primary-400 hover:to-primary-500"
            onClick={props.onTogglePlayback}
          >
            {props.isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            class="w-11 h-11 border-none rounded-full bg-white/10 text-white cursor-pointer transition-all duration-300 flex items-center justify-center hover:bg-white/20 hover:scale-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none"
            onClick={props.onPlayNext}
            disabled={!props.canGoNext}
          >
            <NextIcon />
          </button>
          <button
            class="w-11 h-11 border-none rounded-full bg-white/10 text-white cursor-pointer transition-all duration-300 flex items-center justify-center hover:bg-white/20 hover:scale-110"
            onClick={props.onToggleQueue}
            title="Show Queue"
          >
            <QueueIcon />
          </button>
        </div>

        {/* Loading/Error States */}
        <Show when={props.isLoading}>
          <div class="flex items-center gap-2 text-white/60">
            <div class="w-4 h-4 border-2 border-white/30 border-t-primary-500 rounded-full animate-spin"></div>
          </div>
        </Show>

        <Show when={props.error}>
          <div class="flex items-center gap-2">
            <span class="text-red-400 text-xs">{props.error}</span>
          </div>
        </Show>

        <div class="flex items-center gap-4 flex-1 max-w-96">
          <span class="text-sm text-white/70 font-light min-w-10">
            {props.formatTime(props.currentTime)}
          </span>
          <div
            class="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden cursor-pointer transition-all duration-200 hover:h-2 min-w-24"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const percentage = ((e.clientX - rect.left) / rect.width) * 100;
              props.onSeekTo(percentage);
            }}
          >
            <div
              class="h-full bg-gradient-to-r from-primary-500 to-primary-600 transition-all duration-100"
              style={{
                width: `${props.duration > 0 ? (props.currentTime / props.duration) * 100 : 0}%`,
              }}
            ></div>
          </div>
          <span class="text-sm text-white/70 font-light min-w-10">
            {props.formatTime(props.duration)}
          </span>
        </div>

        <div class="flex items-center gap-2">
          <VolumeIcon />
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={props.volume}
            onInput={(e) => {
              const newVolume = parseFloat(e.currentTarget.value);
              props.onVolumeChange(newVolume);
            }}
            class="w-24 h-1 bg-white/20 border-none rounded-full outline-none appearance-none cursor-pointer slider"
          />
        </div>
      </div>
    </Show>
  );
};
