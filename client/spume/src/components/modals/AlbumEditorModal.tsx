// album editor modal - edit album metadata
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
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
import { Icon, IconNames } from "../icons/registry";
import { Tabs, TabList, Tab, TabPanel } from "../navigation/Tabs";
import { EntityImages } from "../layout/EntityImages";
import { MusicBrainzPanel } from "../musicbrainz/MusicBrainzPanel";
import {
  AlbumEnrichmentSourceTab,
  type SourceProgress,
} from "../enrichment/AlbumEnrichmentSourceTab";
import { AlbumArtistTab } from "../enrichment/AlbumArtistTab";
import { parseAlbumMetadata } from "../../library/data/albumMetadata";
import { getClientForRemote } from "../../app/api/client";
import { Modal } from "./Modal";
import { AlbumTaxonsEditor, type AlbumTaxonsEditorHandle } from "./AlbumTaxonsEditor";
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
  /**
   * bulk-enrichment review mode (phase 14.7).
   *
   * deliberately named "review" rather than "queue" to avoid clashing
   * with the player's song queue (`QueueSidebar`, `currentQueueIndex`).
   *
   * when set, the modal renders:
   *   - a header strip showing `n / total — title`
   *   - a footer toolbar `[skip] [save & next] [save & close] [exit]`
   *     replacing the normal save/cancel buttons
   *   - keyboard bindings: `j` / arrow-right → next, `k` / arrow-left
   *     → prev, `escape` → exit (no save).
   */
  review?: {
    ids: string[];
    currentIndex: number;
    onNext: () => void;
    onPrev: () => void;
    onExit: () => void;
  };
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

    uploaded_blob_id: null,
  });

  const [initialData, setInitialData] = createSignal<FormData | null>(null);
  const [loadedAlbumId, setLoadedAlbumId] = createSignal<string | null>(null);
  const [activeTab, setActiveTab] = createSignal<
    "info" | "images" | "metadata" | "musicbrainz" | "lastfm" | "audiodb" | "artist"
  >("info");
  const [images, setImages] = createSignal<ImageMetadata[]>([]);

  // per-source enrichment progress (phase 14.7). polled while the modal is
  // open so the per-source tabs can show fresh status badges, retry counts,
  // and last-error info without each tab firing its own request.
  const [enrichmentProgress, setEnrichmentProgress] = createSignal<Record<string, SourceProgress>>(
    {}
  );

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

  // taxons editor handle + dirty bit. the editor batches add/remove
  // operations until apply() is called from handleSave so the modal's
  // save/reset/dirty flow stays consistent.
  let taxonsHandle: AlbumTaxonsEditorHandle | undefined;
  const [taxonsDirty, setTaxonsDirty] = createSignal(false);

  // helper to sync form state from query data. songs are best-effort -
  // when an album has no songs (or the songs query hasn't resolved yet
  // for a review-mode album), we still initialize so the modal renders
  // instead of staying stuck on "loading...".
  const syncFormFromData = (album: NonNullable<typeof albumQuery.data>, songs: Song[]) => {
    const firstSong = songs[0];

    const data: FormData = {
      title: album.title || "",
      artist_id: firstSong?.artist_id,
      artist_name: firstSong?.artist_name || "",
      album_type: album.album_type || "album",
      uploaded_blob_id: null,
    };
    setFormData(data);
    setInitialData(data);
  };

  // initialize form data, images, and entity URLs when album loads or when albumId changes
  // guarded by loadedAlbumId to prevent refetchOnWindowFocus from wiping unsaved edits
  createEffect(() => {
    const album = albumQuery.data;
    const songs = songsQuery.data?.items ?? [];
    // reinitialize if this is a different album or first load.
    // we no longer wait for songs.length > 0 - albums with zero songs
    // (or while the songs query is still in flight) used to leave the
    // modal stuck on "loading..." indefinitely.
    if (album && loadedAlbumId() !== props.albumId) {
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
      current.uploaded_blob_id !== null ||
      mergeTargetAlbumId() !== undefined ||
      urlsChanged() ||
      taxonsDirty()
    );
  });

  const handleSave = async (opts: { stayOpen?: boolean } = {}) => {
    if (!hasChanges()) {
      // in review mode \"save & next\" with no edits should still advance.
      if (opts.stayOpen) return true;
      return true;
    }

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
        if (!opts.stayOpen) props.onClose();
        return true;
      } catch (error) {
        console.error("failed to merge album:", error);
        return false;
      }
    }

    try {
      await updateMutation.mutateAsync({
        album_id: props.albumId,
        title: data.title !== initial?.title ? data.title : undefined,
        artist_id: data.artist_id !== initial?.artist_id ? data.artist_id : undefined,
        artist_name: data.artist_name !== initial?.artist_name ? data.artist_name : undefined,
        album_type: data.album_type !== initial?.album_type ? data.album_type : undefined,
        // genres are now managed via the AlbumTaxonsEditor below (kind=genre)
        // alongside every other taxon kind, so no genre payload is sent here.
        // send entity URLs if changed (filter out deleted, map with null id for new)
        entity_urls: urlsChanged()
          ? entityUrls()
              .filter((u) => !u.isDeleted)
              .map((u) => ({ id: u.id || null, name: u.name || null, url: u.url }))
          : undefined,
      });

      // flush any pending taxon link add/remove ops in the same save.
      // these go through the dedicated `addAlbumTaxon` / `removeAlbumTaxon`
      // routes so musicbrainz / audiodb provenance stays untouched.
      if (taxonsHandle?.isDirty()) {
        try {
          await taxonsHandle.apply();
        } catch (err) {
          console.error("failed to apply taxon edits:", err);
          toast.error("failed to save taxon changes");
        }
      }

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
      if (!opts.stayOpen) props.onClose();
      return true;
    } catch (error) {
      console.error("failed to save album:", error);
      // toast is already shown by mutation onError handler
      return false;
    }
  };

  // review-mode helpers (phase 14.7).
  const reviewMode = () => props.review;
  const reviewTotal = () => reviewMode()?.ids.length ?? 0;
  const reviewIndex = () => reviewMode()?.currentIndex ?? 0;
  const reviewHasPrev = () => reviewMode() != null && reviewIndex() > 0;
  const reviewHasNext = () => reviewMode() != null && reviewIndex() < reviewTotal() - 1;

  const handleSkip = () => {
    if (reviewHasNext()) reviewMode()?.onNext();
    else reviewMode()?.onExit();
  };
  const handleSaveAndNext = async () => {
    const ok = await handleSave({ stayOpen: true });
    if (!ok) return;
    if (reviewHasNext()) reviewMode()?.onNext();
    else reviewMode()?.onExit();
  };
  const handleSaveAndClose = async () => {
    const ok = await handleSave({ stayOpen: true });
    if (!ok) return;
    reviewMode()?.onExit();
  };
  const handleExit = () => reviewMode()?.onExit();

  // keyboard navigation while in review mode. ignored when focus is in a
  // text input / textarea / contenteditable to avoid stealing typing.
  createEffect(() => {
    if (!reviewMode()) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = (t?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (t?.isContentEditable) return;
      if (e.key === "j" || e.key === "ArrowRight") {
        e.preventDefault();
        if (reviewHasNext()) reviewMode()?.onNext();
      } else if (e.key === "k" || e.key === "ArrowLeft") {
        e.preventDefault();
        if (reviewHasPrev()) reviewMode()?.onPrev();
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  // parsed album metadata (phase 14.7). drives the snapshot summaries on
  // the per-source tabs; the modal already loads albumQuery so this is
  // free.
  const albumMetadata = createMemo(() => parseAlbumMetadata(albumQuery.data?.metadata ?? null));

  // poll per-source enrichment progress while the modal is open. polled
  // every 5s; bumped to 2s briefly after a manual refetch/requery.
  const refreshEnrichmentProgress = async () => {
    const remote = getCurrentRemote();
    if (!remote) return;
    try {
      const client = await getClientForRemote(remote);
      const resp = await client.music.getEnrichmentProgress({
        album_ids: [props.albumId],
      });
      if (!resp.success || !resp.data) return;
      const album = resp.data.albums.find((a) => a.album_id === props.albumId);
      if (!album) return;
      const next: Record<string, SourceProgress> = {};
      for (const s of album.sources) {
        next[s.source.toLowerCase()] = {
          status: s.status,
          last_attempt_at: s.last_attempt_at ?? null,
          last_error: s.last_error ?? null,
          retry_count: s.retry_count,
        };
      }
      setEnrichmentProgress(next);
    } catch (err) {
      // silent — the badges just stay stale; user can hit refetch.
      if (typeof console !== "undefined") {
        console.debug("getEnrichmentProgress failed:", err);
      }
    }
  };
  createEffect(() => {
    if (!props.albumId) return;
    refreshEnrichmentProgress();
    const id = window.setInterval(refreshEnrichmentProgress, 5000);
    onCleanup(() => window.clearInterval(id));
  });

  const handleReset = () => {
    const initial = initialData();
    if (initial) {
      setFormData({ ...initial });
      setImagePreview(null);
      setMergeTargetAlbumId(undefined);
    }
    // discard any buffered taxon add/remove ops too
    taxonsHandle?.reset();
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
      albumQuery.refetch();
    } catch (err) {
      console.error("failed to remove image:", err);
      toast.error("failed to remove image");
    }
  };

  const songs = createMemo(() => songsQuery.data?.items || []);

  return (
    <Modal
      isOpen={true}
      onClose={props.onClose}
      title="edit album"
      size="xl"
      elevated={props.disableNestedModals}
    >
      {/* review-mode header strip (phase 14.7) */}
      <Show when={reviewMode()}>
        <div class="flex items-center justify-between gap-4 px-6 py-2 border-b border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] text-xs text-[var(--color-text-secondary)] flex-shrink-0">
          <div class="flex items-center gap-2">
            <span class="font-mono">
              {reviewIndex() + 1} / {reviewTotal()}
            </span>
            <span class="text-[var(--color-text-tertiary)]">-</span>
            <span class="truncate text-[var(--color-text-primary)]">
              {formData().title || albumQuery.data?.title || ""}
            </span>
          </div>
          <div class="flex items-center gap-1">
            <button
              onClick={() => reviewMode()?.onPrev()}
              disabled={!reviewHasPrev()}
              title="previous (k / \u2190)"
              class="px-2 py-1 rounded hover:bg-[var(--color-bg-tertiary)] disabled:opacity-30"
            >
              <Icon name={IconNames.chevronLeft} size={14} />
            </button>
            <button
              onClick={() => reviewMode()?.onNext()}
              disabled={!reviewHasNext()}
              title="next (j / \u2192)"
              class="px-2 py-1 rounded hover:bg-[var(--color-bg-tertiary)] disabled:opacity-30"
            >
              <Icon name={IconNames.chevronRight} size={14} />
            </button>
          </div>
        </div>
      </Show>

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
            <Tab id="lastfm" label="last.fm" />
            <Tab id="audiodb" label="theaudiodb" />
            <Tab id="artist" label="artist" />
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
                <p class="text-xs text-[var(--color-text-tertiary)]">this will rename the album</p>
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

            {/* taxons (genre, label, mood, era, region, ...) — deferred\n                add/remove buffered until the modal's save handler flushes\n                them via `taxonsHandle.apply()`. all kinds (including\n                genre, which used to live in a dedicated GenreAutocomplete\n                section) flow through the same chip ui. */}
            <div class="space-y-2">
              <AlbumTaxonsEditor
                albumId={props.albumId}
                ref={(h) => (taxonsHandle = h)}
                onDirtyChange={setTaxonsDirty}
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

            {/* label and release_date are edited via the taxonomy editor
                above (kind=label, kind=release_date). */}

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
              releaseDate={albumQuery.data?.release_date || undefined}
              label={albumQuery.data?.label || undefined}
              genres={albumQuery.data?.genres?.map((g) => g.name) || []}
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

          <TabPanel id="lastfm" class="flex-1 overflow-y-auto p-6">
            <AlbumEnrichmentSourceTab
              albumId={props.albumId}
              source="lastfm"
              initialArtist={formData().artist_name}
              initialTitle={formData().title}
              snapshot={albumMetadata().lastfm}
              progress={enrichmentProgress().lastfm}
              onRequeried={refreshEnrichmentProgress}
            />
          </TabPanel>

          <TabPanel id="audiodb" class="flex-1 overflow-y-auto p-6">
            <AlbumEnrichmentSourceTab
              albumId={props.albumId}
              source="audiodb"
              initialArtist={formData().artist_name}
              initialTitle={formData().title}
              snapshot={albumMetadata().audiodb}
              progress={enrichmentProgress().audiodb}
              onRequeried={refreshEnrichmentProgress}
            />
          </TabPanel>

          <TabPanel id="artist" class="flex-1 overflow-y-auto p-6">
            <AlbumArtistTab
              artistId={formData().artist_id}
              artistName={formData().artist_name}
              onSaved={refreshEnrichmentProgress}
            />
          </TabPanel>
        </Tabs>
      </Show>

      {/* footer */}
      <Show when={initialData() && (activeTab() === "info" || reviewMode() != null)}>
        <div class="flex items-center justify-between p-6 border-t border-[var(--color-border-default)] flex-shrink-0">
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
            <Show
              when={reviewMode()}
              fallback={
                <>
                  <Button variant="secondary" onClick={props.onClose}>
                    cancel
                  </Button>
                  <Show when={canUpdateAlbum()}>
                    <Button variant="primary" onClick={() => handleSave()} disabled={!hasChanges()}>
                      save changes
                    </Button>
                  </Show>
                </>
              }
            >
              {/* review-mode footer toolbar (phase 14.7) */}
              <Button variant="secondary" onClick={handleSkip}>
                skip
              </Button>
              <Show when={canUpdateAlbum()}>
                <Button
                  variant="secondary"
                  onClick={handleSaveAndClose}
                  disabled={!hasChanges()}
                  title="save current and exit review"
                >
                  save & close
                </Button>
                <Button
                  variant="primary"
                  onClick={handleSaveAndNext}
                  disabled={!hasChanges() && !reviewHasNext()}
                  title="save current and advance"
                >
                  {reviewHasNext() ? "save & next" : "save & finish"}
                </Button>
              </Show>
              <Button variant="secondary" onClick={handleExit}>
                exit
              </Button>
            </Show>
          </div>
        </div>
      </Show>
    </Modal>
  );
}
