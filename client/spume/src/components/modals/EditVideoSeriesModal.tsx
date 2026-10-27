// edit video series modal — title/description plus multi-image support
// (entity_imagez-backed, mirrors AlbumEditorModal.tsx's image handling).
// no legacy single-poster upload control: poster_blob_id now just mirrors
// whichever image is primary, kept in sync server-side.
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { Button } from "../buttons/Button";
import { TextInput } from "../forms/TextInput";
import {
  VideoSeasonAutocomplete,
  formatSeasonLabel,
  type VideoSeasonSelection,
} from "../forms/VideoSeasonAutocomplete";
import { EntityImages } from "../layout/EntityImages";
import { toast } from "../feedback/Toast";
import { confirm } from "../../app/services/confirmState";
import { canUpdateVideo, canDeleteVideoSeries } from "../../video/data/permissions";
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
  useMergeVideoSeasonMutation,
} from "../../video/queries/series";
import { Modal } from "./Modal";
import { BulkVideoTaxonsEditor } from "../taxonomy/BulkVideoTaxonsEditor";

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
  /** called after a successful delete so callers (e.g. series detail view) can navigate away */
  onDeleted?: () => void;
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
  const mergeSeasonMutation = useMergeVideoSeasonMutation();

  const [formData, setFormData] = createSignal<FormData>({ title: "", description: "" });
  const [initialData, setInitialData] = createSignal<FormData | null>(null);
  const [loadedSeriesId, setLoadedSeriesId] = createSignal<string | null>(null);

  // per-season edit state - keyed by season id so multiple rows can be
  // in flight/erroring independently (a shared mutation's isPending/error
  // would only ever reflect the single most recent call). a selection is
  // only recorded once the user actually picks a dropdown entry (existing
  // or "create new") or presses enter - see `VideoSeasonAutocomplete`'s
  // own doc comment; just typing and clicking away leaves no selection
  // and so no pending change for that row.
  const [seasonInputValues, setSeasonInputValues] = createSignal<Record<string, string>>({});
  const [seasonSelections, setSeasonSelections] = createSignal<
    Record<string, VideoSeasonSelection>
  >({});
  const [seasonSaving, setSeasonSaving] = createSignal<Record<string, boolean>>({});
  const [seasonErrors, setSeasonErrors] = createSignal<Record<string, string>>({});

  const seasonInputValue = (season: VideoSeason) =>
    seasonInputValues()[season.id] ?? formatSeasonLabel(season.season_number, season.title);

  const seasonHasChange = (season: VideoSeason) => season.id in seasonSelections();

  // true when the pending selection for this season picked a DIFFERENT,
  // already-existing season - i.e. "merge this season's videos into that
  // one" rather than "rename this season's own title".
  const seasonIsMerge = (season: VideoSeason) => {
    const selection = seasonSelections()[season.id];
    return !!selection && !selection.isNew && selection.id !== season.id;
  };

  const handleSeasonSelect = (season: VideoSeason, selection: VideoSeasonSelection) => {
    setSeasonInputValues((prev) => ({
      ...prev,
      [season.id]: formatSeasonLabel(selection.season_number, selection.title),
    }));
    setSeasonSelections((prev) => ({ ...prev, [season.id]: selection }));
    setSeasonErrors((prev) => {
      if (!(season.id in prev)) return prev;
      const { [season.id]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const anySeasonSaving = createMemo(() => Object.values(seasonSaving()).some(Boolean));

  // video ids belonging to one season, for the shared-taxon editor below
  // each row - `seasonsQuery` (plain season rows, used for the title/
  // merge editing above) doesn't carry videos; `detailQuery` does.
  const seasonVideoIds = (seasonId: string): string[] =>
    (detailQuery.data?.seasons.find((s) => s.id === seasonId)?.videos ?? []).map((v) => v.id);

  const unassignedVideoIds = createMemo(() =>
    (detailQuery.data?.unassignedVideos ?? []).map((v) => v.id)
  );

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
      const selection = seasonSelections()[season.id];
      setSeasonSaving((prev) => ({ ...prev, [season.id]: true }));
      try {
        if (seasonIsMerge(season)) {
          // picked a DIFFERENT, already-existing season - merge this
          // season's videos into it rather than renaming this one.
          await mergeSeasonMutation.mutateAsync({
            source_season_id: season.id,
            target_season_id: selection.id!,
            series_id: props.seriesId,
          });
        } else {
          // free-text rename (or re-picking a brand new, not-yet-
          // existing label) - season_number isn't editable here, only
          // the title (mirrors `update_video_season`'s admin-only,
          // rename-focused route).
          await updateSeasonMutation.mutateAsync({
            season_id: season.id,
            series_id: props.seriesId,
            title: selection.title?.trim() || null,
          });
        }
      } catch (err) {
        console.error("failed to save season:", err);
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

  const handleDelete = async () => {
    const detail = detailQuery.data;
    const series = detail?.series;
    if (!series) return;

    const seasonCount = detail.seasons.length;
    const videoCount =
      detail.seasons.reduce((sum, season) => sum + season.videos.length, 0) +
      detail.unassignedVideos.length;
    const seasonLabel = seasonCount === 1 ? "season" : "seasons";
    const videoLabel = videoCount === 1 ? "video" : "videos";
    const impactMessage =
      seasonCount > 0
        ? `this will also delete ${seasonCount} ${seasonLabel} and ${videoCount} ${videoLabel}.`
        : `this will also delete ${videoCount} ${videoLabel}.`;

    const confirmed = await confirm({
      title: "delete series",
      message: `are you sure you want to delete "${series.title}"? ${impactMessage} this cannot be undone.`,
      confirmText: "delete",
      variant: "danger",
    });

    if (!confirmed) return;

    try {
      const dataSource = getVideoDataSource();
      if (!dataSource.deleteVideoSeries) {
        toast.error("delete not supported for this data source");
        return;
      }
      await dataSource.deleteVideoSeries(props.seriesId);
      invalidateVideoQueries();
      toast.success("series deleted");
      props.onDeleted?.();
      props.onClose();
    } catch (err) {
      console.error("failed to delete video series:", err);
      toast.error("failed to delete series");
    }
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

          {/* taxons on the series entity itself (entity_type
              "video_series") - shown in the series detail header
              alongside every episode's own taxons. applied immediately,
              like the per-season shared editors below. */}
          <Show when={canUpdateVideo()}>
            <BulkVideoTaxonsEditor
              videoIds={[props.seriesId]}
              entityType="video_series"
              heading="series taxons"
            />
          </Show>

          {/* seasons — rename OR merge into an existing season (picking a
              DIFFERENT, already-existing season here moves every video
              out of this one and into that one instead - see
              `seasonIsMerge`'s doc comment); season_number/create/delete
              still aren't directly editable (mirrors update_video_season's
              admin-only, rename-focused server route). selections are
              batched into the main save button below (not saved per-row
              immediately), so a pending edit can't be silently lost by
              clicking save/cancel before it's confirmed. */}
          <Show when={seasonsQuery.data && seasonsQuery.data.length > 0}>
            <div class="border-t border-[var(--color-border-default)] pt-4">
              <label class="block text-sm text-[var(--color-text-secondary)] mb-2">
                season titles (optional) — pick an existing season to merge into it
              </label>
              <div class="flex flex-col gap-3">
                <For each={seasonsQuery.data}>
                  {(season) => (
                    <div>
                      <VideoSeasonAutocomplete
                        label={`season ${season.season_number}`}
                        seriesId={props.seriesId}
                        excludeSeasonId={season.id}
                        value={seasonInputValue(season)}
                        onSelect={(selection) => handleSeasonSelect(season, selection)}
                        placeholder={`e.g. "the ${season.season_number === 1 ? "pilot" : "reunion"} special" — leave blank for none`}
                        disabled={!canUpdateVideo() || seasonSaving()[season.id]}
                        hint={
                          seasonIsMerge(season)
                            ? `will merge this season's videos into "${seasonInputValue(season)}" and remove this season`
                            : undefined
                        }
                      />
                      <Show when={seasonErrors()[season.id]}>
                        <p class="text-xs text-red-400 mt-1">{seasonErrors()[season.id]}</p>
                      </Show>
                      <Show when={canUpdateVideo() && seasonVideoIds(season.id).length > 0}>
                        <div class="mt-2">
                          <BulkVideoTaxonsEditor
                            videoIds={seasonVideoIds(season.id)}
                            onlyShared
                          />
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          {/* videos attached to the series with no season ("extras", or
              every episode when the series has no seasons at all) - same
              shared-taxon editor as each season row above. */}
          <Show when={canUpdateVideo() && unassignedVideoIds().length > 0}>
            <div class="border-t border-[var(--color-border-default)] pt-4">
              <label class="block text-sm text-[var(--color-text-secondary)] mb-2">
                {(seasonsQuery.data?.length ?? 0) > 0 ? "extras" : "episodes"}
              </label>
              <BulkVideoTaxonsEditor videoIds={unassignedVideoIds()} onlyShared />
            </div>
          </Show>

          {/* images */}
          <div class="border-t border-[var(--color-border-default)] pt-4">
            <EntityImages
              images={images()}
              onUpload={(file) => handleImageUpload({ file })}
              onUploadPath={
                getCurrentRemote()?.is_charnel_managed ? handleImageSelectPath : undefined
              }
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

      <div class="flex items-center justify-between p-4 border-t border-[var(--color-border-default)] flex-shrink-0">
        <Show when={canDeleteVideoSeries()}>
          <Button onClick={() => void handleDelete()} variant="danger">
            delete
          </Button>
        </Show>
        <div class="flex items-center gap-2">
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
      </div>
    </Modal>
  );
}
