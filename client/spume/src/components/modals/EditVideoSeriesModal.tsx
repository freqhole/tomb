// edit video series modal — title/description plus multi-image support
// (entity_imagez-backed, mirrors AlbumEditorModal.tsx's image handling).
// no legacy single-poster upload control: poster_blob_id now just mirrors
// whichever image is primary, kept in sync server-side.
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { Button } from "../buttons/Button";
import { TextInput } from "../forms/TextInput";
import { EntityImages } from "../layout/EntityImages";
import { toast } from "../feedback/Toast";
import { canUpdateVideo } from "../../video/data/permissions";
import { getVideoDataSource } from "../../video/data";
import { getCurrentRemote } from "../../music/data";
import { pollJobUntilComplete } from "../../app/services/jobs/jobService";
import type { ImageMetadata } from "../../music/services/storage/types";
import { queryClient } from "../../queryClient";
import { videoQueryKeys } from "../../video/queries/queryKeys";
import type { VideoSeason } from "../../video/data/types";
import {
  useVideoSeriesDetailQuery,
  useUpdateVideoSeriesMutation,
  useVideoSeasonsQuery,
  useUpdateVideoSeasonMutation,
} from "../../video/queries/series";
import { Modal } from "./Modal";

// broad invalidation so any other view (series grid tiles, series detail
// header, episode rows, etc.) picks up a changed poster/gallery image or
// metadata — mirrors EditVideoModal.tsx's invalidateVideoQueries.
function invalidateVideoQueries(): void {
  void queryClient.invalidateQueries({ queryKey: videoQueryKeys.series.all() });
  void queryClient.invalidateQueries({ queryKey: videoQueryKeys.videos.all() });
}

export interface EditVideoSeriesModalProps {
  seriesId: string;
  onClose: () => void;
  onSave?: () => void;
}

interface FormData {
  title: string;
  description: string;
}

export function EditVideoSeriesModal(props: EditVideoSeriesModalProps) {
  const detailQuery = useVideoSeriesDetailQuery(() => props.seriesId);
  const updateMutation = useUpdateVideoSeriesMutation();
  const seasonsQuery = useVideoSeasonsQuery(() => props.seriesId);
  const updateSeasonMutation = useUpdateVideoSeasonMutation();

  const [formData, setFormData] = createSignal<FormData>({ title: "", description: "" });
  const [initialData, setInitialData] = createSignal<FormData | null>(null);
  const [loadedSeriesId, setLoadedSeriesId] = createSignal<string | null>(null);

  // per-season rename state - keyed by season id so multiple rows can be
  // in flight/erroring independently (a shared mutation's isPending/error
  // would only ever reflect the single most recent call).
  const [seasonDrafts, setSeasonDrafts] = createSignal<Record<string, string>>({});
  const [seasonSaving, setSeasonSaving] = createSignal<Record<string, boolean>>({});
  const [seasonErrors, setSeasonErrors] = createSignal<Record<string, string>>({});

  const seasonTitleDraft = (season: VideoSeason) => seasonDrafts()[season.id] ?? season.title ?? "";

  const seasonHasChange = (season: VideoSeason) =>
    seasonTitleDraft(season).trim() !== (season.title ?? "");

  const handleSeasonTitleInput = (seasonId: string, value: string) => {
    setSeasonDrafts((prev) => ({ ...prev, [seasonId]: value }));
    setSeasonErrors((prev) => {
      if (!(seasonId in prev)) return prev;
      const { [seasonId]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const anySeasonSaving = createMemo(() => Object.values(seasonSaving()).some(Boolean));

  // images — fetched/mutated immediately (not deferred to save), mirrors
  // AlbumEditorModal.tsx's image handling
  const [images, setImages] = createSignal<ImageMetadata[]>([]);
  const [imageProcessing, setImageProcessing] = createSignal<string | null>(null);

  const fetchImages = async (seriesId: string) => {
    const dataSource = getVideoDataSource();
    if (!dataSource.getEntityImages) {
      setImages([]);
      return;
    }
    try {
      const imgs = await dataSource.getEntityImages({
        entityType: "video_series",
        entityId: seriesId,
      });
      setImages(imgs);
    } catch (err) {
      console.error("failed to fetch series images:", err);
      setImages([]);
    }
  };

  createEffect(() => {
    const series = detailQuery.data?.series;
    if (series && loadedSeriesId() !== props.seriesId) {
      const data: FormData = {
        title: series.title,
        description: series.description ?? "",
      };
      setFormData(data);
      setInitialData(data);
      setLoadedSeriesId(props.seriesId);
      void fetchImages(props.seriesId);
    }
  });

  const hasChanges = createMemo(() => {
    const initial = initialData();
    const seriesChanged =
      !!initial &&
      (formData().title !== initial.title || formData().description !== initial.description);
    const seasonsChanged = (seasonsQuery.data ?? []).some((season) => seasonHasChange(season));
    return seriesChanged || seasonsChanged;
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
        entityType: "video_series",
        entityId: props.seriesId,
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
      await fetchImages(props.seriesId);
      invalidateVideoQueries();
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
      await dataSource.setPrimaryImage?.({
        entityType: "video_series",
        entityId: props.seriesId,
        blobId,
      });
      await fetchImages(props.seriesId);
      invalidateVideoQueries();
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
      await dataSource.removeImage({
        entityType: "video_series",
        entityId: props.seriesId,
        blobId,
      });
      await fetchImages(props.seriesId);
      invalidateVideoQueries();
    } catch (err) {
      console.error("failed to remove image:", err);
      toast.error("failed to remove image");
    }
  };

  const handleSave = async () => {
    const data = formData();
    let ok = true;

    try {
      await updateMutation.mutateAsync({
        series_id: props.seriesId,
        title: data.title,
        description: data.description || null,
      });
    } catch (err) {
      console.error("failed to update video series:", err);
      toast.error("failed to update series");
      ok = false;
    }

    const changedSeasons = (seasonsQuery.data ?? []).filter((season) => seasonHasChange(season));
    for (const season of changedSeasons) {
      const title = seasonTitleDraft(season).trim();
      setSeasonSaving((prev) => ({ ...prev, [season.id]: true }));
      try {
        await updateSeasonMutation.mutateAsync({
          season_id: season.id,
          series_id: props.seriesId,
          title: title || null,
        });
      } catch (err) {
        console.error("failed to rename season:", err);
        setSeasonErrors((prev) => ({ ...prev, [season.id]: "failed to save" }));
        ok = false;
      } finally {
        setSeasonSaving((prev) => ({ ...prev, [season.id]: false }));
      }
    }

    if (!ok) return;
    toast.success("series updated");
    props.onSave?.();
  };

  // invalidate on close regardless of whether save was clicked — image
  // mutations above apply immediately (not deferred to save).
  const handleClose = () => {
    invalidateVideoQueries();
    props.onClose();
  };

  return (
    <Modal isOpen={true} onClose={handleClose} title="edit series" size="lg" disableBackdropClose>
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
          <div>
            <label class="block text-sm text-[var(--color-text-secondary)] mb-1">title *</label>
            <TextInput
              value={formData().title}
              oninput={(e) => handleFieldChange("title", e.currentTarget.value)}
              placeholder="series title"
            />
          </div>

          <div>
            <label class="block text-sm text-[var(--color-text-secondary)] mb-1">description</label>
            <textarea
              value={formData().description}
              oninput={(e) => handleFieldChange("description", e.currentTarget.value)}
              placeholder="series description..."
              rows={4}
              class="w-full px-3 py-2 bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-500)] resize-none"
            />
          </div>

          {/* seasons — rename only; season_number/create/delete aren't
              editable here (mirrors update_video_season's admin-only,
              rename-focused server route). drafts are batched into the
              main save button below (not saved per-row on blur), so a
              season edit can't be silently lost by clicking save/cancel
              before the field loses focus. */}
          <Show when={seasonsQuery.data && seasonsQuery.data.length > 0}>
            <div class="border-t border-[var(--color-border-default)] pt-4">
              <label class="block text-sm text-[var(--color-text-secondary)] mb-2">
                season titles (optional)
              </label>
              <div class="flex flex-col gap-3">
                <For each={seasonsQuery.data}>
                  {(season) => (
                    <TextInput
                      label={`season ${season.season_number}`}
                      value={seasonTitleDraft(season)}
                      oninput={(e) => handleSeasonTitleInput(season.id, e.currentTarget.value)}
                      placeholder={`e.g. "the ${season.season_number === 1 ? "pilot" : "reunion"} special" — leave blank for none`}
                      disabled={!canUpdateVideo() || seasonSaving()[season.id]}
                      error={seasonErrors()[season.id]}
                    />
                  )}
                </For>
              </div>
            </div>
          </Show>

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
        </div>
      </Show>

      <div class="flex items-center justify-end gap-2 p-4 border-t border-[var(--color-border-default)] flex-shrink-0">
        <Button onClick={handleClose} variant="ghost">
          cancel
        </Button>
        <Show when={canUpdateVideo()}>
          <Button
            onClick={() => void handleSave()}
            variant="primary"
            disabled={!hasChanges() || updateMutation.isPending || anySeasonSaving()}
          >
            {updateMutation.isPending || anySeasonSaving() ? "saving..." : "save"}
          </Button>
        </Show>
      </div>
    </Modal>
  );
}
