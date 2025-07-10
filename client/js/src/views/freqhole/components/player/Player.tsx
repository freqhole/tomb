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
      <div class="zune-player">
        <div class="zune-player-info">
          <div class="zune-player-artwork">
            <Show
              when={props.currentSong?.thumbnail_blob_id}
              fallback={
                <div class="zune-artwork-placeholder small">
                  <MusicIcon />
                </div>
              }
            >
              <img
                src={`http://localhost:8080/api/blobs/${props.currentSong?.thumbnail_blob_id}`}
                alt={props.currentSong?.title}
                class="zune-artwork-image small"
              />
            </Show>
          </div>
          <div class="zune-player-text">
            <h4 class="zune-player-title">{props.currentSong?.title}</h4>
            <p class="zune-player-artist">{props.currentSong?.artist}</p>
          </div>
        </div>

        <div class="zune-player-controls">
          <button
            class="zune-control-btn"
            onClick={props.onPlayPrevious}
            disabled={!props.canGoPrevious}
          >
            <PrevIcon />
          </button>
          <button
            class="zune-control-btn primary"
            onClick={props.onTogglePlayback}
          >
            {props.isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            class="zune-control-btn"
            onClick={props.onPlayNext}
            disabled={!props.canGoNext}
          >
            <NextIcon />
          </button>
          <button
            class="zune-control-btn"
            onClick={props.onToggleQueue}
            title="Show Queue"
          >
            <QueueIcon />
          </button>
        </div>

        {/* Loading/Error States */}
        <Show when={props.isLoading}>
          <div class="zune-player-loading">
            <div class="zune-spinner"></div>
          </div>
        </Show>

        <Show when={props.error}>
          <div class="zune-player-error">
            <span class="zune-error-text">{props.error}</span>
          </div>
        </Show>

        <div class="zune-player-progress">
          <span class="zune-time">{props.formatTime(props.currentTime)}</span>
          <div
            class="zune-progress-bar"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const percentage = ((e.clientX - rect.left) / rect.width) * 100;
              props.onSeekTo(percentage);
            }}
          >
            <div
              class="zune-progress-fill"
              style={{
                width: `${props.duration > 0 ? (props.currentTime / props.duration) * 100 : 0}%`,
              }}
            ></div>
          </div>
          <span class="zune-time">{props.formatTime(props.duration)}</span>
        </div>

        <div class="zune-player-volume">
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
            class="zune-volume-slider"
          />
        </div>
      </div>
    </Show>
  );
};
