// album editor modal - edit album metadata
import { createEffect, createMemo, createSignal, For, onMount, Show } from "solid-js";
import { useQueryClient } from "@tanstack/solid-query";
import type { ImageMetadata, Song } from "../../music/services/storage/types";
import { getDataSource, getCurrentRemote } from "../../music/data";
import { getRemoteMediaUrl } from "../../utils/urls";
import { canUpdateAlbum, canDeleteAlbum } from "../../music/data/permissions";
import { useUpdateAlbumMutation } from "../../music/queries/mutations";
import { queryKeys } from "../../music/queries/queryKeys";
import { useAlbumQuery, useAlbumSongsQuery } from "../../music/queries/songs";
import { pollJobUntilComplete } from "../../app/services/jobs/jobService";
import { confirm } from "../../app/services/confirmState";
import { Button } from "../buttons/Button";
import { toast } from "../feedback/Toast";
import { ArtistAutocomplete } from "../forms/ArtistAutocomplete";
import { AlbumAutocomplete } from "../forms/AlbumAutocomplete";
import { GenreAutocomplete } from "../forms/GenreAutocomplete";
import { TextInput } from "../forms/TextInput";
import { Icon, IconNames } from "../icons/registry";
import { Tabs, TabList, Tab, TabPanel } from "../navigation/Tabs";
import { EntityImages } from "../layout/EntityImages";
import { MusicBrainzPanel } from "../musicbrainz/MusicBrainzPanel";
import { pushModal, popModal } from "../../music/hooks/modals";
import { EntityUrlz, type EntityUrlFormItem } from "../forms/EntityUrlz";
import { formatDuration } from "../../utils/formatDuration";
import { formatDateTime } from "../../utils/dateTime";

interface AlbumEditorModalProps {
  albumId: string;
  onClose: () => void;
  onSave?: () => void;
  /** if true, hides buttons that would open other modals (prevents infinite recursion) */
  disableNestedModals?: boolean;
  /** callback to open song editor modal */
  onOpenSongEditor?: (songId: string) => void;
  /** called after a successful merge with the target album id, so callers can navigate */
  onMergeNavigate?: (newAlbumId: string) => void;
}

// inline component for bulk-setting disc number on all songs in an album
function DiscNumberBulkAction(props: { songs: Song[]; onUpdated: () => void }) {
  const [editing, setEditing] = createSignal(false);
  const [discNum, setDiscNum] = createSignal("");
  const [applying, setApplying] = createSignal(false);

  const currentDisc = () => {
    const discs = new Set(props.songs.map((s) => s.disc_number || 1));
    return discs.size === 1 ? [...discs][0] : null;
  };

  const handleApply = async () => {
    const num = parseInt(discNum(), 10);
    if (isNaN(num) || num < 1) {
      toast.error("enter a valid disc number");
      return;
    }

    const dataSource = getDataSource();
    if (!dataSource.updateSong) {
      toast.error("cannot update songs");
      return;
    }

    setApplying(true);
    try {
      // single API call — updateSong applies same disc_number to all song_ids
      await dataSource.updateSong({
        song_ids: props.songs.map((s) => s.id),
        disc_number: num,
      });

      toast.success(`set disc number to ${num} for ${props.songs.length} songs`);
      props.onUpdated();
      setEditing(false);
    } catch (err) {
      console.error("failed to update disc number:", err);
      toast.error("failed to update disc number");
    } finally {
      setApplying(false);
    }
  };

  return (
    <Show
      when={editing()}
      fallback={
        <button
          onClick={() => {
            const cur = currentDisc();
            setDiscNum(cur ? String(cur) : "1");
            setEditing(true);
          }}
          class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
        >
          set disc #
        </button>
      }
    >
      <div class="flex items-center gap-1.5">
        <span class="text-xs text-[var(--color-text-tertiary)]">disc</span>
        <input
          type="number"
          min="1"
          value={discNum()}
          onInput={(e) => setDiscNum(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && handleApply()}
          class="w-12 px-1.5 py-0.5 text-xs bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] text-center"
        />
        <button
          onClick={handleApply}
          disabled={applying()}
          class="text-xs text-[var(--color-accent-500)] hover:text-[var(--color-accent-400)] disabled:opacity-50"
        >
          {applying() ? "..." : "apply all"}
        </button>
        <button
          onClick={() => setEditing(false)}
          class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
        >
          cancel
        </button>
      </div>
    </Show>
  );
}

interface FormData {
  title: string;
  artist_id: string | undefined;
  artist_name: string;
  album_type: string;
  genre_ids: string[];
  genres: string[];
  new_genres: string[]; // genres without IDs (will be created on save)
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
    genre_ids: [],
    genres: [],
    new_genres: [],
    release_date: "",
    label: "",
    uploaded_blob_id: null,
  });

  const [initialData, setInitialData] = createSignal<FormData | null>(null);
  const [loadedAlbumId, setLoadedAlbumId] = createSignal<string | null>(null);
  const [activeTab, setActiveTab] = createSignal<"info" | "images" | "musicbrainz">("info");
  const [images, setImages] = createSignal<ImageMetadata[]>([]);

  // when user picks an existing album from autocomplete, store its ID for merge
  const [mergeTargetAlbumId, setMergeTargetAlbumId] = createSignal<string | undefined>(undefined);

  // entity URLs management
  const [entityUrls, setEntityUrls] = createSignal<EntityUrlFormItem[]>([]);
  const [initialEntityUrls, setInitialEntityUrls] = createSignal<EntityUrlFormItem[]>([]);
  const [_imagePreview, setImagePreview] = createSignal<string | null>(null);
  const [processingJob, setProcessingJob] = createSignal<{
    status: string;
    message: string;
  } | null>(null);

  // helper to sync form state from query data
  const syncFormFromData = (album: NonNullable<typeof albumQuery.data>, songs: Song[]) => {
    const firstSong = songs[0];
    if (!firstSong) return;

    const data: FormData = {
      title: album.title || "",
      artist_id: firstSong.artist_id,
      artist_name: firstSong.artist_name || "",
      album_type: album.album_type || "album",
      genre_ids: album.genres?.map((g) => g.id) || [],
      genres: album.genres?.map((g) => g.name) || [],
      new_genres: [],
      release_date: album.release_date || "",
      label: album.label || "",
      uploaded_blob_id: null,
    };
    setFormData(data);
    setInitialData(data);
  };

  // initialize form data, images, and entity URLs when album loads or when albumId changes
  // guarded by loadedAlbumId to prevent refetchOnWindowFocus from wiping unsaved edits
  createEffect(() => {
    const album = albumQuery.data;
    const songs = songsQuery.data?.items;
    // reinitialize if this is a different album or first load
    if (album && songs && songs.length > 0 && loadedAlbumId() !== props.albumId) {
      syncFormFromData(album, songs);

      // sync images
      if (album.images) {
        setImages(album.images);
      }

      // sync entity URLs
      if (album.urls) {
        const mapped = album.urls.map((u) => ({
          id: u.id ?? undefined,
          name: u.name ?? "",
          url: u.url,
        }));
        setEntityUrls(mapped);
        setInitialEntityUrls(mapped);
      }

      setLoadedAlbumId(props.albumId);
      setMergeTargetAlbumId(undefined);
    }
  });

  // register modal in stack for esc key handling
  onMount(() => {
    const modalId = `album-${props.albumId}`;
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
      current.artist_id !== initial.artist_id ||
      current.artist_name !== initial.artist_name ||
      current.album_type !== initial.album_type ||
      JSON.stringify(current.genre_ids) !== JSON.stringify(initial.genre_ids) ||
      JSON.stringify(current.genres) !== JSON.stringify(initial.genres) ||
      current.new_genres.length > 0 ||
      current.release_date !== initial.release_date ||
      current.label !== initial.label ||
      current.uploaded_blob_id !== null ||
      mergeTargetAlbumId() !== undefined ||
      urlsChanged()
    );
  });

  const handleSave = async () => {
    if (!hasChanges()) return;

    const data = formData();
    const initial = initialData();
    const mergeTarget = mergeTargetAlbumId();

    // if merging into another album, send merge_into_album_id and skip other field updates
    if (mergeTarget) {
      try {
        await updateMutation.mutateAsync({
          album_id: props.albumId,
          merge_into_album_id: mergeTarget,
        });

        // invalidate before closing so the UI refreshes even if the modal unmounts
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() }),
          queryClient.invalidateQueries({ queryKey: queryKeys.albums.detail(mergeTarget) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.albums.songs(mergeTarget) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() }),
          queryClient.invalidateQueries({ queryKey: queryKeys.artists.all() }),
          queryClient.invalidateQueries({ queryKey: queryKeys.genres.all() }),
        ]);

        props.onSave?.();
        props.onMergeNavigate?.(mergeTarget);
        props.onClose();
      } catch (error) {
        console.error("failed to merge album:", error);
      }
      return;
    }

    // determine if genres changed (either IDs or new genres added)
    const genresChanged =
      JSON.stringify(data.genre_ids) !== JSON.stringify(initial?.genre_ids) ||
      JSON.stringify(data.genres) !== JSON.stringify(initial?.genres) ||
      data.new_genres.length > 0;

    try {
      await updateMutation.mutateAsync({
        album_id: props.albumId,
        title: data.title !== initial?.title ? data.title : undefined,
        artist_id: data.artist_id !== initial?.artist_id ? data.artist_id : undefined,
        artist_name: data.artist_name !== initial?.artist_name ? data.artist_name : undefined,
        album_type: data.album_type !== initial?.album_type ? data.album_type : undefined,
        // send existing genre IDs (or empty array to clear all)
        genre_ids: genresChanged ? data.genre_ids : undefined,
        // send new genre names to be created
        genres: genresChanged && data.new_genres.length > 0 ? data.new_genres : undefined,
        release_date:
          data.release_date !== initial?.release_date && data.release_date
            ? data.release_date
            : undefined,
        label: data.label !== initial?.label ? data.label : undefined,
        // send entity URLs if changed (filter out deleted, map with null id for new)
        entity_urls: urlsChanged()
          ? entityUrls()
              .filter((u) => !u.isDeleted)
              .map((u) => ({ id: u.id || null, name: u.name || null, url: u.url }))
          : undefined,
      });

      // invalidate before closing so the UI refreshes even if the modal unmounts
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.albums.detail(props.albumId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.albums.songs(props.albumId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.artists.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.genres.all() }),
      ]);

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
      setMergeTargetAlbumId(undefined);
    }
  };

  const handleDelete = async () => {
    const album = albumQuery.data;
    if (!album) return;

    const confirmed = await confirm({
      title: "delete album",
      message: `are you sure you want to delete "${album.title}"? this will also delete all songs in this album. this cannot be undone.`,
      confirmText: "delete",
      variant: "danger",
    });

    if (confirmed) {
      try {
        const dataSource = getDataSource();
        if (dataSource.deleteAlbum) {
          await dataSource.deleteAlbum(props.albumId);
          toast.success(`deleted "${album.title}"`);
          queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() });
          queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });
          queryClient.invalidateQueries({ queryKey: queryKeys.artists.all() });
          props.onClose();
        } else {
          toast.error("delete not supported for this data source");
        }
      } catch (error) {
        console.error("failed to delete album:", error);
        toast.error("failed to delete album");
      }
    }
  };

  const handleResetField = (field: keyof FormData) => {
    const initial = initialData();
    if (!initial) return;

    setFormData((prev) => ({
      ...prev,
      [field]: initial[field],
    }));

    // also reset merge target when resetting title
    if (field === "title") {
      setMergeTargetAlbumId(undefined);
    }

    // reset both artist fields together
    if (field === "artist_name" || field === "artist_id") {
      setFormData((prev) => ({
        ...prev,
        artist_id: initial.artist_id,
        artist_name: initial.artist_name,
      }));
    }

    if (field === "uploaded_blob_id") {
      setImagePreview(null);
      setProcessingJob(null);
    }
  };

  // shared image upload logic for both File and file path
  const handleImageUpload = async (params: { file?: File; filePath?: string }) => {
    try {
      const dataSource = getDataSource();
      if (!dataSource.uploadImage) {
        toast.error("image upload not supported");
        return;
      }

      setProcessingJob({ status: "uploading", message: "uploading image..." });

      const { blob_id, job_id } = await dataSource.uploadImage({
        ...params,
        entityType: "album",
        entityId: props.albumId,
        isPrimary: images().length === 0, // first image is primary
      });

      // poll for job completion
      const remote = getCurrentRemote();
      if (remote) {
        setProcessingJob({ status: "processing", message: "processing image..." });
        const pollResult = await pollJobUntilComplete(remote, job_id, 10000);
        if (pollResult === "failed") {
          toast.error("image processing failed");
          setProcessingJob(null);
          return;
        }
        if (pollResult === "timeout") {
          toast.info("image processing taking a long time — check back later", {
            title: "processing queued",
          });
          setProcessingJob(null);
          return;
        }
      }

      // construct proper image metadata based on data source
      const isPrimary = images().length === 0;
      let newImage: ImageMetadata;
      if (remote) {
        // remote upload - always use remote_blob_id + remote_server_id
        // only set remote_url for standard HTTP (not tauri-managed, which uses IPC)
        const remoteUrl =
          remote.base_url && !remote.is_charnel_managed
            ? getRemoteMediaUrl(remote.base_url, blob_id)
            : undefined;
        newImage = {
          remote_blob_id: blob_id,
          remote_url: remoteUrl,
          remote_server_id: remote.remote_id,
          is_primary: isPrimary,
          blob_type: "thumbnail",
        };
      } else {
        // local upload - use local field
        newImage = {
          local_blob_id: blob_id,
          is_primary: isPrimary,
          blob_type: "thumbnail",
        };
      }

      const updatedImages = [...images(), newImage];
      setImages(updatedImages);

      setProcessingJob(null);
      toast.success("image uploaded");
      albumQuery.refetch();
      // invalidate album and song queries to update all views
      // songs have album_images embedded, so they need refresh too
      queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });
      // also invalidate artist song queries (used by artist detail view)
      queryClient.invalidateQueries({ queryKey: ["artist", "songs"] });
    } catch (err) {
      console.error("failed to upload image:", err);
      toast.error("failed to upload image");
      setProcessingJob(null);
    }
  };

  const handleImageSelectPath = async (filePath: string) => {
    await handleImageUpload({ filePath });
  };

  const handleTogglePrimary = async (index: number) => {
    const imageToSet = images()[index];
    const blobId = imageToSet.remote_blob_id || imageToSet.local_blob_id;

    if (!blobId) {
      toast.error("no blob ID found for this image");
      return;
    }

    try {
      const datasource = getDataSource();
      await datasource.setPrimaryImage?.({
        entityType: "album",
        entityId: props.albumId,
        blobId,
      });

      const updatedImages = images().map((img, i) => ({
        ...img,
        is_primary: i === index,
      }));
      setImages(updatedImages);

      toast.success("primary image updated");
      albumQuery.refetch();
      // invalidate album queries to update all views
      queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() });
    } catch (err) {
      console.error("failed to update primary image:", err);
      toast.error("failed to update primary image");
    }
  };

  const handleRemoveImage = async (index: number) => {
    try {
      const imageToRemove = images()[index];
      const albumData = albumQuery.data;
      if (!albumData) return;

      const blobId = imageToRemove.remote_blob_id || imageToRemove.local_blob_id;
      if (!blobId) {
        console.error("image missing blob ID:", imageToRemove);
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
        entityType: "album",
        entityId: albumData.album_id,
        blobId: blobId,
      });

      const updatedImages = images().filter((_, i) => i !== index);

      // if removing primary, make first remaining image primary
      if (imageToRemove.is_primary && updatedImages.length > 0) {
        updatedImages[0].is_primary = true;
      }

      setImages(updatedImages);
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
      <div class="bg-[var(--color-bg-primary)] rounded-lg shadow-xl w-full max-w-3xl h-[90dvh] wide:h-[85dvh] overflow-hidden flex flex-col">
        {/* header */}
        <div class="flex items-center justify-between p-6">
          <h2 class="text-xl font-semibold text-[var(--color-text-primary)]">edit album</h2>
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
          <Tabs
            activeTab={activeTab()}
            onTabChange={setActiveTab}
            class="flex-1 flex flex-col min-h-0"
          >
            <TabList class="px-6">
              <Tab id="info" label="info" />
              <Tab id="images" label="images" badge={images().length || undefined} />
              <Tab id="metadata" label="metadata" />
              <Tab id="musicbrainz" label="musicbrainz" />
            </TabList>

            <TabPanel id="info" class="flex-1 overflow-y-auto p-6 space-y-6">
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
                <AlbumAutocomplete
                  value={formData().title}
                  onSelect={(selection) => {
                    setFormData((prev) => ({
                      ...prev,
                      title: selection.title,
                    }));
                    // if user picked an existing album (not the current one), it's a merge
                    if (selection.id && selection.id !== props.albumId) {
                      setMergeTargetAlbumId(selection.id);
                    } else {
                      setMergeTargetAlbumId(undefined);
                    }
                  }}
                  placeholder="album title"
                  newLabel={(input) => `rename to: ${input}`}
                />
                <Show when={mergeTargetAlbumId()}>
                  <p class="text-xs text-yellow-500">
                    this will merge all songs into the selected album and delete this one
                  </p>
                </Show>
                <Show when={!mergeTargetAlbumId() && formData().title !== initialData()?.title}>
                  <p class="text-xs text-[var(--color-text-tertiary)]">
                    this will rename the album
                  </p>
                </Show>
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
                  newLabel={(input) => `rename to: ${input}`}
                />
                <p class="text-xs text-[var(--color-text-tertiary)]">
                  changing the artist will move all songs to a different album scoped to that artist
                </p>
              </div>

              {/* genres */}
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <Show
                    when={
                      JSON.stringify(formData().genres) !== JSON.stringify(initialData()?.genres)
                    }
                  >
                    <button
                      onClick={() => handleResetField("genres")}
                      class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                    >
                      reset
                    </button>
                  </Show>
                </div>
                <GenreAutocomplete
                  label="genres"
                  value={formData().genres}
                  valueIds={formData().genre_ids}
                  onSelect={(genres, genreIds, newGenreNames) =>
                    setFormData((prev) => ({
                      ...prev,
                      genre_ids: genreIds,
                      genres: genres,
                      new_genres: newGenreNames,
                    }))
                  }
                  placeholder="select or type genres"
                  hint="choose one or more genres for this album"
                />
              </div>

              {/* album type */}
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <label class="block text-sm font-medium text-[var(--color-text-primary)]">
                    album type
                  </label>
                  <Show when={formData().album_type !== initialData()?.album_type}>
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

              {/* entity URLs */}
              <div class="space-y-2">
                <EntityUrlz urls={entityUrls()} onChange={setEntityUrls} />
              </div>

              {/* songs list */}
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <label class="block text-sm font-medium text-[var(--color-text-primary)]">
                    songs in album ({songs().length})
                  </label>
                  <Show when={songs().length > 0}>
                    <DiscNumberBulkAction
                      songs={songs()}
                      onUpdated={() => {
                        songsQuery.refetch();
                        queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });
                      }}
                    />
                  </Show>
                </div>
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
                              <span class="text-xs text-[var(--color-text-tertiary)] w-8 flex-shrink-0 text-right">
                                <span class="opacity-50">{song.disc_number || 1}.</span>
                                {song.track_number}
                              </span>
                              <span class="text-sm text-[var(--color-text-primary)] truncate flex-1">
                                {song.title}
                              </span>
                              <span class="text-sm text-[var(--color-text-tertiary)] truncate">
                                {formatDuration(song.duration_seconds)}
                              </span>
                            </div>
                          </div>
                          <Show when={!props.disableNestedModals && props.onOpenSongEditor}>
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
                onUpload={(file) => handleImageUpload({ file })}
                onUploadPath={handleImageSelectPath}
                onDelete={handleRemoveImage}
                onSetPrimary={handleTogglePrimary}
                uploading={!!processingJob()}
              />
            </TabPanel>

            {/* metadata tab - album info */}
            <TabPanel id="metadata" class="flex-1 overflow-y-auto p-6 space-y-1">
              <Show when={albumQuery.data?.created_at} keyed>
                {(createdAt) => (
                  <div class="text-sm">
                    <span class="text-[var(--color-text-tertiary)]">created: </span>
                    <span class="text-[var(--color-text-secondary)]">
                      {formatDateTime(createdAt * 1000)}
                    </span>
                    <Show when={albumQuery.data?.created_by_username}>
                      <span class="text-[var(--color-text-tertiary)]"> by </span>
                      <span class="text-[var(--color-text-secondary)]">
                        {albumQuery.data!.created_by_username}
                      </span>
                    </Show>
                  </div>
                )}
              </Show>
              <Show
                when={
                  albumQuery.data?.updated_at &&
                  albumQuery.data.updated_at !== albumQuery.data.created_at
                    ? albumQuery.data.updated_at
                    : undefined
                }
                keyed
              >
                {(updatedAt) => (
                  <div class="text-sm">
                    <span class="text-[var(--color-text-tertiary)]">updated: </span>
                    <span class="text-[var(--color-text-secondary)]">
                      {formatDateTime(updatedAt * 1000)}
                    </span>
                    <Show when={albumQuery.data?.updated_by_username}>
                      <span class="text-[var(--color-text-tertiary)]"> by </span>
                      <span class="text-[var(--color-text-secondary)]">
                        {albumQuery.data!.updated_by_username}
                      </span>
                    </Show>
                  </div>
                )}
              </Show>
            </TabPanel>

            <TabPanel id="musicbrainz" class="flex-1 overflow-y-auto p-6">
              <MusicBrainzPanel
                albumId={props.albumId}
                albumTitle={formData().title}
                artistId={formData().artist_id || ""}
                artistName={formData().artist_name}
                albumType={formData().album_type}
                releaseDate={formData().release_date || undefined}
                label={formData().label || undefined}
                genres={formData().genres}
                songs={songs()}
                onAlbumUpdated={async () => {
                  // invalidate broad query families so all views update
                  queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() });
                  queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });
                  queryClient.invalidateQueries({ queryKey: queryKeys.artists.all() });
                  queryClient.invalidateQueries({ queryKey: queryKeys.genres.all() });
                  queryClient.invalidateQueries({
                    queryKey: queryKeys.albums.songs(props.albumId),
                  });
                  queryClient.invalidateQueries({ queryKey: ["artist", "songs"] });

                  // refetch this modal's data and re-sync form when done
                  const [albumResult, songsResult] = await Promise.all([
                    albumQuery.refetch(),
                    songsQuery.refetch(),
                  ]);
                  if (albumResult.data && songsResult.data?.items?.length) {
                    syncFormFromData(albumResult.data, songsResult.data.items);
                  }
                }}
              />
            </TabPanel>
          </Tabs>
        </Show>

        {/* footer */}
        <Show when={initialData() && activeTab() === "info"}>
          <div class="flex items-center justify-between p-6">
            <Show when={canDeleteAlbum()}>
              <Button onClick={handleDelete} variant="danger">
                delete
              </Button>
            </Show>
            <div class="flex items-center gap-3">
              <Show when={hasChanges() && canUpdateAlbum()}>
                <button
                  onClick={handleReset}
                  class="text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                >
                  reset all
                </button>
              </Show>
              <Button variant="secondary" onClick={props.onClose}>
                cancel
              </Button>
              <Show when={canUpdateAlbum()}>
                <Button variant="primary" onClick={handleSave} disabled={!hasChanges()}>
                  save changes
                </Button>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
