// edit video modal — single-video metadata editor, mirrors
// SongEditorModal.tsx's shape: title, description, episode number,
// release date, series/season assignment (with create-new-series
// support), taxon links, entity url links, and renditions list with
// hard-delete.
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { Button } from "../buttons/Button";
import { TextInput } from "../forms/TextInput";
import { Select } from "../forms/Select";
import { VideoSeriesAutocomplete } from "../forms/VideoSeriesAutocomplete";
import { EntityUrlz, type EntityUrlFormItem } from "../forms/EntityUrlz";
import { VideoTaxonsEditor, type VideoTaxonsEditorHandle } from "./VideoTaxonsEditor";
import { EntityImages } from "../layout/EntityImages";
import { toast } from "../feedback/Toast";
import { confirm } from "../../app/services/confirmState";
import { canUpdateVideo } from "../../video/data/permissions";
import {
  useUpdateVideoMutation,
  useVideoQuery,
  useVideoWithMetadataQuery,
} from "../../video/queries/videos";
import { useCreateVideoSeriesMutation } from "../../video/queries/series";
import { getVideoDataSource } from "../../video/data";
import { getClientForRemote } from "../../app/api/client";
import { getCurrentRemote } from "../../music/data";
import { pollJobUntilComplete } from "../../app/services/jobs/jobService";
import type { ImageMetadata } from "../../music/services/storage/types";
import type { VideoRendition } from "@freqhole/api-client";
import { Modal } from "./Modal";
import { Icon, IconNames } from "../icons/registry";
import { formatDateTime } from "../../utils/dateTime";

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export interface EditVideoModalProps {
  videoId: string;
  onClose: () => void;
  onSave?: () => void;
}

interface FormData {
  title: string;
  description: string;
  episode_number: number | null;
  release_date: string;
  series_id: string | null;
  season_id: string | null;
}

export function EditVideoModal(props: EditVideoModalProps) {
  const videoQuery = useVideoQuery(() => props.videoId);
  const videoMetadataQuery = useVideoWithMetadataQuery(() => props.videoId);
  const updateMutation = useUpdateVideoMutation();
  const createSeriesMutation = useCreateVideoSeriesMutation();

  const [formData, setFormData] = createSignal<FormData>({
    title: "",
    description: "",
    episode_number: null,
    release_date: "",
    series_id: null,
    season_id: null,
  });
  const [initialData, setInitialData] = createSignal<FormData | null>(null);
  const [loadedVideoId, setLoadedVideoId] = createSignal<string | null>(null);

  // series autocomplete input text, and the typed name of a not-yet-
  // created series (set when the user picks the "create new" row; the
  // series is only actually created when the modal is saved).
  const [seriesInputValue, setSeriesInputValue] = createSignal("");
  const [pendingNewSeriesName, setPendingNewSeriesName] = createSignal<string | null>(null);

  // entity url links (admin-managed links, eg. wikipedia/imdb)
  const [entityUrls, setEntityUrls] = createSignal<EntityUrlFormItem[]>([]);
  const [initialEntityUrls, setInitialEntityUrls] = createSignal<EntityUrlFormItem[]>([]);

  // taxon links — deferred add/remove buffered until save via the
  // editor's imperative handle, same pattern as AlbumTaxonsEditor.
  let taxonsHandle: VideoTaxonsEditorHandle | undefined;
  const [taxonsDirty, setTaxonsDirty] = createSignal(false);

  // renditions list state
  const [renditions, setRenditions] = createSignal<VideoRendition[]>([]);
  const [renditionsLoading, setRenditionsLoading] = createSignal(false);
  const [deletingRendition, setDeletingRendition] = createSignal<string | null>(null);

  // images — fetched/mutated immediately (not deferred to save), mirrors
  // AlbumEditorModal.tsx's image handling
  const [images, setImages] = createSignal<ImageMetadata[]>([]);
  const [imageProcessing, setImageProcessing] = createSignal<string | null>(null);

  // seasons for the selected series
  const [availableSeasons, setAvailableSeasons] = createSignal<
    Array<{ id: string; title: string; season_number: number }>
  >([]);

  // fetch renditions when modal opens
  createEffect(() => {
    const video = videoQuery.data;
    if (video && loadedVideoId() !== props.videoId && video.media_blob_id) {
      fetchRenditions(video.media_blob_id);
    }
  });

  const fetchRenditions = async (mediaBlobId: string) => {
    setRenditionsLoading(true);
    try {
      const remote = getCurrentRemote();
      if (!remote) {
        setRenditions([]);
        return;
      }
      const client = await getClientForRemote(remote);
      const result = await client.video.getVideoRenditions({ media_blob_id: mediaBlobId });
      if (result.success) {
        setRenditions(result.data);
      } else {
        setRenditions([]);
      }
    } catch (err) {
      console.error("failed to fetch renditions:", err);
      setRenditions([]);
    } finally {
      setRenditionsLoading(false);
    }
  };

  const handleDeleteRendition = async (blobId: string, label: string) => {
    const confirmed = await confirm({
      title: "delete rendition",
      message: `are you sure you want to permanently delete the "${label}" rendition? this cannot be undone.`,
      confirmText: "delete",
      variant: "danger",
    });

    if (!confirmed) return;

    setDeletingRendition(blobId);
    try {
      const remote = getCurrentRemote();
      if (!remote) {
        toast.error("no remote available");
        return;
      }
      const client = await getClientForRemote(remote);
      const result = await client.video.deleteVideoRendition({ blob_id: blobId });
      if (result.success) {
        toast.success("rendition deleted");
        // refresh the list
        const video = videoQuery.data;
        if (video?.media_blob_id) {
          await fetchRenditions(video.media_blob_id);
        }
      } else {
        toast.error("failed to delete rendition");
      }
    } catch (err) {
      console.error("failed to delete rendition:", err);
      toast.error("failed to delete rendition");
    } finally {
      setDeletingRendition(null);
    }
  };

  const fetchImages = async (videoId: string) => {
    const dataSource = getVideoDataSource();
    if (!dataSource.getEntityImages) {
      setImages([]);
      return;
    }
    try {
      const imgs = await dataSource.getEntityImages({ entityType: "video", entityId: videoId });
      setImages(imgs);
    } catch (err) {
      console.error("failed to fetch video images:", err);
      setImages([]);
    }
  };

  const fetchEntityUrls = async (videoId: string) => {
    try {
      const remote = getCurrentRemote();
      if (!remote) {
        setEntityUrls([]);
        setInitialEntityUrls([]);
        return;
      }
      const client = await getClientForRemote(remote);
      const result = await client.entities.getEntityUrls({
        entity_type: "video",
        entity_id: videoId,
      });
      const urls = result.success
        ? result.data.map((u) => ({ id: u.id ?? undefined, name: u.name ?? "", url: u.url }))
        : [];
      setEntityUrls(urls);
      setInitialEntityUrls(urls.map((u) => ({ ...u })));
    } catch (err) {
      console.error("failed to fetch entity urls:", err);
      setEntityUrls([]);
      setInitialEntityUrls([]);
    }
  };

  // fetch seasons when series changes
  createEffect(async () => {
    const seriesId = formData().series_id;
    if (!seriesId) {
      setAvailableSeasons([]);
      return;
    }

    try {
      const remote = getCurrentRemote();
      if (!remote) return;
      const client = await getClientForRemote(remote);
      const result = await client.video.listVideoSeasons({ series_id: seriesId });
      if (result.success) {
        setAvailableSeasons(
          result.data.map((s) => ({
            id: s.id,
            title: s.title ?? "",
            season_number: s.season_number,
          }))
        );
      } else {
        setAvailableSeasons([]);
      }
    } catch (err) {
      console.error("failed to fetch seasons:", err);
      setAvailableSeasons([]);
    }
  });

  createEffect(() => {
    const video = videoQuery.data;
    if (video && loadedVideoId() !== props.videoId) {
      const data: FormData = {
        title: video.title,
        description: video.description ?? "",
        episode_number: video.episode_number ?? null,
        release_date: video.release_date ?? "",
        series_id: video.series_id ?? null,
        season_id: video.season_id ?? null,
      };
      setFormData(data);
      setInitialData(data);
      setPendingNewSeriesName(null);
      setLoadedVideoId(props.videoId);
      void fetchEntityUrls(props.videoId);
      void fetchSeriesTitle(video.series_id ?? null);
      void fetchImages(props.videoId);
    }
  });

  const fetchSeriesTitle = async (seriesId: string | null) => {
    if (!seriesId) {
      setSeriesInputValue("");
      return;
    }
    try {
      const remote = getCurrentRemote();
      if (!remote) {
        setSeriesInputValue("");
        return;
      }
      const client = await getClientForRemote(remote);
      const result = await client.video.getVideoSeries({ id: seriesId });
      setSeriesInputValue(result.success ? result.data.title : "");
    } catch (err) {
      console.error("failed to fetch series title:", err);
      setSeriesInputValue("");
    }
  };

  // helper to check if entity urls have changed (mirrors
  // SongEditorModal.tsx's urlsChanged shape)
  const urlsChanged = () => {
    const current = entityUrls();
    const initial = initialEntityUrls();

    const hasNewUrls = current.some((u) => u.isNew && !u.isDeleted);
    const hasDeletedUrls = current.some((u) => u.isDeleted && !u.isNew);
    if (hasNewUrls || hasDeletedUrls) return true;

    for (let i = 0; i < current.length; i++) {
      const curr = current[i];
      const init = initial[i];
      if (!init) return true;
      if (curr.name !== init.name || curr.url !== init.url) return true;
    }

    return current.length !== initial.length;
  };

  // there's no bulk "replace urls" route for videos (unlike songs/
  // albums, whose update requests accept an `entity_urls` field), so
  // changes are synced via the generic add/remove entity-url routes:
  // deleted urls are removed, new urls are added, and edited existing
  // urls are removed then re-added (the add route always assigns a
  // fresh id).
  const syncEntityUrls = async () => {
    const remote = getCurrentRemote();
    if (!remote) return;
    const client = await getClientForRemote(remote);
    const initialById = new Map(
      initialEntityUrls()
        .filter((u) => u.id)
        .map((u) => [u.id!, u])
    );

    for (const u of entityUrls()) {
      if (u.isNew && u.isDeleted) continue;
      if (u.isDeleted) {
        if (u.id) {
          await client.entities.removeEntityUrl({
            entity_type: "video",
            entity_id: props.videoId,
            id: u.id,
          });
        }
        continue;
      }
      if (u.isNew) {
        await client.entities.addEntityUrl({
          entity_type: "video",
          entity_id: props.videoId,
          name: u.name || null,
          url: u.url,
        });
        continue;
      }
      const init = u.id ? initialById.get(u.id) : undefined;
      if (init && (init.name !== u.name || init.url !== u.url)) {
        await client.entities.removeEntityUrl({
          entity_type: "video",
          entity_id: props.videoId,
          id: u.id!,
        });
        await client.entities.addEntityUrl({
          entity_type: "video",
          entity_id: props.videoId,
          name: u.name || null,
          url: u.url,
        });
      }
    }
  };

  const hasChanges = createMemo(() => {
    const initial = initialData();
    if (!initial) return false;
    const current = formData();
    return (
      current.title !== initial.title ||
      current.description !== initial.description ||
      current.episode_number !== initial.episode_number ||
      current.release_date !== initial.release_date ||
      current.series_id !== initial.series_id ||
      current.season_id !== initial.season_id ||
      pendingNewSeriesName() !== null ||
      urlsChanged() ||
      taxonsDirty()
    );
  });

  const handleFieldChange = <K extends keyof FormData>(field: K, value: FormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // shared image upload logic for both File and file path (mirrors
  // AlbumEditorModal.tsx's handleImageUpload)
  const handleImageUpload = async (params: { file?: File; filePath?: string }) => {
    try {
      const dataSource = getVideoDataSource();
      if (!dataSource.uploadImage) {
        toast.error("image upload not supported");
        return;
      }

      setImageProcessing("uploading image...");

      const { job_id } = await dataSource.uploadImage({
        ...params,
        entityType: "video",
        entityId: props.videoId,
        isPrimary: images().length === 0,
      });

      const remote = getCurrentRemote();
      if (remote && job_id) {
        setImageProcessing("processing image...");
        const pollResult = await pollJobUntilComplete(remote, job_id, 60_000, {
          onStage: (_stage, message) => setImageProcessing(message ?? "processing image..."),
        });
        if (pollResult === "failed") {
          toast.error("image processing failed");
          setImageProcessing(null);
          return;
        }
        if (pollResult === "timeout") {
          toast.info("image processing taking a long time — check back later", {
            title: "processing queued",
          });
          setImageProcessing(null);
          return;
        }
      }

      setImageProcessing(null);
      await fetchImages(props.videoId);
    } catch (err) {
      console.error("failed to upload image:", err);
      toast.error("failed to upload image");
      setImageProcessing(null);
    }
  };

  const handleImageSelectPath = async (filePath: string) => {
    await handleImageUpload({ filePath });
  };

  const handleTogglePrimary = async (index: number) => {
    const image = images()[index];
    const blobId = image.remote_blob_id || image.local_blob_id;
    if (!blobId) {
      toast.error("no blob id found for this image");
      return;
    }

    try {
      const dataSource = getVideoDataSource();
      await dataSource.setPrimaryImage?.({ entityType: "video", entityId: props.videoId, blobId });
      await fetchImages(props.videoId);
    } catch (err) {
      console.error("failed to update primary image:", err);
      toast.error("failed to update primary image");
    }
  };

  const handleRemoveImage = async (index: number) => {
    const image = images()[index];
    const blobId = image.remote_blob_id || image.local_blob_id;
    if (!blobId) {
      toast.error("cannot delete image: missing blob id");
      return;
    }

    try {
      const dataSource = getVideoDataSource();
      if (!dataSource.removeImage) {
        toast.error("image removal not supported");
        return;
      }
      await dataSource.removeImage({ entityType: "video", entityId: props.videoId, blobId });
      await fetchImages(props.videoId);
    } catch (err) {
      console.error("failed to remove image:", err);
      toast.error("failed to remove image");
    }
  };

  const handleSeriesSelect = (selection: { id?: string; name: string; isNew: boolean }) => {
    setSeriesInputValue(selection.name);
    if (selection.isNew) {
      setPendingNewSeriesName(selection.name);
      setFormData((prev) => ({ ...prev, series_id: null, season_id: null }));
    } else {
      setPendingNewSeriesName(null);
      setFormData((prev) => ({ ...prev, series_id: selection.id ?? null, season_id: null }));
    }
  };

  const handleClearSeries = () => {
    setSeriesInputValue("");
    setPendingNewSeriesName(null);
    setFormData((prev) => ({ ...prev, series_id: null, season_id: null }));
  };

  const handleSeasonChange = (value: string) => {
    setFormData((prev) => ({ ...prev, season_id: value === "" ? null : value }));
  };

  const handleSave = async () => {
    const data = formData();
    try {
      let seriesId = data.series_id;
      const newSeriesName = pendingNewSeriesName();
      if (newSeriesName) {
        const newSeries = await createSeriesMutation.mutateAsync({ title: newSeriesName });
        seriesId = newSeries.id;
      }

      await updateMutation.mutateAsync({
        video_id: props.videoId,
        title: data.title,
        description: data.description || null,
        episode_number: data.episode_number,
        release_date: data.release_date || null,
        series_id: seriesId,
        season_id: data.season_id,
      });

      if (urlsChanged()) {
        await syncEntityUrls();
      }

      if (taxonsHandle?.isDirty()) {
        try {
          await taxonsHandle.apply();
        } catch (err) {
          console.error("failed to apply taxon edits:", err);
          toast.error("failed to save taxon changes");
        }
      }

      setPendingNewSeriesName(null);
      toast.success("video updated");
      props.onSave?.();
    } catch (err) {
      console.error("failed to update video:", err);
      toast.error(err instanceof Error ? err.message : "failed to update video");
    }
  };

  return (
    <Modal isOpen={true} onClose={props.onClose} title="edit video" size="lg" disableBackdropClose>
      <Show
        when={initialData()}
        fallback={
          <div class="flex items-center justify-center py-8 text-[var(--color-text-secondary)]">
            loading...
          </div>
        }
      >
        <div
          class="flex flex-col gap-6 p-4 overflow-y-auto"
          style={{ "max-height": "calc(80vh - 120px)" }}
        >
          {/* basic metadata */}
          <div class="space-y-4">
            <div>
              <label class="block text-sm text-[var(--color-text-secondary)] mb-1">title *</label>
              <TextInput
                value={formData().title}
                oninput={(e) => handleFieldChange("title", e.currentTarget.value)}
                placeholder="video title"
              />
            </div>

            <div>
              <label class="block text-sm text-[var(--color-text-secondary)] mb-1">
                description
              </label>
              <textarea
                value={formData().description}
                oninput={(e) => handleFieldChange("description", e.currentTarget.value)}
                placeholder="video description..."
                rows={4}
                class="w-full px-3 py-2 bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-500)] resize-none"
              />
            </div>

            <div class="flex gap-2">
              <div class="flex-1">
                <label class="block text-sm text-[var(--color-text-secondary)] mb-1">
                  episode number
                </label>
                <input
                  type="number"
                  value={formData().episode_number ?? ""}
                  oninput={(e) =>
                    handleFieldChange(
                      "episode_number",
                      e.currentTarget.value === "" ? null : parseInt(e.currentTarget.value, 10)
                    )
                  }
                  min="1"
                  placeholder="—"
                  class="w-full px-2 py-2 bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-500)]"
                />
              </div>
              <div class="flex-1">
                <label class="block text-sm text-[var(--color-text-secondary)] mb-1">
                  release date
                </label>
                <input
                  type="date"
                  value={formData().release_date}
                  oninput={(e) => handleFieldChange("release_date", e.currentTarget.value)}
                  class="w-full px-2 py-2 bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-500)]"
                />
              </div>
            </div>
          </div>

          {/* images */}
          <div class="border-t border-[var(--color-border-default)] pt-4">
            <EntityImages
              images={images()}
              onUpload={(file) => handleImageUpload({ file })}
              onUploadPath={handleImageSelectPath}
              onSetPrimary={handleTogglePrimary}
              onDelete={handleRemoveImage}
              uploading={imageProcessing() !== null}
              disabled={!canUpdateVideo()}
            />
            <Show when={imageProcessing()}>
              <p class="text-xs text-[var(--color-text-tertiary)] mt-1">{imageProcessing()}</p>
            </Show>
          </div>

          {/* series and season assignment */}
          <div class="space-y-4 border-t border-[var(--color-border-default)] pt-4">
            <h3 class="text-sm font-medium text-[var(--color-text-primary)]">series & season</h3>

            <div>
              <VideoSeriesAutocomplete
                label="series"
                value={seriesInputValue()}
                onSelect={handleSeriesSelect}
                placeholder="search or type series title..."
                hint={
                  pendingNewSeriesName()
                    ? `"${pendingNewSeriesName()}" will be created as a new series on save`
                    : undefined
                }
              />
              <Show when={seriesInputValue() || pendingNewSeriesName()}>
                <button
                  type="button"
                  onClick={handleClearSeries}
                  class="mt-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                >
                  remove from series
                </button>
              </Show>
            </div>

            <Show when={formData().series_id}>
              <div>
                <Select
                  label="season"
                  value={formData().season_id ?? ""}
                  onchange={(e) => handleSeasonChange(e.currentTarget.value)}
                  options={[
                    { value: "", label: "(none)" },
                    ...availableSeasons().map((s) => ({
                      value: s.id,
                      label: `season ${s.season_number}${s.title ? ` - ${s.title}` : ""}`,
                    })),
                  ]}
                  placeholder="select a season..."
                  disabled={availableSeasons().length === 0}
                />
              </div>
            </Show>
          </div>

          {/* taxon links — deferred add/remove buffered until save
              flushes them via taxonsHandle.apply() */}
          <div class="border-t border-[var(--color-border-default)] pt-4">
            <VideoTaxonsEditor
              videoId={props.videoId}
              ref={(h) => (taxonsHandle = h)}
              onDirtyChange={setTaxonsDirty}
              disabled={!canUpdateVideo()}
              excludeKinds={["genre", "mood", "style", "era", "label"]}
            />
          </div>

          {/* entity url links */}
          <div class="border-t border-[var(--color-border-default)] pt-4">
            <EntityUrlz urls={entityUrls()} onChange={setEntityUrls} disabled={!canUpdateVideo()} />
          </div>

          {/* metadata section */}
          <div class="space-y-3 border-t border-[var(--color-border-default)] pt-4">
            <h3 class="text-sm font-medium text-[var(--color-text-primary)]">metadata</h3>

            <Show when={videoMetadataQuery.data}>
              {(metadata) => (
                <div class="space-y-1 text-sm">
                  {/* created / updated info */}
                  <Show when={metadata().video.created_at}>
                    <div>
                      <span class="text-[var(--color-text-tertiary)]">created: </span>
                      <span class="text-[var(--color-text-secondary)]">
                        {formatDateTime(metadata().video.created_at * 1000)}
                      </span>
                      <Show when={metadata().created_by_username}>
                        <span class="text-[var(--color-text-tertiary)]"> by </span>
                        <span class="text-[var(--color-text-secondary)]">
                          {metadata().created_by_username}
                        </span>
                      </Show>
                    </div>
                  </Show>

                  <Show
                    when={
                      metadata().video.updated_at &&
                      metadata().video.updated_at !== metadata().video.created_at
                        ? metadata().video.updated_at
                        : undefined
                    }
                    keyed
                  >
                    {(updatedAt) => (
                      <div>
                        <span class="text-[var(--color-text-tertiary)]">updated: </span>
                        <span class="text-[var(--color-text-secondary)]">
                          {formatDateTime(updatedAt * 1000)}
                        </span>
                        <Show when={metadata().updated_by_username}>
                          <span class="text-[var(--color-text-tertiary)]"> by </span>
                          <span class="text-[var(--color-text-secondary)]">
                            {metadata().updated_by_username}
                          </span>
                        </Show>
                      </div>
                    )}
                  </Show>

                  {/* file metadata */}
                  <Show when={metadata().blob_width && metadata().blob_height}>
                    <div>
                      <span class="text-[var(--color-text-tertiary)]">resolution: </span>
                      <span class="text-[var(--color-text-secondary)]">
                        {metadata().blob_width} × {metadata().blob_height}
                      </span>
                    </div>
                  </Show>

                  <Show when={metadata().blob_size}>
                    <div>
                      <span class="text-[var(--color-text-tertiary)]">file size: </span>
                      <span class="text-[var(--color-text-secondary)]">
                        {formatFileSize(metadata().blob_size)}
                      </span>
                    </div>
                  </Show>

                  <Show when={metadata().codec}>
                    <div>
                      <span class="text-[var(--color-text-tertiary)]">codec: </span>
                      <span class="text-[var(--color-text-secondary)]">{metadata().codec}</span>
                    </div>
                  </Show>

                  <Show when={metadata().container}>
                    <div>
                      <span class="text-[var(--color-text-tertiary)]">container: </span>
                      <span class="text-[var(--color-text-secondary)]">{metadata().container}</span>
                    </div>
                  </Show>

                  <Show when={metadata().bitrate}>
                    <div>
                      <span class="text-[var(--color-text-tertiary)]">bitrate: </span>
                      <span class="text-[var(--color-text-secondary)]">
                        {(metadata().bitrate! / 1000).toFixed(0)} kbps
                      </span>
                    </div>
                  </Show>

                  <Show when={metadata().frame_rate}>
                    <div>
                      <span class="text-[var(--color-text-tertiary)]">frame rate: </span>
                      <span class="text-[var(--color-text-secondary)]">
                        {metadata().frame_rate!.toFixed(2)} fps
                      </span>
                    </div>
                  </Show>
                </div>
              )}
            </Show>

            <Show when={videoMetadataQuery.isLoading}>
              <div class="text-xs text-[var(--color-text-tertiary)]">loading metadata...</div>
            </Show>
          </div>

          {/* renditions list */}
          <div class="space-y-4 border-t border-[var(--color-border-default)] pt-4">
            <h3 class="text-sm font-medium text-[var(--color-text-primary)]">renditions</h3>

            <Show when={renditionsLoading()}>
              <div class="text-xs text-[var(--color-text-secondary)]">loading renditions...</div>
            </Show>

            <Show when={!renditionsLoading() && renditions().length === 0}>
              <div class="text-xs text-[var(--color-text-tertiary)]">
                no transcoded renditions yet
              </div>
            </Show>

            <Show when={!renditionsLoading() && renditions().length > 0}>
              <div class="space-y-2">
                <For each={renditions()}>
                  {(rendition) => (
                    <div class="flex items-center justify-between gap-2 p-2 bg-[var(--color-bg-elevated)] rounded">
                      <div class="flex-1 min-w-0">
                        <div class="text-sm text-[var(--color-text-primary)] font-medium">
                          {rendition.label}
                        </div>
                        <div class="text-xs text-[var(--color-text-tertiary)]">
                          {rendition.extension} {rendition.mime ? `· ${rendition.mime}` : ""}
                        </div>
                      </div>
                      <button
                        onClick={() =>
                          void handleDeleteRendition(rendition.blob_id, rendition.label)
                        }
                        disabled={deletingRendition() === rendition.blob_id}
                        class="flex items-center gap-1 px-2 py-1 text-xs text-[var(--color-error)] hover:bg-[var(--color-error)]/10 rounded disabled:opacity-50"
                        title="permanently delete this rendition"
                      >
                        <Icon name={IconNames.delete} size={14} />
                        {deletingRendition() === rendition.blob_id ? "deleting..." : "delete"}
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </Show>

      <div class="flex items-center justify-end gap-2 p-4 border-t border-[var(--color-border-default)] flex-shrink-0">
        <Button onClick={props.onClose} variant="ghost">
          cancel
        </Button>
        <Show when={canUpdateVideo()}>
          <Button
            onClick={() => void handleSave()}
            variant="primary"
            disabled={!hasChanges() || updateMutation.isPending}
          >
            {updateMutation.isPending ? "saving..." : "save"}
          </Button>
        </Show>
      </div>
    </Modal>
  );
}

export default EditVideoModal;
