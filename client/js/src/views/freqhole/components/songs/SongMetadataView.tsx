import { Show, createSignal, createEffect } from "solid-js";
import type { Song } from "../../../../lib/music/schemas/song";
import { SongRatingField } from "../forms/SongRatingField";
import { SongFavoriteField } from "../forms/SongFavoriteField";
import { apiClient } from "../../../../lib/api-client";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";
import { ImageCarousel } from "./ImageCarousel";

interface SongMetadataViewProps {
  songs: Song[];
  currentSongIndex: number;
  onSongChange?: (index: number) => void;
  isBulkMode?: boolean;
}

export function SongMetadataView(props: SongMetadataViewProps) {
  const events = useGlobalEvents();
  const [isUpdating, setIsUpdating] = createSignal(false);
  const [localSongs, setLocalSongs] = createSignal(props.songs);

  // Update local songs when props change
  createEffect(() => {
    setLocalSongs(props.songs);
  });

  const totalSongs = () => localSongs().length;
  const currentSong = () => localSongs()[props.currentSongIndex];
  const isBulkMode = () => props.isBulkMode || false;
  const isMultipleSongs = () => totalSongs() > 1;
  const canGoPrevious = () => props.currentSongIndex > 0;
  const canGoNext = () => props.currentSongIndex < totalSongs() - 1;

  const goToPrevious = () => {
    if (canGoPrevious() && props.onSongChange) {
      props.onSongChange(props.currentSongIndex - 1);
    }
  };

  const goToNext = () => {
    if (canGoNext() && props.onSongChange) {
      props.onSongChange(props.currentSongIndex + 1);
    }
  };

  // determine if values are mixed across selected songs
  const getMixedOrValue = <T,>(getValue: (song: Song) => T): T | "mixed" => {
    const songs = localSongs();
    if (songs.length === 0) return "mixed" as T | "mixed";

    const firstSong = songs[0];
    if (!firstSong) return "mixed" as T | "mixed";

    const firstValue = getValue(firstSong);
    const allSame = songs.every((song) => getValue(song) === firstValue);

    return allSame ? firstValue : "mixed";
  };

  // render a metadata field with mixed value support
  const renderMetadataField = (
    label: string,
    getValue: (song: Song) => string | number | null
  ) => {
    let displayValue: string;
    let isMixed = false;

    if (isBulkMode()) {
      const value = getMixedOrValue(getValue);
      if (value === "mixed") {
        displayValue = "mixed values";
        isMixed = true;
      } else {
        displayValue = value ? String(value) : "—";
      }
    } else {
      const song = currentSong();
      if (!song) {
        displayValue = "—";
      } else {
        const value = getValue(song);
        displayValue = value ? String(value) : "—";
      }
    }

    return (
      <div class="space-y-1">
        <div class="text-sm font-medium text-gray-400">{label}</div>
        <div class={`text-white ${isMixed ? "text-yellow-400 italic" : ""}`}>
          {displayValue}
        </div>
      </div>
    );
  };

  return (
    <div class="space-y-6">
      {/* navigation - shown when multiple songs and not in bulk mode */}
      <Show when={isMultipleSongs() && !isBulkMode()}>
        <div class="flex items-center justify-between pb-4 border-b border-gray-700">
          <div class="flex items-center gap-4">
            <button
              onClick={goToPrevious}
              class="px-3 py-1 text-sm text-gray-300 hover:text-white transition-colors disabled:opacity-50"
              disabled={!canGoPrevious()}
            >
              ← previous
            </button>
            <span class="text-sm text-gray-400">
              {props.currentSongIndex + 1} of {totalSongs()}
            </span>
            <button
              onClick={goToNext}
              class="px-3 py-1 text-sm text-gray-300 hover:text-white transition-colors disabled:opacity-50"
              disabled={!canGoNext()}
            >
              next →
            </button>
          </div>
        </div>
      </Show>

      {/* bulk mode header */}
      <Show when={isBulkMode()}>
        <div class="bg-gray-800/50 p-4 border border-gray-700">
          <div class="flex items-center justify-between">
            <div class="text-sm text-gray-400">
              viewing metadata for {totalSongs()} songs
            </div>
            <div class="text-sm text-gray-400">
              yellow text indicates mixed values
            </div>
          </div>
        </div>
      </Show>

      {/* song info header - for single song or current song in navigation */}
      <Show when={currentSong()}>
        <div class="bg-gray-800/50 p-4 border border-gray-700">
          <div class="font-medium text-white mb-1">
            {isMultipleSongs() ? "viewing: " : ""}
            {currentSong()?.title || "untitled"}
          </div>
          <div class="text-sm text-gray-400">
            {currentSong()?.artist && `${currentSong()?.artist} • `}
            {currentSong()?.album || "no album"}
            {currentSong()?.year && ` • ${currentSong()?.year}`}
          </div>
        </div>
      </Show>

      {/* image carousel */}
      <ImageCarousel
        songs={localSongs()}
        currentSongIndex={props.currentSongIndex}
        isBulkMode={isBulkMode()}
      />

      {/* metadata fields */}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* basic metadata */}
        {renderMetadataField("title", (s) => s.title)}
        {renderMetadataField("artist", (s) => s.artist)}
        {renderMetadataField("album", (s) => s.album)}
        {renderMetadataField("album artist", (s) => s.album_artist)}

        {/* track info */}
        {renderMetadataField("track number", (s) => s.track_number)}
        {renderMetadataField("disc number", (s) => s.disc_number)}

        {/* additional metadata */}
        {renderMetadataField("genre", (s) => s.genre)}
        {renderMetadataField("year", (s) => s.year)}
        {renderMetadataField("bpm", (s) => s.bpm)}
        {renderMetadataField("key signature", (s) => s.key_signature)}

        {/* duration */}
        {renderMetadataField("duration", (s) => {
          if (!s.duration_seconds) return null;
          const mins = Math.floor(s.duration_seconds / 60);
          const secs = s.duration_seconds % 60;
          return `${mins}:${secs.toString().padStart(2, "0")}`;
        })}

        {/* file info */}
        {renderMetadataField(
          "media id",
          (s) => s.media_blob_id.slice(0, 8) + "..."
        )}
      </div>

      {/* user preferences */}
      <div class="border-t border-gray-700 pt-4">
        <h3 class="text-sm font-medium text-gray-300 mb-3">user preferences</h3>
        <Show when={!isBulkMode() && currentSong()}>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <SongRatingField
              value={currentSong()?.user_rating || null}
              isDirty={false}
              disabled={isUpdating()}
              onUpdate={async (rating) => {
                const song = currentSong();
                if (!song) return;

                try {
                  setIsUpdating(true);

                  // Optimistically update local state first
                  const updatedSong = { ...song, user_rating: rating };
                  setLocalSongs((prev) =>
                    prev.map((s) => (s.id === song.id ? updatedSong : s))
                  );

                  await apiClient.rateSong(song.id, rating || 0);

                  // Emit events for other components
                  events.emit("songs:updated", {
                    songs: [updatedSong],
                    operation: "single-update",
                  });

                  events.emit("notification:show", {
                    message: rating
                      ? `rated ${rating} stars`
                      : "rating removed",
                    type: "success",
                  });
                } catch (error) {
                  console.error("failed to update rating:", error);
                  // Revert local state on error
                  setLocalSongs((prev) =>
                    prev.map((s) => (s.id === song.id ? song : s))
                  );
                  events.emit("notification:show", {
                    message: "failed to update rating",
                    type: "error",
                  });
                } finally {
                  setIsUpdating(false);
                }
              }}
              onReset={() => {}}
            />

            <SongFavoriteField
              value={currentSong()?.user_is_favorite || false}
              isDirty={false}
              disabled={isUpdating()}
              onUpdate={async (isFavorite) => {
                const song = currentSong();
                if (!song) return;

                try {
                  setIsUpdating(true);

                  // Optimistically update local state first
                  const updatedSong = { ...song, user_is_favorite: isFavorite };
                  setLocalSongs((prev) =>
                    prev.map((s) => (s.id === song.id ? updatedSong : s))
                  );

                  await apiClient.toggleSongFavorite(song.id, isFavorite);

                  // Emit events for other components
                  events.emit("songs:updated", {
                    songs: [updatedSong],
                    operation: "single-update",
                  });

                  events.emit("notification:show", {
                    message: isFavorite
                      ? "added to favorites"
                      : "removed from favorites",
                    type: "success",
                  });
                } catch (error) {
                  console.error("failed to update favorite:", error);
                  // Revert local state on error
                  setLocalSongs((prev) =>
                    prev.map((s) => (s.id === song.id ? song : s))
                  );
                  events.emit("notification:show", {
                    message: "failed to update favorite",
                    type: "error",
                  });
                } finally {
                  setIsUpdating(false);
                }
              }}
              onReset={() => {}}
            />
          </div>
        </Show>
      </div>
    </div>
  );
}
