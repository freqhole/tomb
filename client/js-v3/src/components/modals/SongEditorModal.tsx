// song editor modal - edit single song metadata
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
} from "solid-js";
import type { ImageMetadata } from "../../music/services/storage/types";
import type { Song } from "../../music/data/types";
import { getDataSource } from "../../music/data";
import { updateSong } from "../../music/services/storage/db";
import { showAlbumEditor, showArtistEditor, pushModal, popModal } from "../../music/modals";
import {
  useSongQuery,
  useUpdateSongsMutation,
} from "../../music/queries/songs";
import { Button } from "../buttons/Button";
import { toast } from "../feedback/Toast";
import { AlbumAutocomplete } from "../forms/AlbumAutocomplete";
import { ArtistAutocomplete } from "../forms/ArtistAutocomplete";
import { TextInput } from "../forms/TextInput";
import { Icon, IconNames } from "../icons/registry";
import { Tabs, TabList, Tab, TabPanel } from "../navigation/Tabs";
import MediaImage from "../media/MediaImage";

interface SongEditorModalProps {
  songId: string;
  onClose: () => void;
  onSave?: () => void;
  /** if true, hides buttons that would open other modals (prevents infinite recursion) */
  disableNestedModals?: boolean;
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

  const [activeTab, setActiveTab] = createSignal("metadata");
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
  });

  const [initialData, setInitialData] = createSignal<FormData | null>(null);
  const [lyricsExpanded, setLyricsExpanded] = createSignal(false);
  const [artistId, setArtistId] = createSignal<string | undefined>(undefined);
  const [albumId, setAlbumId] = createSignal<string | undefined>(undefined);
  
  // image management
  const [images, setImages] = createSignal<ImageMetadata[]>([]);
  const [loadedSongId, setLoadedSongId] = createSignal<string | null>(null);
  const [imagePreview, setImagePreview] = createSignal<string | null>(null);
  const [processingJob, setProcessingJob] = createSignal<{
    status: string;
    message: string;
  } | null>(null);

  // initialize form data when song loads or when songId changes
  createEffect(() => {
    const song = songQuery.data;
    // reinitialize if this is a different song or first load
    if (song && loadedSongId() !== props.songId) {
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
      setArtistId(song.artist_id);
      setAlbumId(song.album_id);
      setLoadedSongId(props.songId);
      
      // load song images
      if (song.images) {
        setImages(song.images);
      }

      // auto-expand lyrics if song has lyrics
      if (song.lyrics && song.lyrics.trim().length > 0) {
        setLyricsExpanded(true);
      }
    }
  });

  // register modal in stack for esc key handling
  onMount(() => {
    const modalId = `song-${props.songId}`;
    pushModal(modalId, props.onClose);
    return () => popModal(modalId);
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
    const updates: any = {
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
      updates.artist = current.artist_name;
    if (current.album_title !== initial.album_title)
      updates.album = current.album_title;

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

  const handleImageSelect = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("please select an image file");
      return;
    }

    // check file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      toast.error("image must be smaller than 10MB");
      return;
    }

    // show preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setImagePreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    setProcessingJob({ status: "uploading", message: "uploading image..." });

    try {
      const datasource = await getDataSource();
      const blobId = await datasource.uploadImage?.({
        file,
        entityType: "song",
        entityId: props.songId,
      });

      if (!blobId) {
        setProcessingJob(null);
        setImagePreview(null);
        toast.error("failed to upload image");
        return;
      }

      console.log("image uploaded, blob_id:", blobId);

      // add new image to list (marked as primary if it's the first one)
      const newImage: ImageMetadata = {
        local_blob_id: blobId,
        is_primary: images().length === 0,
        type: "thumbnail",
      };
      const updatedImages = [...images(), newImage];
      setImages(updatedImages);

      // persist to IDB immediately
      setProcessingJob({ status: "saving", message: "saving to database..." });
      await updateSong(props.songId, { images: updatedImages });

      setProcessingJob({ status: "completed", message: "image uploaded successfully" });
      setTimeout(() => {
        setProcessingJob(null);
        setImagePreview(null);
      }, 2000);

      toast.success("image uploaded successfully");
      
      // invalidate queries to refresh UI
      songQuery.refetch();
    } catch (err) {
      console.error("failed to upload image:", err);
      toast.error("failed to upload image");
      setProcessingJob(null);
      setImagePreview(null);
    }
  };

  const handleTogglePrimary = async (index: number) => {
    const updated = images().map((img, i) => ({
      ...img,
      is_primary: i === index,
    }));
    setImages(updated);

    // persist to IDB immediately
    try {
      await updateSong(props.songId, { images: updated });
      toast.success("primary image updated");
      songQuery.refetch();
    } catch (err) {
      console.error("failed to update primary image:", err);
      toast.error("failed to update primary image");
    }
  };

  const handleRemoveImage = async (index: number) => {
    const updated = images().filter((_, i) => i !== index);
    
    // if we removed the primary image and there are still images, make the first one primary
    if (updated.length > 0 && !updated.some(img => img.is_primary)) {
      updated[0].is_primary = true;
    }
    
    setImages(updated);

    // persist to IDB immediately
    try {
      await updateSong(props.songId, { images: updated });
      toast.success("image removed");
      songQuery.refetch();
    } catch (err) {
      console.error("failed to remove image:", err);
      toast.error("failed to remove image");
    }
  };

  return (
    <div
      class="fixed inset-0 flex items-center justify-center bg-black/50"
      classList={{ "z-50": !props.disableNestedModals, "z-[60]": props.disableNestedModals }}
    >
      <div
        class="bg-[var(--color-bg-primary)] w-full max-w-2xl max-h-[90vh] flex flex-col"
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

        {/* song info banner */}
        <Show when={initialData()}>
          <div class="bg-[var(--color-bg-elevated)] p-3 border-b border-[var(--color-border-default)]">
            <div class="text-sm text-[var(--color-text-secondary)]">
              editing: {formData().title} - {formData().artist_name}
            </div>
            <div class="text-xs text-[var(--color-text-tertiary)] mt-0.5">
              {formData().album_title} • {formData().year || "no year"}
            </div>
          </div>
        </Show>

        {/* tabs */}
        <Tabs activeTab={activeTab()} onTabChange={setActiveTab} class="flex-1 flex flex-col min-h-0">
          <TabList class="px-4">
            <Tab id="metadata" label="metadata" />
            <Tab id="images" label="images" badge={images().length || undefined} />
          </TabList>

          {/* metadata tab */}
          <TabPanel id="metadata" class="flex-1 overflow-y-auto">
                <div class="p-4">
                  <Show
                    when={initialData()}
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
                  <ArtistAutocomplete
                    label="artist"
                    value={formData().artist_name}
                    onSelect={(artist) => {
                      const current = formData();
                      setFormData({ ...current, artist_name: artist.name });
                      setArtistId(artist.id);
                    }}
                  />
                </div>
                <Show when={!props.disableNestedModals && artistId()}>
                  <button
                    onClick={() =>
                      showArtistEditor({
                        artistId: artistId()!,
                        disableNestedModals: true,
                      })
                    }
                    class="mt-6 p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                    title="edit artist info"
                  >
                    <Icon name={IconNames.edit} size={16} />
                  </button>
                </Show>
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
                  <AlbumAutocomplete
                    label="album"
                    value={formData().album_title}
                    onSelect={(album) => {
                      handleFieldChange("album_title", album.title);
                      setAlbumId(album.id);
                    }}
                  />
                </div>
                <Show when={!props.disableNestedModals && albumId()}>
                  <button
                    onClick={() =>
                      showAlbumEditor({
                        albumId: albumId()!,
                        disableNestedModals: true,
                      })
                    }
                    class="mt-6 p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                    title="edit album info"
                  >
                    <Icon name={IconNames.edit} size={16} />
                  </button>
                </Show>
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
              </TabPanel>

              {/* images tab */}
              <TabPanel id="images" class="flex-1 overflow-y-auto p-6">
                <div class="space-y-6">
                  {/* existing images grid */}
                  <Show when={images().length > 0}>
                    <div class="space-y-4">
                      <h3 class="text-sm font-medium text-[var(--color-text-primary)]">
                        song images ({images().length})
                      </h3>
                      <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        <For each={images()}>
                          {(image, index) => (
                            <div class="relative group">
                              <MediaImage
                                images={[image]}
                                alt={`song image ${index() + 1}`}
                                domainType="song"
                                class="w-full aspect-square object-cover rounded"
                              />
                              <div class="absolute top-2 left-2 flex gap-1">
                                <Show when={image.type}>
                                  <span class="px-2 py-0.5 text-xs bg-black/70 text-white rounded">
                                    {image.type}
                                  </span>
                                </Show>
                                <Show when={image.is_primary}>
                                  <span class="px-2 py-0.5 text-xs bg-blue-500 text-white rounded">
                                    primary
                                  </span>
                                </Show>
                              </div>
                              <div class="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Show when={!image.is_primary}>
                                  <button
                                    onClick={() => handleTogglePrimary(index())}
                                    class="p-1.5 bg-black/70 hover:bg-black/90 text-white rounded"
                                    title="set as primary"
                                  >
                                    <Icon name={IconNames.star} size={16} />
                                  </button>
                                </Show>
                                <button
                                  onClick={() => handleRemoveImage(index())}
                                  class="p-1.5 bg-black/70 hover:bg-black/90 text-white rounded"
                                  title="remove image"
                                >
                                  <Icon name={IconNames.delete} size={16} />
                                </button>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>

                  {/* upload section */}
                  <div class="space-y-4">
                    <h3 class="text-sm font-medium text-[var(--color-text-primary)]">
                      add new image
                    </h3>
                    <Show
                      when={!processingJob()}
                      fallback={
                        <div class="p-4 bg-[var(--color-bg-secondary)] rounded border border-[var(--color-border-default)] text-center">
                          <div class="text-sm text-[var(--color-text-secondary)]">
                            {processingJob()?.message || "processing..."}
                          </div>
                        </div>
                      }
                    >
                      <label class="block">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleImageSelect}
                          class="hidden"
                        />
                        <div class="p-8 border-2 border-dashed border-[var(--color-border-default)] rounded hover:border-[var(--color-primary)] transition-colors cursor-pointer text-center">
                          <Icon
                            name={IconNames.upload}
                            size={32}
                            className="mx-auto mb-2 text-[var(--color-text-tertiary)]"
                          />
                          <div class="text-sm text-[var(--color-text-primary)]">
                            click to upload image
                          </div>
                          <div class="text-xs text-[var(--color-text-tertiary)] mt-1">
                            jpg, png, webp (max 10mb)
                          </div>
                        </div>
                      </label>
                    </Show>
                  </div>
                </div>
              </TabPanel>
        </Tabs>

        {/* footer - only show on metadata tab */}
        <Show when={activeTab() === "metadata"}>
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
        </Show>
      </div>
    </div>
  );
}
