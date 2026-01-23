// album editor modal - edit album metadata
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
} from "solid-js";
import { useUpdateAlbumMutation } from "../../music/queries/mutations";
import { useAlbumQuery, useAlbumSongsQuery } from "../../music/queries/songs";
import { Button } from "../buttons/Button";
import { toast } from "../feedback/Toast";
import { ArtistAutocomplete } from "../forms/ArtistAutocomplete";
import { GenreAutocomplete } from "../forms/GenreAutocomplete";
import { SubGenreAutocomplete } from "../forms/SubGenreAutocomplete";
import { TextInput } from "../forms/TextInput";
import { Icon, IconNames } from "../icons/registry";

interface AlbumEditorModalProps {
  albumId: string;
  onClose: () => void;
  onSave?: () => void;
  /** if true, hides buttons that would open other modals (prevents infinite recursion) */
  disableNestedModals?: boolean;
  /** callback to open song editor modal */
  onOpenSongEditor?: (songId: string) => void;
}

interface FormData {
  title: string;
  artist_id: string | undefined;
  artist_name: string;
  album_type: string;
  genre: string;
  sub_genres: string[];
  year: number | null;
  label: string;
  image_file: File | null;
}

export function AlbumEditorModal(props: AlbumEditorModalProps) {
  const albumQuery = useAlbumQuery(() => props.albumId);
  const songsQuery = useAlbumSongsQuery(() => props.albumId);
  const updateMutation = useUpdateAlbumMutation();

  const [formData, setFormData] = createSignal<FormData>({
    title: "",
    artist_id: undefined,
    artist_name: "",
    album_type: "album",
    genre: "",
    sub_genres: [],
    year: null,
    label: "",
    image_file: null,
  });

  const [initialData, setInitialData] = createSignal<FormData | null>(null);
  const [imagePreview, setImagePreview] = createSignal<string | null>(null);

  // initialize form data when album loads
  createEffect(() => {
    const album = albumQuery.data;
    const songs = songsQuery.data?.items;
    if (album && songs && songs.length > 0 && !initialData()) {
      // get artist from first song (albums should have one artist)
      const firstSong = songs[0];

      const data: FormData = {
        title: album.title || "",
        artist_id: firstSong.artist_id,
        artist_name: firstSong.artist_name || "",
        album_type: album.album_type || "album",
        genre: "", // TODO: get from album entity when available
        sub_genres: [], // TODO: get from album entity when available
        year: album.year || null,
        label: album.label || "",
        image_file: null,
      };
      setFormData(data);
      setInitialData(data);

      // TODO: set image preview from album's existing image if available
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
      current.artist_id !== initial.artist_id ||
      current.artist_name !== initial.artist_name ||
      current.album_type !== initial.album_type ||
      current.genre !== initial.genre ||
      JSON.stringify(current.sub_genres) !==
        JSON.stringify(initial.sub_genres) ||
      current.year !== initial.year ||
      current.label !== initial.label ||
      current.image_file !== null
    );
  });

  const handleSave = async () => {
    if (!hasChanges()) return;

    const data = formData();
    const initial = initialData();

    try {
      await updateMutation.mutateAsync({
        album_id: props.albumId,
        title: data.title !== initial?.title ? data.title : undefined,
        artist_id:
          data.artist_id !== initial?.artist_id ? data.artist_id : undefined,
        artist_name:
          data.artist_name !== initial?.artist_name
            ? data.artist_name
            : undefined,
        album_type:
          data.album_type !== initial?.album_type ? data.album_type : undefined,
        genre: data.genre !== initial?.genre ? data.genre : undefined,
        sub_genres:
          JSON.stringify(data.sub_genres) !==
          JSON.stringify(initial?.sub_genres)
            ? data.sub_genres
            : undefined,
        release_date:
          data.year !== initial?.year && data.year
            ? data.year.toString()
            : undefined,
        label: data.label !== initial?.label ? data.label : undefined,
        image: data.image_file || undefined,
      });

      props.onSave?.();
      props.onClose();
    } catch (error) {
      console.error("failed to save album:", error);
      // toast is already shown by mutation onError handler
    }
  };

  const handleReset = () => {
    const initial = initialData();
    if (initial) {
      setFormData({ ...initial });
      setImagePreview(null);
    }
  };

  const handleResetField = (field: keyof FormData) => {
    const initial = initialData();
    if (!initial) return;

    setFormData((prev) => ({
      ...prev,
      [field]: initial[field],
    }));

    if (field === "image_file") {
      setImagePreview(null);
    }
  };

  const handleImageSelect = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    // validate file type
    if (!file.type.startsWith("image/")) {
      toast.error("please select an image file");
      return;
    }

    // validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error("image must be smaller than 10MB");
      return;
    }

    setFormData((prev) => ({ ...prev, image_file: file }));

    // create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setImagePreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const songs = createMemo(() => songsQuery.data?.items || []);

  return (
    <div
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={props.onClose}
    >
      <div
        class="bg-[var(--color-bg-elevated)] rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div class="flex items-center justify-between p-6 border-b border-[var(--color-border)]">
          <h2 class="text-xl font-semibold text-[var(--color-text-primary)]">
            edit album
          </h2>
          <button
            onClick={props.onClose}
            class="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            <Icon name={IconNames.close} />
          </button>
        </div>

        {/* content */}
        <Show
          when={initialData()}
          fallback={
            <div class="flex-1 flex items-center justify-center p-6">
              <div class="text-[var(--color-text-secondary)]">loading...</div>
            </div>
          }
        >
          <div class="flex-1 overflow-y-auto p-6 space-y-6">
            {/* album title */}
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="block text-sm font-medium text-[var(--color-text-primary)]">
                  album title
                </label>
                <Show when={formData().title !== initialData()?.title}>
                  <button
                    onClick={() => handleResetField("title")}
                    class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                  >
                    reset
                  </button>
                </Show>
              </div>
              <TextInput
                value={formData().title}
                onInput={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    title: e.currentTarget.value,
                  }))
                }
                placeholder="album title"
                class="w-full"
              />
            </div>

            {/* artist */}
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="block text-sm font-medium text-[var(--color-text-primary)]">
                  artist
                </label>
                <div class="flex items-center gap-2">
                  <Show
                    when={
                      formData().artist_name !== initialData()?.artist_name ||
                      formData().artist_id !== initialData()?.artist_id
                    }
                  >
                    <button
                      onClick={() => handleResetField("artist_name")}
                      class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                    >
                      reset
                    </button>
                  </Show>
                </div>
              </div>
              <ArtistAutocomplete
                value={formData().artist_name}
                onSelect={(selection) =>
                  setFormData((prev) => ({
                    ...prev,
                    artist_id: selection.id,
                    artist_name: selection.name,
                  }))
                }
                placeholder="artist name"
              />
              <p class="text-xs text-[var(--color-text-tertiary)]">
                changing the artist will move all songs to a different album
                scoped to that artist
              </p>
            </div>

            {/* genre */}
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <Show when={formData().genre !== initialData()?.genre}>
                  <button
                    onClick={() => handleResetField("genre")}
                    class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                  >
                    reset
                  </button>
                </Show>
              </div>
              <GenreAutocomplete
                label="genre"
                value={formData().genre}
                onSelect={(selection) =>
                  setFormData((prev) => ({
                    ...prev,
                    genre: selection.name,
                  }))
                }
                placeholder="select or type genre"
                hint="choose a genre for this album"
              />
            </div>

            {/* sub-genres */}
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <Show
                  when={
                    JSON.stringify(formData().sub_genres) !==
                    JSON.stringify(initialData()?.sub_genres)
                  }
                >
                  <button
                    onClick={() => handleResetField("sub_genres")}
                    class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                  >
                    reset
                  </button>
                </Show>
              </div>
              <SubGenreAutocomplete
                label="sub-genres"
                value={formData().sub_genres}
                genre={formData().genre}
                onSelect={(subGenres) =>
                  setFormData((prev) => ({
                    ...prev,
                    sub_genres: subGenres,
                  }))
                }
                placeholder="select or type sub-genres"
                hint="sub-genres help categorize the album further"
              />
            </div>

            {/* album type */}
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="block text-sm font-medium text-[var(--color-text-primary)]">
                  album type
                </label>
                <Show
                  when={formData().album_type !== initialData()?.album_type}
                >
                  <button
                    onClick={() => handleResetField("album_type")}
                    class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                  >
                    reset
                  </button>
                </Show>
              </div>
              <select
                value={formData().album_type}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    album_type: e.currentTarget.value,
                  }))
                }
                class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-500)] focus:ring-opacity-50 transition-colors"
              >
                <option value="album">album</option>
                <option value="single">single</option>
                <option value="compilation">compilation</option>
              </select>
            </div>

            {/* label */}
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="block text-sm font-medium text-[var(--color-text-primary)]">
                  label
                </label>
                <Show when={formData().label !== initialData()?.label}>
                  <button
                    onClick={() => handleResetField("label")}
                    class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                  >
                    reset
                  </button>
                </Show>
              </div>
              <TextInput
                value={formData().label}
                onInput={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    label: e.currentTarget.value,
                  }))
                }
                placeholder="record label"
                class="w-full"
              />
              <p class="text-xs text-[var(--color-text-tertiary)]">
                the record label that released this album
              </p>
            </div>

            {/* year */}
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="block text-sm font-medium text-[var(--color-text-primary)]">
                  year
                </label>
                <Show when={formData().year !== initialData()?.year}>
                  <button
                    onClick={() => handleResetField("year")}
                    class="text-xs text-[var(--color-text-tertiary)} hover:text-[var(--color-text-primary)]"
                  >
                    reset
                  </button>
                </Show>
              </div>
              <TextInput
                value={formData().year?.toString() || ""}
                onInput={(e) => {
                  const value = e.currentTarget.value;
                  const num = value ? parseInt(value, 10) : null;
                  setFormData((prev) => ({
                    ...prev,
                    year: num && !isNaN(num) ? num : null,
                  }));
                }}
                placeholder="YYYY, YYYY-MM, or YYYY-MM-DD"
                class="w-full"
              />
              <p class="text-xs text-[var(--color-text-tertiary)]">
                release year or full date (backend accepts YYYY, YYYY-MM, or
                YYYY-MM-DD)
              </p>
            </div>

            {/* album image */}
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="block text-sm font-medium text-[var(--color-text-primary)]">
                  album artwork
                </label>
                <Show when={formData().image_file !== null}>
                  <button
                    onClick={() => handleResetField("image_file")}
                    class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                  >
                    reset
                  </button>
                </Show>
              </div>

              {/* image preview */}
              <Show when={imagePreview()}>
                <div class="w-32 h-32 rounded-lg overflow-hidden bg-[var(--color-bg-base)]">
                  <img
                    src={imagePreview()!}
                    alt="preview"
                    class="w-full h-full object-cover"
                  />
                </div>
              </Show>

              {/* file input */}
              <div class="flex items-center gap-3">
                <label class="cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageSelect}
                    class="hidden"
                  />
                  <div class="px-4 py-2 bg-[var(--color-bg-base)] text-[var(--color-text-secondary)] rounded hover:bg-[var(--color-bg-hover)] text-sm">
                    {formData().image_file ? "change image" : "select image"}
                  </div>
                </label>
                <Show when={formData().image_file}>
                  <span class="text-sm text-[var(--color-text-secondary)]">
                    {formData().image_file!.name}
                  </span>
                </Show>
              </div>
              <p class="text-xs text-[var(--color-text-tertiary)]">
                recommended: square image, at least 500×500px, max 10MB
              </p>
            </div>

            {/* songs list */}
            <div class="space-y-2">
              <label class="block text-sm font-medium text-[var(--color-text-primary)]">
                songs in album ({songs().length})
              </label>
              <div class="bg-[var(--color-bg-base)] rounded-lg border border-[var(--color-border)] divide-y divide-[var(--color-border)] max-h-64 overflow-y-auto">
                <Show
                  when={songs().length > 0}
                  fallback={
                    <div class="p-4 text-sm text-[var(--color-text-tertiary)] text-center">
                      no songs in this album
                    </div>
                  }
                >
                  <For each={songs()}>
                    {(song) => (
                      <div class="flex items-center justify-between p-3 hover:bg-[var(--color-bg-hover)] group">
                        <div class="flex-1 min-w-0">
                          <div class="flex items-center gap-2">
                            <span class="text-xs text-[var(--color-text-tertiary)] w-8 flex-shrink-0">
                              {song.track_number}
                            </span>
                            <span class="text-sm text-[var(--color-text-primary)] truncate">
                              {song.title}
                            </span>
                          </div>
                        </div>
                        <Show
                          when={
                            !props.disableNestedModals && props.onOpenSongEditor
                          }
                        >
                          <button
                            onClick={() => props.onOpenSongEditor?.(song.id)}
                            class="opacity-0 group-hover:opacity-100 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] ml-2 flex-shrink-0"
                            title="edit song"
                          >
                            <Icon name={IconNames.edit} size={16} />
                          </button>
                        </Show>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </div>
          </div>
        </Show>

        {/* footer */}
        <Show when={initialData()}>
          <div class="flex items-center justify-between p-6 border-t border-[var(--color-border)]">
            <Show when={hasChanges()}>
              <button
                onClick={handleReset}
                class="text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
              >
                reset all
              </button>
            </Show>
            <div class="flex items-center gap-3 ml-auto">
              <Button variant="secondary" onClick={props.onClose}>
                cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleSave}
                disabled={!hasChanges()}
              >
                save changes
              </Button>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
