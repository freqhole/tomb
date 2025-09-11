import { Show } from "solid-js";
import type { Song } from "../../../../lib/music/schemas/song";
import { SongStarRating, SongFavoriteHeart } from "../ui";

export interface FreqholeSongRowProps {
  song: Song;
  index: number;
  variant: "desktop" | "mobile" | "compact";
  selected?: boolean;
  onPlay?: (song: Song) => void;
  onRatingChange?: (song: Song, rating: number) => void;
  onFavoriteToggle?: (song: Song) => void;
  class?: string;
}

/**
 * song row component for freqhole infinite grid
 * supports different variants for desktop, mobile, and compact views
 */
export function FreqholeSongRow(props: FreqholeSongRowProps) {
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handlePlayClick = (e: MouseEvent) => {
    e.stopPropagation();
    props.onPlay?.(props.song);
  };

  const handleRatingChange = (rating: number) => {
    props.onRatingChange?.(props.song, rating);
  };

  const handleFavoriteToggle = () => {
    props.onFavoriteToggle?.(props.song);
  };

  // Desktop variant - full featured table row
  const renderDesktop = () => (
    <div
      class={`grid grid-cols-[auto_1fr_1fr_1fr_auto_auto_auto] gap-4 px-6 py-3 items-center hover:bg-gray-800/50 transition-colors ${
        props.selected ? "bg-magenta-500/20" : ""
      } ${props.class || ""}`}
    >
      {/* Index and play button */}
      <div class="flex items-center gap-2 w-16">
        <button
          class="w-8 h-8 rounded-full bg-magenta-600 hover:bg-magenta-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={handlePlayClick}
          title="play song"
        >
          <span class="text-white text-xs">▶</span>
        </button>
        <div class="text-right text-gray-400 text-sm flex-1">
          {props.index + 1}
        </div>
      </div>

      {/* Title */}
      <div class="font-medium text-white truncate">
        {props.song.title || "untitled"}
      </div>

      {/* Artist */}
      <div class="text-gray-300 truncate">
        {props.song.artist || "unknown artist"}
      </div>

      {/* Album */}
      <div class="text-gray-300 truncate">
        {props.song.album || "unknown album"}
      </div>

      {/* Year */}
      <div class="text-center text-gray-400 text-sm w-16">
        {props.song.year || "—"}
      </div>

      {/* Rating */}
      <div class="w-24 flex justify-center">
        <SongStarRating
          song={props.song}
          onRate={(_songId, rating) => handleRatingChange(rating)}
          size="sm"
        />
      </div>

      {/* Duration */}
      <div class="text-center text-gray-400 text-sm w-16">
        {props.song.duration_seconds
          ? formatDuration(props.song.duration_seconds)
          : "—"}
      </div>
    </div>
  );

  // Mobile variant - simplified card layout
  const renderMobile = () => (
    <div
      class={`p-4 hover:bg-gray-800/50 transition-colors border-b border-gray-800/50 ${
        props.selected ? "bg-magenta-500/20" : ""
      } ${props.class || ""}`}
    >
      <div class="flex items-center gap-3">
        {/* Play button */}
        <button
          class="w-10 h-10 rounded-full bg-magenta-600 hover:bg-magenta-500 flex items-center justify-center flex-shrink-0"
          onClick={handlePlayClick}
          title="play song"
        >
          <span class="text-white text-sm">▶</span>
        </button>

        {/* Song info */}
        <div class="flex-1 min-w-0">
          <div class="font-medium text-white mb-1 truncate">
            {props.song.title || "untitled"}
          </div>
          <div class="text-sm text-gray-400 truncate">
            {props.song.artist || "unknown artist"}
            <Show when={props.song.album}>
              <span> • {props.song.album}</span>
            </Show>
          </div>
        </div>

        {/* Duration and favorite */}
        <div class="flex-shrink-0 flex items-center gap-2">
          <Show when={props.song.duration_seconds}>
            <div class="text-xs text-gray-500">
              {formatDuration(props.song.duration_seconds!)}
            </div>
          </Show>
          <SongFavoriteHeart
            song={props.song}
            onToggle={(_songId, _isFavorite) => handleFavoriteToggle()}
            size="sm"
          />
        </div>
      </div>

      {/* Rating row for mobile */}
      <Show when={props.song.user_rating && props.song.user_rating > 0}>
        <div class="mt-2 flex justify-start">
          <SongStarRating
            song={props.song}
            onRate={(_songId, rating) => handleRatingChange(rating)}
            size="sm"
            readonly={true}
          />
        </div>
      </Show>
    </div>
  );

  // Compact variant - minimal for embedded use
  const renderCompact = () => (
    <div
      class={`flex items-center gap-3 p-2 hover:bg-gray-800/50 transition-colors ${
        props.selected ? "bg-magenta-500/20" : ""
      } ${props.class || ""}`}
    >
      {/* Play button */}
      <button
        class="w-6 h-6 rounded-full bg-magenta-600 hover:bg-magenta-500 flex items-center justify-center flex-shrink-0"
        onClick={handlePlayClick}
        title="play song"
      >
        <span class="text-white text-xs">▶</span>
      </button>

      {/* Song info */}
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium text-white truncate">
          {props.song.title || "untitled"}
        </div>
        <div class="text-xs text-gray-400 truncate">
          {props.song.artist || "unknown artist"}
        </div>
      </div>

      {/* Duration */}
      <Show when={props.song.duration_seconds}>
        <div class="text-xs text-gray-500 flex-shrink-0">
          {formatDuration(props.song.duration_seconds!)}
        </div>
      </Show>
    </div>
  );

  // Render based on variant
  switch (props.variant) {
    case "mobile":
      return renderMobile();
    case "compact":
      return renderCompact();
    case "desktop":
    default:
      return renderDesktop();
  }
}
