import { createSignal, Show, onMount, createEffect } from "solid-js";
import { Modal } from "../ui/Modal";
import type { Song } from "../../../../lib/music/schemas/song";

import { useGlobalEvents } from "../../hooks/useGlobalEvents";

interface SongInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  songs: Song[];
}

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

export function SongInfoModal(props: SongInfoModalProps) {
  const events = useGlobalEvents();
  const [currentSongIndex, setCurrentSongIndex] = createSignal(0);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
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
  const currentSong = () => props.songs[currentSongIndex()];

  // when multiple songs are selected, we can be in two modes:
  // - bulk edit mode: show mixed values for all songs (for bulk changes)
  // - individual mode: show values for current song (for navigation)
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

  // initialize form data based on current selection
  const initializeFormData = () => {
    if (isBulkMode()) {
      // bulk mode - show mixed values or common values across all songs
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
    } else {
      // single song mode or individual navigation within multiple songs
      const song = currentSong();
      if (song) {
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
      }
    }
  };

  // initialize when modal opens
  onMount(() => {
    initializeFormData();
  });

  // watch for song changes and reinitialize
  createEffect(() => {
    if (props.songs.length > 0) {
      initializeFormData();
    }
  });

  // navigation for multi-song mode
  const goToPreviousSong = () => {
    if (currentSongIndex() > 0) {
      setCurrentSongIndex(currentSongIndex() - 1);
      // when navigating, always show current song data (not bulk mixed values)
      if (totalSongs() > 1) {
        const song = currentSong();
        if (song) {
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
        }
      }
    }
  };

  const goToNextSong = () => {
    if (currentSongIndex() < totalSongs() - 1) {
      setCurrentSongIndex(currentSongIndex() + 1);
      // when navigating, always show current song data (not bulk mixed values)
      if (totalSongs() > 1) {
        const song = currentSong();
        if (song) {
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
        }
      }
    }
  };

  // form field update handler
  const updateField = <K extends keyof FormData>(
    field: K,
    value: FormData[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // save changes
  const handleSave = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // TODO: implement save logic via api client
      // this would need to handle both single song updates and bulk updates
      console.log("saving song data:", {
        songs: props.songs,
        formData: formData(),
        isBulkMode: isBulkMode(),
      });

      events.emit("notification:show", {
        message: isBulkMode()
          ? `updated ${totalSongs()} songs`
          : "song updated successfully",
        type: "success",
      });

      // trigger data reload
      events.emit("data:reload", { type: "songs" });

      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to save changes");
    } finally {
      setIsLoading(false);
    }
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
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      size="lg"
      title={isBulkMode() ? `edit ${totalSongs()} songs` : `edit song info`}
    >
      <div class="space-y-6">
        {/* error display */}
        <Show when={error()}>
          <div class="bg-red-500/10 border border-red-500/20 text-red-400 p-3">
            {error()}
          </div>
        </Show>

        {/* bulk edit mode header */}
        <Show when={isBulkMode()}>
          <div class="bg-gray-800/50 p-4 border border-gray-700">
            <div class="flex items-center justify-between">
              <div class="text-sm text-gray-400">
                bulk editing {totalSongs()} songs - changes will apply to all
                selected songs
              </div>
              <div class="text-sm text-gray-400">
                use pagination below to view individual songs
              </div>
            </div>
          </div>
        </Show>

        {/* single song info header */}
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
        <Show when={totalSongs() > 1 && currentSongIndex() >= 0}>
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
          <h3 class="text-sm font-medium text-gray-300 mb-3">
            user preferences
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* TODO: integrate existing ui components */}
            <div class="space-y-2">
              <label class="block text-sm font-medium text-gray-300">
                rating
              </label>
              <div class="text-sm text-gray-500">
                // TODO: use SongStarRatingCompact component
              </div>
            </div>

            <div class="space-y-2">
              <label class="block text-sm font-medium text-gray-300">
                favorite
              </label>
              <div class="text-sm text-gray-500">
                // TODO: use SongFavoriteHeart component
              </div>
            </div>
          </div>
        </div>

        {/* pagination footer for multi-song */}
        <Show when={totalSongs() > 1}>
          <div class="border-t border-gray-700 pt-4 flex items-center justify-between">
            <button
              class={`
                px-3 py-2 text-sm transition-colors
                ${
                  currentSongIndex() > 0
                    ? "text-white hover:text-magenta-400 hover:bg-gray-800"
                    : "text-gray-600 cursor-not-allowed"
                }
              `}
              disabled={currentSongIndex() <= 0}
              onClick={goToPreviousSong}
            >
              ← previous
            </button>

            <div class="text-sm text-gray-400">
              {currentSongIndex() + 1} of {totalSongs()}
            </div>

            <button
              class={`
                px-3 py-2 text-sm transition-colors
                ${
                  currentSongIndex() < totalSongs() - 1
                    ? "text-white hover:text-magenta-400 hover:bg-gray-800"
                    : "text-gray-600 cursor-not-allowed"
                }
              `}
              disabled={currentSongIndex() >= totalSongs() - 1}
              onClick={goToNextSong}
            >
              next →
            </button>
          </div>
        </Show>

        {/* action buttons */}
        <div class="border-t border-gray-700 pt-4 flex items-center justify-end gap-3">
          <button
            class="px-4 py-2 text-gray-400 hover:text-white transition-colors"
            onClick={props.onClose}
            disabled={isLoading()}
          >
            cancel
          </button>
          <button
            class="px-4 py-2 bg-magenta-600 hover:bg-magenta-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSave}
            disabled={isLoading()}
          >
            {isLoading() ? "saving..." : "save changes"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
