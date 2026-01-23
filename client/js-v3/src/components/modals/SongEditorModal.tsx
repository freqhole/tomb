// song editor modal - edit single song metadata
import {
  createEffect,
  createMemo,
  createSignal,
  onMount,
  Show,
} from "solid-js";
import type { Song } from "../../music/data/types";
import {
  useSongQuery,
  useUpdateSongsMutation,
} from "../../music/queries/songs";
import { Button } from "../buttons/Button";
import { toast } from "../feedback/Toast";
import { TextInput } from "../forms/TextInput";
import { Icon, IconNames } from "../icons/registry";

interface SongEditorModalProps {
  songId: string;
  onClose: () => void;
  onSave?: () => void;
}

interface FormData {
  title: string;
  track_number: number;
  disc_number: number;
  year: number | null;
  bpm: number | null;
  key_signature: string;
  lyrics: string;
  artist_name: string;
  album_title: string;
}

export function SongEditorModal(props: SongEditorModalProps) {
  const songQuery = useSongQuery(() => props.songId);
  const updateMutation = useUpdateSongsMutation();

  const [formData, setFormData] = createSignal<FormData>({
    title: "",
    track_number: 1,
    disc_number: 1,
    year: null,
    bpm: null,
    key_signature: "",
    lyrics: "",
    artist_name: "",
    album_title: "",
    genre: "",
    sub_genre: "",
  });

  const [initialData, setInitialData] = createSignal<FormData | null>(null);
  const [lyricsExpanded, setLyricsExpanded] = createSignal(false);

  // initialize form data when song loads
  createEffect(() => {
    const song = songQuery.data;
    if (song && !initialData()) {
      const data: FormData = {
        title: song.title,
        track_number: song.track_number,
        disc_number: song.disc_number,
        year: song.year,
        bpm: song.bpm,
        key_signature: song.key_signature || "",
        lyrics: song.lyrics || "",
        artist_name: song.artist_name,
        album_title: song.album_title,
      };
      setFormData(data);
      setInitialData(data);

      // auto-expand lyrics if song has lyrics
      if (song.lyrics && song.lyrics.trim().length > 0) {
        setLyricsExpanded(true);
      }
    }
  });

  // handle esc key to close modal
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        props.onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const hasChanges = createMemo(() => {
    const current = formData();
    const initial = initialData();
    if (!initial) return false;

    return (
      current.title !== initial.title ||
      current.track_number !== initial.track_number ||
      current.disc_number !== initial.disc_number ||
      current.year !== initial.year ||
      current.bpm !== initial.bpm ||
      current.key_signature !== initial.key_signature ||
      current.lyrics !== initial.lyrics ||
      current.artist_name !== initial.artist_name ||
      current.album_title !== initial.album_title
    );
  });

  const handleSave = async () => {
    const current = formData();
    const initial = initialData();
    if (!initial) return;

    // collect only changed fields
    const updates: Partial<typeof current> & { song_ids: string[] } = {
      song_ids: [props.songId],
    };

    if (current.title !== initial.title) updates.title = current.title;
    if (current.track_number !== initial.track_number)
      updates.track_number = current.track_number;
    if (current.disc_number !== initial.disc_number)
      updates.disc_number = current.disc_number;
    if (current.year !== initial.year) updates.year = current.year;
    if (current.bpm !== initial.bpm) updates.bpm = current.bpm;
    if (current.key_signature !== initial.key_signature)
      updates.key_signature = current.key_signature;
    if (current.lyrics !== initial.lyrics) updates.lyrics = current.lyrics;
    if (current.artist_name !== initial.artist_name)
      updates.artist_name = current.artist_name;
    if (current.album_title !== initial.album_title)
      updates.album_title = current.album_title;

    if (Object.keys(updates).length === 1) {
      // only song_ids, no actual changes
      toast.info("no changes to save");
      props.onClose();
      return;
    }

    try {
      await updateMutation.mutateAsync(updates);
      props.onSave?.();
      props.onClose();
    } catch (error) {
      console.error("failed to save song:", error);
    }
  };

  const handleFieldChange = (field: keyof FormData, value: any) => {
    const current = formData();
    const initial = initialData();

    // if changing artist and it's different from initial, clear album
    if (field === "artist_name" && initial && value !== initial.artist_name) {
      setFormData({ ...current, artist_name: value, album_title: "" });
    } else {
      setFormData({ ...current, [field]: value });
    }
  };

  const handleReset = (field: keyof FormData) => {
    const initial = initialData();
    if (!initial) return;
    setFormData({ ...formData(), [field]: initial[field] });
  };

  const handleResetAll = () => {
    const initial = initialData();
    if (initial) {
      setFormData({ ...initial });
    }
  };

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={() => props.onClose()}
    >
      <div
        class="bg-[var(--color-bg-primary)] w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div class="flex items-center justify-between p-4 border-b border-[var(--color-border-default)]">
          <h2 class="text-lg font-semibold text-[var(--color-text-primary)]">
            edit song
          </h2>
          <div class="flex items-center gap-2">
            <Show when={hasChanges()}>
              <Button onClick={handleResetAll} variant="ghost" size="sm">
                reset all
              </Button>
            </Show>
            <button
              onClick={() => props.onClose()}
              class="p-1 hover:bg-[var(--color-bg-hover)] transition-colors"
            >
              <Icon name={IconNames.close} size={20} />
            </button>
          </div>
        </div>

        {/* body */}
        <div class="flex-1 overflow-y-auto p-4">
          <Show
            when={!songQuery.isLoading}
            fallback={
              <div class="flex items-center justify-center py-8 text-[var(--color-text-secondary)]">
                loading...
              </div>
            }
          >
            <div class="space-y-4">
              {/* title */}
              <div class="flex items-center gap-2">
                <div class="flex-1">
                  <label class="block text-sm text-[var(--color-text-secondary)] mb-1">
                    title *
                  </label>
                  <TextInput
                    value={formData().title}
                    oninput={(e) =>
                      handleFieldChange("title", e.currentTarget.value)
                    }
                    placeholder="song title"
                  />
                </div>
                <Show
                  when={
                    initialData() && formData().title !== initialData()!.title
                  }
                >
                  <button
                    onClick={() => handleReset("title")}
                    class="mt-6 px-2 py-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                  >
                    reset
                  </button>
                </Show>
              </div>

              {/* artist */}
              <div class="flex items-center gap-2">
                <div class="flex-1">
                  <label class="block text-sm text-[var(--color-text-secondary)] mb-1">
                    artist
                  </label>
                  <TextInput
                    value={formData().artist_name}
                    oninput={(e) =>
                      handleFieldChange("artist_name", e.currentTarget.value)
                    }
                    placeholder="artist name"
                  />
                </div>
                <Show
                  when={
                    initialData() &&
                    formData().artist_name !== initialData()!.artist_name
                  }
                >
                  <button
                    onClick={() => handleReset("artist_name")}
                    class="mt-6 px-2 py-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                  >
                    reset
                  </button>
                </Show>
              </div>

              {/* album */}
              <div class="flex items-center gap-2">
                <div class="flex-1">
                  <label class="block text-sm text-[var(--color-text-secondary)] mb-1">
                    album
                  </label>
                  <TextInput
                    value={formData().album_title}
                    oninput={(e) =>
                      handleFieldChange("album_title", e.currentTarget.value)
                    }
                    placeholder="album title"
                  />
                </div>
                <Show
                  when={
                    initialData() &&
                    formData().album_title !== initialData()!.album_title
                  }
                >
                  <button
                    onClick={() => handleReset("album_title")}
                    class="mt-6 px-2 py-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                  >
                    reset
                  </button>
                </Show>
              </div>

              {/* disc, track, year, bpm, key - all on one row */}
              <div class="flex gap-2">
                {/* disc number */}
                <div class="flex items-center gap-2 w-20">
                  <div class="flex-1">
                    <label class="block text-sm text-[var(--color-text-secondary)] mb-1">
                      disc
                    </label>
                    <input
                      type="number"
                      value={formData().disc_number}
                      oninput={(e) =>
                        handleFieldChange(
                          "disc_number",
                          parseInt(e.currentTarget.value) || 1,
                        )
                      }
                      min="1"
                      class="w-full px-2 py-2 bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-500)]"
                    />
                  </div>
                  <Show
                    when={
                      initialData() &&
                      formData().disc_number !== initialData()!.disc_number
                    }
                  >
                    <button
                      onClick={() => handleReset("disc_number")}
                      class="mt-6 px-1 py-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                    >
                      ×
                    </button>
                  </Show>
                </div>

                {/* track number */}
                <div class="flex items-center gap-2 w-20">
                  <div class="flex-1">
                    <label class="block text-sm text-[var(--color-text-secondary)] mb-1">
                      track
                    </label>
                    <input
                      type="number"
                      value={formData().track_number}
                      oninput={(e) =>
                        handleFieldChange(
                          "track_number",
                          parseInt(e.currentTarget.value) || 1,
                        )
                      }
                      min="1"
                      class="w-full px-2 py-2 bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-500)]"
                    />
                  </div>
                  <Show
                    when={
                      initialData() &&
                      formData().track_number !== initialData()!.track_number
                    }
                  >
                    <button
                      onClick={() => handleReset("track_number")}
                      class="mt-6 px-1 py-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                    >
                      ×
                    </button>
                  </Show>
                </div>

                {/* year */}
                <div class="flex items-center gap-2 w-24">
                  <div class="flex-1">
                    <label class="block text-sm text-[var(--color-text-secondary)] mb-1">
                      year
                    </label>
                    <input
                      type="number"
                      value={formData().year || ""}
                      oninput={(e) =>
                        handleFieldChange(
                          "year",
                          e.currentTarget.value
                            ? parseInt(e.currentTarget.value)
                            : null,
                        )
                      }
                      min="1000"
                      max="9999"
                      placeholder="yyyy"
                      class="w-full px-2 py-2 bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-500)]"
                    />
                  </div>
                  <Show
                    when={
                      initialData() && formData().year !== initialData()!.year
                    }
                  >
                    <button
                      onClick={() => handleReset("year")}
                      class="mt-6 px-1 py-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                    >
                      ×
                    </button>
                  </Show>
                </div>

                {/* bpm */}
                <div class="flex items-center gap-2 w-20">
                  <div class="flex-1">
                    <label class="block text-sm text-[var(--color-text-secondary)] mb-1">
                      bpm
                    </label>
                    <input
                      type="number"
                      value={formData().bpm || ""}
                      oninput={(e) =>
                        handleFieldChange(
                          "bpm",
                          e.currentTarget.value
                            ? parseInt(e.currentTarget.value)
                            : null,
                        )
                      }
                      min="1"
                      placeholder="120"
                      class="w-full px-2 py-2 bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-500)]"
                    />
                  </div>
                  <Show
                    when={
                      initialData() && formData().bpm !== initialData()!.bpm
                    }
                  >
                    <button
                      onClick={() => handleReset("bpm")}
                      class="mt-6 px-1 py-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                    >
                      ×
                    </button>
                  </Show>
                </div>

                {/* key signature */}
                <div class="flex items-center gap-2 flex-1">
                  <div class="flex-1">
                    <label class="block text-sm text-[var(--color-text-secondary)] mb-1">
                      key
                    </label>
                    <input
                      type="text"
                      value={formData().key_signature}
                      oninput={(e) =>
                        handleFieldChange(
                          "key_signature",
                          e.currentTarget.value,
                        )
                      }
                      placeholder="C, Am, F#"
                      class="w-full px-2 py-2 bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-500)]"
                    />
                  </div>
                  <Show
                    when={
                      initialData() &&
                      formData().key_signature !== initialData()!.key_signature
                    }
                  >
                    <button
                      onClick={() => handleReset("key_signature")}
                      class="mt-6 px-1 py-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                    >
                      ×
                    </button>
                  </Show>
                </div>
              </div>

              {/* lyrics accordion */}
              <div>
                <button
                  onClick={() => setLyricsExpanded(!lyricsExpanded())}
                  class="flex items-center justify-between w-full p-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
                >
                  <span>lyrics</span>
                  <Icon
                    name={
                      lyricsExpanded()
                        ? IconNames.chevronUp
                        : IconNames.chevronDown
                    }
                    size={16}
                  />
                </button>
                <Show when={lyricsExpanded()}>
                  <div class="flex items-start gap-2 mt-2">
                    <div class="flex-1">
                      <textarea
                        value={formData().lyrics}
                        oninput={(e) =>
                          handleFieldChange("lyrics", e.currentTarget.value)
                        }
                        placeholder="song lyrics..."
                        rows={10}
                        class="w-full px-3 py-2 bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-500)] resize-none"
                      />
                    </div>
                    <Show
                      when={
                        initialData() &&
                        formData().lyrics !== initialData()!.lyrics
                      }
                    >
                      <button
                        onClick={() => handleReset("lyrics")}
                        class="px-2 py-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                      >
                        reset
                      </button>
                    </Show>
                  </div>
                </Show>
              </div>
            </div>
          </Show>
        </div>

        {/* footer */}
        <div class="flex items-center justify-end gap-2 p-4 border-t border-[var(--color-border-default)]">
          <Button onClick={props.onClose} variant="ghost">
            cancel
          </Button>
          <Button
            onClick={handleSave}
            variant="primary"
            disabled={!hasChanges() || updateMutation.isPending}
          >
            {updateMutation.isPending ? "saving..." : "save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
