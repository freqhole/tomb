// song editor modal - edit single song metadata
import { createEffect, createMemo, createSignal, onMount, Show } from "solid-js";
import type { ImageMetadata } from "../../music/services/storage/types";
import { getDataSource, getCurrentRemote } from "../../music/data";
import { canUpdateSong, canDeleteSong } from "../../music/data/permissions";
import { showAlbumEditor, showArtistEditor, pushModal, popModal } from "../../music/hooks/modals";
import { useSongQuery, useUpdateSongsMutation } from "../../music/queries/songs";
import { queryClient } from "../../queryClient";
import { queryKeys } from "../../music/queries/queryKeys";
import { pollJobUntilComplete } from "../../utils/jobs";
import { confirm } from "../../app/services/confirmState";
import { Button } from "../buttons/Button";
import { toast } from "../feedback/Toast";
import { AlbumAutocomplete } from "../forms/AlbumAutocomplete";
import { ArtistAutocomplete } from "../forms/ArtistAutocomplete";
import { EntityUrlz, type EntityUrlFormItem } from "../forms/EntityUrlz";
import { TextInput } from "../forms/TextInput";
import { Icon, IconNames } from "../icons/registry";
import { Tabs, TabList, Tab, TabPanel } from "../navigation/Tabs";
import { EntityImages } from "../layout/EntityImages";
import { MetadataDisplay } from "../layout/MetadataDisplay";
import { error as errorLog } from "../../utils/logger";

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
  bpm: number | null;
  lyrics: string;
  artist_name: string;
  album_title: string;
  track_artist: string;
}

export function SongEditorModal(props: SongEditorModalProps) {
  const songQuery = useSongQuery(() => props.songId);
  const updateMutation = useUpdateSongsMutation();

  const [activeTab, setActiveTab] = createSignal("info");
  const [formData, setFormData] = createSignal<FormData>({
    title: "",
    track_number: 1,
    disc_number: 1,
    bpm: null,
    lyrics: "",
    artist_name: "",
    album_title: "",
    track_artist: "",
  });

  const [initialData, setInitialData] = createSignal<FormData | null>(null);
  const [lyricsExpanded, setLyricsExpanded] = createSignal(false);
  const [artistId, setArtistId] = createSignal<string | undefined>(undefined);
  const [albumId, setAlbumId] = createSignal<string | undefined>(undefined);

  // entity URLs management
  const [entityUrls, setEntityUrls] = createSignal<EntityUrlFormItem[]>([]);
  const [initialEntityUrls, setInitialEntityUrls] = createSignal<EntityUrlFormItem[]>([]);
  // image management
  const [songImages, setSongImages] = createSignal<ImageMetadata[]>([]);
  const albumImages = () => songQuery.data?.album_images ?? [];
  const [loadedSongId, setLoadedSongId] = createSignal<string | null>(null);
  const [_imagePreview, setImagePreview] = createSignal<string | null>(null);
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
        bpm: song.bpm,
        lyrics: song.lyrics || "",
        artist_name: song.artist_name,
        album_title: song.album_title,
        track_artist: song.track_artist || "",
      };
      setFormData(data);
      setInitialData(data);
      setArtistId(song.artist_id);
      setAlbumId(song.album_id);
      setLoadedSongId(props.songId);

      // initialize entity URLs from song data
      const urls = (song.urls || []).map((u) => ({
        id: u.id,
        name: u.name || "",
        url: u.url,
      }));
      setEntityUrls(urls);
      setInitialEntityUrls(urls.map((u) => ({ ...u }))); // deep copy for comparison

      // auto-expand lyrics if song has lyrics
      if (song.lyrics && song.lyrics.trim().length > 0) {
        setLyricsExpanded(true);
      }

      // initialize images
      if (song.images) {
        setSongImages(song.images);
      }
    }
  });

  // note: song images are intentionally NOT synced on every refetch here.
  // they are initialized inside the guarded loadedSongId effect above
  // to prevent refetchOnWindowFocus from wiping unsaved state.
  // images are refreshed explicitly after upload/delete operations.
  // register modal in stack for esc key handling
  onMount(() => {
    const modalId = `song-${props.songId}`;
    pushModal(modalId, props.onClose);
    return () => popModal(modalId);
  });

  // helper to check if entity URLs have changed
  const urlsChanged = () => {
    const current = entityUrls();
    const initial = initialEntityUrls();

    // check for new or deleted URLs
    const hasNewUrls = current.some((u) => u.isNew);
    const hasDeletedUrls = current.some((u) => u.isDeleted);
    if (hasNewUrls || hasDeletedUrls) return true;

    // check for modified existing URLs
    for (let i = 0; i < current.length; i++) {
      const curr = current[i];
      const init = initial[i];
      if (!init) return true;
      if (curr.name !== init.name || curr.url !== init.url) return true;
    }

    return current.length !== initial.length;
  };

  const hasChanges = createMemo(() => {
    const current = formData();
    const initial = initialData();
    if (!initial) return false;

    return (
      current.title !== initial.title ||
      current.track_number !== initial.track_number ||
      current.disc_number !== initial.disc_number ||
      current.bpm !== initial.bpm ||
      current.lyrics !== initial.lyrics ||
      current.artist_name !== initial.artist_name ||
      current.album_title !== initial.album_title ||
      current.track_artist !== initial.track_artist ||
      urlsChanged()
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
    if (current.track_number !== initial.track_number) updates.track_number = current.track_number;
    if (current.disc_number !== initial.disc_number) updates.disc_number = current.disc_number;
    if (current.bpm !== initial.bpm) updates.bpm = current.bpm;
    if (current.lyrics !== initial.lyrics) updates.lyrics = current.lyrics;
    if (current.track_artist !== initial.track_artist)
      updates.track_artist = current.track_artist || null;
    if (current.artist_name !== initial.artist_name) {
      // prefer artist_id when available (from autocomplete selection)
      if (artistId()) updates.artist_id = artistId();
      else updates.artist = current.artist_name;
    }
    if (current.album_title !== initial.album_title) {
      // prefer album_id when available (from autocomplete selection)
      if (albumId()) updates.album_id = albumId();
      else updates.album = current.album_title;
    }

    // include entity URLs if changed (filter out deleted URLs)
    if (urlsChanged()) {
      const activeUrls = entityUrls()
        .filter((u) => !u.isDeleted)
        .map((u) => ({ id: u.id || null, name: u.name || null, url: u.url }));
      updates.entity_urls = activeUrls;
    }

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
      errorLog("failed to save song:", error);
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

  const handleDelete = async () => {
    const song = songQuery.data;
    if (!song) return;

    const confirmed = await confirm({
      title: "delete song",
      message: `are you sure you want to delete "${song.title}"? this cannot be undone.`,
      confirmText: "delete",
      variant: "danger",
    });

    if (confirmed) {
      try {
        const dataSource = getDataSource();
        if (dataSource.deleteSong) {
          await dataSource.deleteSong(props.songId);
          toast.success(`deleted "${song.title}"`);
          queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });
          queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() });
          queryClient.invalidateQueries({ queryKey: queryKeys.artists.all() });
          props.onClose();
        } else {
          toast.error("delete not supported for this data source");
        }
      } catch (error) {
        errorLog("failed to delete song:", error);
        toast.error("failed to delete song");
      }
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
      const result = await datasource.uploadImage?.({
        file,
        entityType: "song",
        entityId: props.songId,
      });

      if (!result) {
        setProcessingJob(null);
        setImagePreview(null);
        toast.error("failed to upload image");
        return;
      }

      const { blob_id, job_id } = result;

      // poll for job completion
      const remote = getCurrentRemote();
      if (remote?.base_url) {
        setProcessingJob({ status: "processing", message: "processing image..." });
        const pollResult = await pollJobUntilComplete(remote.base_url, job_id);
        if (pollResult === "failed") {
          toast.error("image processing failed");
          setProcessingJob(null);
          setImagePreview(null);
          return;
        }
        if (pollResult === "timeout") {
          toast.info("image processing taking a long time — check back later", {
            title: "processing queued",
          });
          setProcessingJob(null);
          setImagePreview(null);
          return;
        }
      }

      // add new image to list (marked as primary if it's the first one)
      const newImage: ImageMetadata = {
        local_blob_id: blob_id,
        is_primary: songImages().length === 0,
        blob_type: "thumbnail",
      };
      const updatedImages = [...songImages(), newImage];
      setSongImages(updatedImages);

      setProcessingJob({ status: "completed", message: "image uploaded successfully" });
      setTimeout(() => {
        setProcessingJob(null);
        setImagePreview(null);
      }, 2000);

      toast.success("image uploaded successfully");

      // invalidate queries to refresh UI
      songQuery.refetch();
      queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });
    } catch (err) {
      errorLog("failed to upload image:", err);
      toast.error("failed to upload image");
      setProcessingJob(null);
      setImagePreview(null);
    }
  };

  const handleTogglePrimary = async (index: number) => {
    const imageToSet = songImages()[index];
    const blobId = imageToSet.remote_blob_id || imageToSet.local_blob_id;

    if (!blobId) {
      toast.error("no blob ID found for this image");
      return;
    }

    try {
      const datasource = getDataSource();
      await datasource.setPrimaryImage?.({
        entityType: "song",
        entityId: props.songId,
        blobId,
      });

      const updated = songImages().map((img, i) => ({
        ...img,
        is_primary: i === index,
      }));
      setSongImages(updated);

      toast.success("primary image updated");
      songQuery.refetch();
    } catch (err) {
      errorLog("failed to update primary image:", err);
      toast.error("failed to update primary image");
    }
  };

  const handleRemoveImage = async (index: number) => {
    try {
      const imageToRemove = songImages()[index];
      const songData = songQuery.data;
      if (!songData) return;

      const blobId = imageToRemove.remote_blob_id || imageToRemove.local_blob_id;
      if (!blobId) {
        errorLog("image missing blob ID:", imageToRemove);
        toast.error("cannot delete image: missing blob ID");
        return;
      }

      // call API to remove image association
      const dataSource = getDataSource();
      if (!dataSource.removeImage) {
        toast.error("image removal not supported");
        return;
      }
      await dataSource.removeImage({
        entityType: "song",
        entityId: songData.id,
        blobId: blobId,
      });

      const updated = songImages().filter((_, i) => i !== index);

      // if we removed the primary image and there are still images, make the first one primary
      if (updated.length > 0 && !updated.some((img) => img.is_primary)) {
        updated[0].is_primary = true;
      }

      setSongImages(updated);
      toast.success("image removed");
      songQuery.refetch();
    } catch (err) {
      errorLog("failed to remove image:", err);
      toast.error("failed to remove image");
    }
  };

  return (
    <div
      class="fixed inset-0 flex items-center justify-center bg-black/50"
      classList={{ "z-50": !props.disableNestedModals, "z-[60]": props.disableNestedModals }}
    >
      <div class="bg-[var(--color-bg-primary)] rounded-lg shadow-xl w-full max-w-2xl h-[90dvh] md:h-[600px] overflow-hidden flex flex-col">
        {/* header */}
        <div class="flex items-center justify-between p-4">
          <h2 class="text-lg font-semibold text-[var(--color-text-primary)]">edit song</h2>
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
          <div class="bg-[var(--color-bg-elevated)] p-3 mb-2">
            <div class="text-sm text-[var(--color-text-secondary)]">
              editing: {formData().title} - {formData().artist_name}
            </div>
            <div class="text-xs text-[var(--color-text-tertiary)] mt-0.5">
              {formData().album_title}
            </div>
          </div>
        </Show>

        {/* tabs */}
        <Tabs
          activeTab={activeTab()}
          onTabChange={setActiveTab}
          class="flex-1 flex flex-col min-h-0"
        >
          <TabList class="px-4">
            <Tab id="info" label="info" />
            <Tab
              id="images"
              label="images"
              badge={songImages().length + albumImages().length || undefined}
            />
            <Tab id="metadata" label="metadata" />
          </TabList>

          {/* info tab */}
          <TabPanel id="info" class="flex-1 overflow-y-auto">
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
                        oninput={(e) => handleFieldChange("title", e.currentTarget.value)}
                        placeholder="song title"
                      />
                    </div>
                    <Show when={initialData() && formData().title !== initialData()!.title}>
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
                      when={initialData() && formData().artist_name !== initialData()!.artist_name}
                    >
                      <button
                        onClick={() => handleReset("artist_name")}
                        class="mt-6 px-2 py-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                      >
                        reset
                      </button>
                    </Show>
                  </div>

                  {/* track artist (only for compilation albums) */}
                  <Show when={songQuery.data?.album_type === "compilation"}>
                    <div class="flex items-center gap-2">
                      <div class="flex-1">
                        <label class="block text-sm text-[var(--color-text-secondary)] mb-1">
                          track artist
                        </label>
                        <TextInput
                          value={formData().track_artist}
                          oninput={(e) => handleFieldChange("track_artist", e.currentTarget.value)}
                          placeholder="per-track artist (for compilations)"
                        />
                      </div>
                      <Show
                        when={
                          initialData() && formData().track_artist !== initialData()!.track_artist
                        }
                      >
                        <button
                          onClick={() => handleReset("track_artist")}
                          class="mt-6 px-2 py-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                        >
                          reset
                        </button>
                      </Show>
                    </div>
                  </Show>

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
                      when={initialData() && formData().album_title !== initialData()!.album_title}
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
                            handleFieldChange("disc_number", parseInt(e.currentTarget.value) || 1)
                          }
                          min="1"
                          class="w-full px-2 py-2 bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-500)]"
                        />
                      </div>
                      <Show
                        when={
                          initialData() && formData().disc_number !== initialData()!.disc_number
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
                            handleFieldChange("track_number", parseInt(e.currentTarget.value) || 1)
                          }
                          min="1"
                          class="w-full px-2 py-2 bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-500)]"
                        />
                      </div>
                      <Show
                        when={
                          initialData() && formData().track_number !== initialData()!.track_number
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
                              e.currentTarget.value ? parseInt(e.currentTarget.value) : null
                            )
                          }
                          min="1"
                          placeholder="120"
                          class="w-full px-2 py-2 bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-500)]"
                        />
                      </div>
                      <Show when={initialData() && formData().bpm !== initialData()!.bpm}>
                        <button
                          onClick={() => handleReset("bpm")}
                          class="mt-6 px-1 py-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                        >
                          ×
                        </button>
                      </Show>
                    </div>
                  </div>

                  {/* entity URLs */}
                  <div class="mt-4">
                    <EntityUrlz urls={entityUrls()} onChange={setEntityUrls} />
                  </div>

                  {/* lyrics accordion */}
                  <div>
                    <button
                      onClick={() => setLyricsExpanded(!lyricsExpanded())}
                      class="flex items-center justify-between w-full p-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
                    >
                      <span>lyrics</span>
                      <Icon
                        name={lyricsExpanded() ? IconNames.chevronUp : IconNames.chevronDown}
                        size={16}
                      />
                    </button>
                    <Show when={lyricsExpanded()}>
                      <div class="flex items-start gap-2 mt-2">
                        <div class="flex-1">
                          <textarea
                            value={formData().lyrics}
                            oninput={(e) => handleFieldChange("lyrics", e.currentTarget.value)}
                            placeholder="song lyrics..."
                            rows={10}
                            class="w-full px-3 py-2 bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-500)] resize-none"
                          />
                        </div>
                        <Show when={initialData() && formData().lyrics !== initialData()!.lyrics}>
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
          <TabPanel id="images" class="flex-1 overflow-y-auto p-6 space-y-6">
            {/* song images - editable */}
            <EntityImages
              title="song images"
              images={songImages()}
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

            {/* album images - read-only context */}
            <Show when={albumImages().length > 0}>
              <EntityImages title="album images" images={albumImages()} />
            </Show>
          </TabPanel>
          {/* metadata tab - raw JSON display */}
          <TabPanel id="metadata" class="flex-1 overflow-y-auto p-6">
            <Show
              when={songQuery.data?.metadata}
              fallback={
                <div class="text-sm text-[var(--color-text-tertiary)]">no metadata available</div>
              }
            >
              <MetadataDisplay data={songQuery.data!.metadata} />
            </Show>
          </TabPanel>
        </Tabs>

        {/* footer - only show on info tab */}
        <Show when={activeTab() === "info"}>
          <div class="flex items-center justify-between gap-2 p-4">
            <Show when={canDeleteSong()}>
              <Button onClick={handleDelete} variant="danger">
                delete
              </Button>
            </Show>
            <div class="flex items-center gap-2">
              <Button onClick={props.onClose} variant="ghost">
                cancel
              </Button>
              <Show when={canUpdateSong()}>
                <Button
                  onClick={handleSave}
                  variant="primary"
                  disabled={!hasChanges() || updateMutation.isPending}
                >
                  {updateMutation.isPending ? "saving..." : "save"}
                </Button>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
