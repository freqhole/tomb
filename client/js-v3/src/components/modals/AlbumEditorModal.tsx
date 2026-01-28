// album editor modal - edit album metadata
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
} from "solid-js";
import { useQueryClient } from "@tanstack/solid-query";
import type { ImageMetadata } from "../../music/services/storage/types";
import { updateAlbum } from "../../music/services/storage/db";
import { getDataSource } from "../../music/data";
import { useUpdateAlbumMutation } from "../../music/queries/mutations";
import { queryKeys } from "../../music/queries/queryKeys";
import { useAlbumQuery, useAlbumSongsQuery } from "../../music/queries/songs";
import { pollJobUntilComplete } from "../../utils/jobs";
import { Button } from "../buttons/Button";
import { toast } from "../feedback/Toast";
import { ArtistAutocomplete } from "../forms/ArtistAutocomplete";
import { GenreAutocomplete } from "../forms/GenreAutocomplete";
import { SubGenreAutocomplete } from "../forms/SubGenreAutocomplete";
import { TextInput } from "../forms/TextInput";
import { Icon, IconNames } from "../icons/registry";
import { Tabs, TabList, Tab, TabPanel } from "../navigation/Tabs";
import MediaImage from "../media/MediaImage";
import { EntityImages } from "../layout/EntityImages";
import { pushModal, popModal } from "../../music/modals";

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
  genre_id: string | undefined;
  genre: string;
  sub_genre_ids: string[];
  sub_genres: string[];
  release_date: string;
  label: string;
  uploaded_blob_id: string | null;
}

export function AlbumEditorModal(props: AlbumEditorModalProps) {
  const queryClient = useQueryClient();
  const albumQuery = useAlbumQuery(() => props.albumId);
  const songsQuery = useAlbumSongsQuery(() => props.albumId);
  const updateMutation = useUpdateAlbumMutation();

  const [formData, setFormData] = createSignal<FormData>({
    title: "",
    artist_id: undefined,
    artist_name: "",
    album_type: "album",
    genre_id: undefined,
    genre: "",
    sub_genre_ids: [],
    sub_genres: [],
    release_date: "",
    label: "",
    uploaded_blob_id: null,
  });

  const [initialData, setInitialData] = createSignal<FormData | null>(null);
  const [loadedAlbumId, setLoadedAlbumId] = createSignal<string | null>(null);
  const [activeTab, setActiveTab] = createSignal<"metadata" | "images">("metadata");
  const [images, setImages] = createSignal<ImageMetadata[]>([]);
  const [imagePreview, setImagePreview] = createSignal<string | null>(null);
  const [processingJob, setProcessingJob] = createSignal<{
    status: string;
    message: string;
  } | null>(null);

  // initialize form data when album loads or when albumId changes
  createEffect(() => {
    const album = albumQuery.data;
    const songs = songsQuery.data?.items;
    // reinitialize if this is a different album or first load
    if (album && songs && songs.length > 0 && loadedAlbumId() !== props.albumId) {
      // get artist from first song (albums should have one artist)
      const firstSong = songs[0];

      const data: FormData = {
        title: album.title || "",
        artist_id: firstSong.artist_id,
        artist_name: firstSong.artist_name || "",
        album_type: album.album_type || "album",
        genre_id: album.genre_id,
        genre: album.genre || "",
        sub_genre_ids: [], // sub_genre_ids come from autocomplete selection
        sub_genres: album.sub_genres || [],
        release_date: album.release_date || "",
        label: album.label || "",
        uploaded_blob_id: null,
      };
      setFormData(data);
      setInitialData(data);
      setLoadedAlbumId(props.albumId);

      // load album images
      if (album.images) {
        setImages(album.images);
      }
    }
  });

  // register modal in stack for esc key handling
  onMount(() => {
    const modalId = `album-${props.albumId}`;
    pushModal(modalId, props.onClose);
    return () => popModal(modalId);
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
      current.genre_id !== initial.genre_id ||
      current.genre !== initial.genre ||
      JSON.stringify(current.sub_genre_ids) !==
        JSON.stringify(initial.sub_genre_ids) ||
      JSON.stringify(current.sub_genres) !==
        JSON.stringify(initial.sub_genres) ||
      current.release_date !== initial.release_date ||
      current.label !== initial.label ||
      current.uploaded_blob_id !== null
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
        genre_id:
          data.genre_id !== initial?.genre_id ? data.genre_id : undefined,
        genre: data.genre !== initial?.genre ? data.genre : undefined,
        sub_genre_ids:
          JSON.stringify(data.sub_genre_ids) !==
          JSON.stringify(initial?.sub_genre_ids)
            ? data.sub_genre_ids
            : undefined,
        sub_genres:
          JSON.stringify(data.sub_genres) !==
          JSON.stringify(initial?.sub_genres)
            ? data.sub_genres
            : undefined,
        release_date:
          data.release_date !== initial?.release_date && data.release_date
            ? data.release_date
            : undefined,
        label: data.label !== initial?.label ? data.label : undefined,
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

    if (field === "uploaded_blob_id") {
      setImagePreview(null);
      setProcessingJob(null);
    }
  };

  const handleImageSelect = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const dataSource = getDataSource();
      if (!dataSource.uploadImage) {
        toast.error("image upload not supported");
        return;
      }

      setProcessingJob({ status: "uploading", message: "uploading image..." });

      const blobId = await dataSource.uploadImage({
        file,
        entityType: "album",
        entityId: props.albumId,
        isPrimary: images().length === 0, // first image is primary
      });

      const newImage: ImageMetadata = {
        local_blob_id: blobId,
        is_primary: images().length === 0,
        type: "thumbnail",
      };

      const updatedImages = [...images(), newImage];
      setImages(updatedImages);

      // persist immediately to IDB
      await updateAlbum(props.albumId, { images: updatedImages });

      setProcessingJob(null);
      toast.success("image uploaded");
      albumQuery.refetch();
      input.value = "";
    } catch (err) {
      console.error("failed to upload image:", err);
      toast.error("failed to upload image");
      setProcessingJob(null);
    }
  };

  const handleTogglePrimary = async (index: number) => {
    try {
      const updatedImages = images().map((img, i) => ({
        ...img,
        is_primary: i === index,
      }));
      setImages(updatedImages);

      // persist immediately to IDB
      await updateAlbum(props.albumId, { images: updatedImages });

      toast.success("primary image updated");
      albumQuery.refetch();
    } catch (err) {
      console.error("failed to update primary image:", err);
      toast.error("failed to update primary image");
    }
  };

  const handleRemoveImage = async (index: number) => {
    try {
      const imageToRemove = images()[index];
      const updatedImages = images().filter((_, i) => i !== index);

      // if removing primary, make first remaining image primary
      if (imageToRemove.is_primary && updatedImages.length > 0) {
        updatedImages[0].is_primary = true;
      }

      setImages(updatedImages);

      // persist immediately to IDB
      await updateAlbum(props.albumId, { images: updatedImages });

      toast.success("image removed");
      albumQuery.refetch();
    } catch (err) {
      console.error("failed to remove image:", err);
      toast.error("failed to remove image");
    }
  };

  const songs = createMemo(() => songsQuery.data?.items || []);

  return (
    <div
      class="fixed inset-0 bg-black/50 flex items-center justify-center"
      classList={{ "z-50": !props.disableNestedModals, "z-[60]": props.disableNestedModals }}
    >
      <div
        class="bg-[var(--color-bg-elevated)] rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
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
          <Tabs activeTab={activeTab()} onTabChange={setActiveTab} class="flex-1 flex flex-col min-h-0">
            <TabList class="px-6">
              <Tab id="metadata" label="metadata" />
              <Tab id="images" label="images" badge={images().length || undefined} />
            </TabList>

            <TabPanel id="metadata" class="flex-1 overflow-y-auto p-6 space-y-6">
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
                onSelect={(selection) => {
                  setFormData((prev) => ({
                    ...prev,
                    genre_id: selection.id,
                    genre: selection.name,
                  }));
                }}
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
                onSelect={(subGenres, subGenreIds) =>
                  setFormData((prev) => ({
                    ...prev,
                    sub_genre_ids: subGenreIds,
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

            {/* release date */}
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="block text-sm font-medium text-[var(--color-text-primary)]">
                  release date
                </label>
                <Show when={formData().release_date !== initialData()?.release_date}>
                  <button
                    onClick={() => handleResetField("release_date")}
                    class="text-xs text-[var(--color-text-tertiary)} hover:text-[var(--color-text-primary)]"
                  >
                    reset
                  </button>
                </Show>
              </div>
              <TextInput
                value={formData().release_date}
                onInput={(e) => {
                  setFormData((prev) => ({
                    ...prev,
                    release_date: e.currentTarget.value,
                  }));
                }}
                placeholder="YYYY, YYYY-MM, or YYYY-MM-DD"
                class="w-full"
              />
              <p class="text-xs text-[var(--color-text-tertiary)]">
                release year or full date (accepts YYYY, YYYY-MM, or YYYY-MM-DD)
              </p>
            </div>

            {/* songs list */}
            <div class="space-y-2">
              <label class="block text-sm font-medium text-[var(--color-text-primary)]">
                songs in album ({songs().length})
              </label>
              <div class="bg-[var(--color-bg-base)] rounded-lg border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
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
              </TabPanel>

              <TabPanel id="images" class="flex-1 overflow-y-auto p-6">
                <EntityImages
                  images={images()}
                  onUpload={(file) => {
                    const event = new Event("change") as any;
                    const input = document.createElement("input");
                    input.type = "file";
                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(file);
                    input.files = dataTransfer.files;
                    Object.defineProperty(event, "target", { value: input, writable: false });
                    handleImageSelect(event);
                  }}
                  onDelete={handleRemoveImage}
                  onSetPrimary={handleTogglePrimary}
                  uploading={!!processingJob()}
                />
              </TabPanel>
          </Tabs>
        </Show>

        {/* footer */}
        <Show when={initialData() && activeTab() === "metadata"}>
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
