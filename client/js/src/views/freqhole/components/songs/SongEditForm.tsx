import { createSignal, createEffect } from "solid-js";
import type { Song } from "../../../../lib/music/schemas/song";

interface FormData {
  title: string;
  artist: string | null;
  album: string | null;
  album_artist: string | null;
  track_number: number | null;
  disc_number: number | null;
  genre: string | null;
  year: number | null;
  bpm: number | null;
  key_signature: string | null;
}

interface SongEditFormProps {
  song: Song;
  onFormChange: (formData: FormData) => void;
}

export function SongEditForm(props: SongEditFormProps) {
  const [formData, setFormData] = createSignal<FormData>({
    title: props.song.title,
    artist: props.song.artist,
    album: props.song.album,
    album_artist: props.song.album_artist,
    track_number: props.song.track_number,
    disc_number: props.song.disc_number,
    genre: props.song.genre,
    year: props.song.year,
    bpm: props.song.bpm,
    key_signature: props.song.key_signature,
  });

  // notify parent of form changes
  createEffect(() => {
    props.onFormChange(formData());
  });

  // update form data when song changes
  createEffect(() => {
    const song = props.song;
    setFormData({
      title: song.title,
      artist: song.artist,
      album: song.album,
      album_artist: song.album_artist,
      track_number: song.track_number,
      disc_number: song.disc_number,
      genre: song.genre,
      year: song.year,
      bpm: song.bpm,
      key_signature: song.key_signature,
    });
  });

  // form field update handler
  const updateField = <K extends keyof FormData>(
    field: K,
    value: FormData[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // render input field
  const renderTextField = (
    label: string,
    field: keyof FormData,
    type: "text" | "number" = "text"
  ) => {
    const value = formData()[field];

    return (
      <div class="space-y-2">
        <label class="block text-sm font-medium text-gray-300">{label}</label>
        <input
          type={type}
          value={value === null || value === undefined ? "" : String(value)}
          class="w-full px-3 py-2 bg-gray-800 border border-gray-600 text-white placeholder-gray-500 transition-colors focus:outline-none focus:ring-2 focus:ring-magenta-500 focus:border-magenta-500"
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
      {/* song info header */}
      <div class="bg-gray-800/50 p-4 border border-gray-700">
        <div class="font-medium text-white mb-1">
          editing: {props.song.title || "untitled"}
        </div>
        <div class="text-sm text-gray-400">
          {props.song.artist && `${props.song.artist} • `}
          {props.song.album || "no album"}
          {props.song.year && ` • ${props.song.year}`}
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
              // TODO: use SongStarRatingCompact component (editable)
            </div>
          </div>

          <div class="space-y-2">
            <label class="block text-sm font-medium text-gray-300">
              favorite
            </label>
            <div class="text-sm text-gray-500">
              // TODO: use SongFavoriteHeart component (editable)
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
