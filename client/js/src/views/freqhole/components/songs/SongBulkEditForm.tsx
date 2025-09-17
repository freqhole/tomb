import { createSignal, createEffect } from "solid-js";
import type { Song } from "../../../../lib/music/schemas/song";

interface FormData {
  title: string | "mixed";
  artist: string | "mixed" | null;
  album: string | "mixed" | null;
  album_artist: string | "mixed" | null;
  track_number: number | "mixed" | null;
  disc_number: number | "mixed" | null;
  genre: string | "mixed" | null;
  year: number | "mixed" | null;
  bpm: number | "mixed" | null;
  key_signature: string | "mixed" | null;
}

interface SongBulkEditFormProps {
  songs: Song[];
  onFormChange: (formData: FormData) => void;
}

export function SongBulkEditForm(props: SongBulkEditFormProps) {
  const [formData, setFormData] = createSignal<FormData>({
    title: "",
    artist: null,
    album: null,
    album_artist: null,
    track_number: null,
    disc_number: null,
    genre: null,
    year: null,
    bpm: null,
    key_signature: null,
  });

  const totalSongs = () => props.songs.length;

  // determine if values are mixed across selected songs
  const getMixedOrValue = <T,>(getValue: (song: Song) => T): T | "mixed" => {
    if (props.songs.length === 0) return "mixed" as T | "mixed";

    const firstSong = props.songs[0];
    if (!firstSong) return "mixed" as T | "mixed";

    const firstValue = getValue(firstSong);
    const allSame = props.songs.every((song) => getValue(song) === firstValue);

    return allSame ? firstValue : "mixed";
  };

  // initialize form data with mixed/common values
  const initializeFormData = () => {
    setFormData({
      title: getMixedOrValue((s) => s.title),
      artist: getMixedOrValue((s) => s.artist),
      album: getMixedOrValue((s) => s.album),
      album_artist: getMixedOrValue((s) => s.album_artist),
      track_number: getMixedOrValue((s) => s.track_number),
      disc_number: getMixedOrValue((s) => s.disc_number),
      genre: getMixedOrValue((s) => s.genre),
      year: getMixedOrValue((s) => s.year),
      bpm: getMixedOrValue((s) => s.bpm),
      key_signature: getMixedOrValue((s) => s.key_signature),
    });
  };

  // initialize when songs change
  createEffect(() => {
    if (props.songs.length > 0) {
      initializeFormData();
    }
  });

  // notify parent of form changes
  createEffect(() => {
    props.onFormChange(formData());
  });

  // form field update handler
  const updateField = <K extends keyof FormData>(
    field: K,
    value: FormData[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // render input field with mixed value support
  const renderTextField = (
    label: string,
    field: keyof FormData,
    type: "text" | "number" = "text"
  ) => {
    const value = formData()[field];
    const isMixed = value === "mixed";

    // convert value for display
    const displayValue = () => {
      if (isMixed) return "";
      if (value === null || value === undefined) return "";
      return String(value);
    };

    return (
      <div class="space-y-2">
        <label class="block text-sm font-medium text-gray-300">{label}</label>
        <input
          type={type}
          value={displayValue()}
          placeholder={isMixed ? "mixed values" : ""}
          class={`
            w-full px-3 py-2 bg-gray-800 border text-white placeholder-gray-500
            transition-colors focus:outline-none focus:ring-2 focus:ring-magenta-500
            ${
              isMixed
                ? "border-yellow-600 bg-yellow-900/20"
                : "border-gray-600 focus:border-magenta-500"
            }
          `}
          onInput={(e) => {
            const inputValue = e.currentTarget.value;
            if (type === "number") {
              const numValue = inputValue === "" ? null : parseInt(inputValue);
              updateField(field, numValue as FormData[typeof field]);
            } else {
              updateField(
                field,
                inputValue === ""
                  ? null
                  : (inputValue as FormData[typeof field])
              );
            }
          }}
        />
      </div>
    );
  };

  return (
    <div class="space-y-6">
      {/* bulk edit header */}
      <div class="bg-gray-800/50 p-4 border border-gray-700">
        <div class="flex items-center justify-between">
          <div class="text-sm text-gray-400">
            bulk editing {totalSongs()} songs - changes will apply to all
            selected songs
          </div>
          <div class="text-sm text-gray-400">
            yellow fields indicate mixed values
          </div>
        </div>
        <div class="text-xs text-gray-500 mt-2">
          leaving a field empty will not change that property for any song
        </div>
      </div>

      {/* form fields */}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* basic metadata */}
        {renderTextField("title", "title")}
        {renderTextField("artist", "artist")}
        {renderTextField("album", "album")}
        {renderTextField("album artist", "album_artist")}

        {/* track info */}
        {renderTextField("track number", "track_number", "number")}
        {renderTextField("disc number", "disc_number", "number")}

        {/* additional metadata */}
        {renderTextField("genre", "genre")}
        {renderTextField("year", "year", "number")}
        {renderTextField("bpm", "bpm", "number")}
        {renderTextField("key signature", "key_signature")}
      </div>

      {/* user preference placeholders */}
      <div class="border-t border-gray-700 pt-4">
        <h3 class="text-sm font-medium text-gray-300 mb-3">user preferences</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="space-y-2">
            <label class="block text-sm font-medium text-gray-300">
              rating
            </label>
            <div class="text-sm text-gray-500">
              // TODO: use SongStarRatingCompact component (bulk mode)
            </div>
          </div>

          <div class="space-y-2">
            <label class="block text-sm font-medium text-gray-300">
              favorite
            </label>
            <div class="text-sm text-gray-500">
              // TODO: use SongFavoriteHeart component (bulk mode)
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
