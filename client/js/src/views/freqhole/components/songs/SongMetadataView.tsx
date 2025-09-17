import { Show } from "solid-js";
import type { Song } from "../../../../lib/music/schemas/song";

interface SongMetadataViewProps {
  songs: Song[];
  currentSongIndex: number;
}

export function SongMetadataView(props: SongMetadataViewProps) {
  const totalSongs = () => props.songs.length;
  const currentSong = () => props.songs[props.currentSongIndex];
  const isBulkMode = () => totalSongs() > 1;

  // determine if values are mixed across selected songs
  const getMixedOrValue = <T,>(getValue: (song: Song) => T): T | "mixed" => {
    if (props.songs.length === 0) return "mixed" as T | "mixed";

    const firstSong = props.songs[0];
    if (!firstSong) return "mixed" as T | "mixed";

    const firstValue = getValue(firstSong);
    const allSame = props.songs.every((song) => getValue(song) === firstValue);

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

      {/* single song header */}
      <Show when={totalSongs() === 1}>
        <div class="bg-gray-800/50 p-4 border border-gray-700">
          <div class="font-medium text-white mb-1">
            {currentSong()?.title || "untitled"}
          </div>
          <div class="text-sm text-gray-400">
            {currentSong()?.artist && `${currentSong()?.artist} • `}
            {currentSong()?.album || "no album"}
            {currentSong()?.year && ` • ${currentSong()?.year}`}
          </div>
        </div>
      </Show>

      {/* current song info during multi-song navigation */}
      <Show when={totalSongs() > 1 && props.currentSongIndex >= 0}>
        <div class="bg-gray-700/30 p-3 border border-gray-600">
          <div class="text-sm text-gray-300">
            currently viewing:{" "}
            <span class="text-white font-medium">
              {currentSong()?.title || "untitled"}
            </span>
            {currentSong()?.artist && ` by ${currentSong()?.artist}`}
          </div>
        </div>
      </Show>

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

      {/* user preference placeholders */}
      <div class="border-t border-gray-700 pt-4">
        <h3 class="text-sm font-medium text-gray-300 mb-3">user preferences</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="space-y-1">
            <div class="text-sm font-medium text-gray-400">rating</div>
            <div class="text-sm text-gray-500">
              // TODO: use SongStarRatingCompact component (read-only)
            </div>
          </div>

          <div class="space-y-1">
            <div class="text-sm font-medium text-gray-400">favorite</div>
            <div class="text-sm text-gray-500">
              // TODO: use SongFavoriteHeart component (read-only)
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
