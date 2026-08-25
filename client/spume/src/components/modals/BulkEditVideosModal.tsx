// bulk edit modal for one or more videos.
//
// scoped to what's useful in bulk for video: series/season assignment
// (via VideoSeriesAutocomplete, supporting both picking an existing
// series and typing a new series name to create-on-save) and bulk taxon
// editing (immediate fan-out via `BulkVideoTaxonsEditor`, no save step
// of its own).
//
// series/season use the current active remote directly (video has no
// per-remote browsing UI like the music library view does), mirroring
// EditVideoModal.tsx's getCurrentRemote()+getClientForRemote() pattern.
import { createMemo, createResource, createSignal, Show } from "solid-js";
import { Modal } from "./Modal";
import { Button } from "../buttons/Button";
import { VideoSeriesAutocomplete } from "../forms/VideoSeriesAutocomplete";
import {
  VideoSeasonAutocomplete,
  type VideoSeasonSelection,
} from "../forms/VideoSeasonAutocomplete";
import { toast } from "../feedback/Toast";
import { getClientForRemote } from "../../app/api/client";
import { getCurrentRemote } from "../../music/data/currentState";
import { queryClient } from "../../queryClient";
import { getVideoDataSource } from "../../video/data";
import { videoQueryKeys } from "../../video/queries/queryKeys";
import {
  useVideoSeriesListQuery,
  useCreateVideoSeriesMutation,
  useCreateVideoSeasonMutation,
} from "../../video/queries/series";
import { canUpdateVideo } from "../../video/data/permissions";
import type { VideoSummary } from "../../video/data/types";
import { BulkVideoTaxonsEditor } from "../taxonomy/BulkVideoTaxonsEditor";

interface BulkEditVideosModalProps {
  isOpen: boolean;
  videoIds: string[];
  onClose: () => void;
  onSuccess?: () => void;
}

export function BulkEditVideosModal(props: BulkEditVideosModalProps) {
  // load the video rows so we can prefill a common series (if any) and
  // show a count/loading state.
  const [videos] = createResource(
    () => props.videoIds,
    async (ids): Promise<VideoSummary[]> => {
      if (ids.length === 0) return [];
      const dataSource = getVideoDataSource();
      const results = await Promise.all(ids.map((id) => dataSource.getVideoById(id)));
      return results.filter((v): v is VideoSummary => v !== null);
    }
  );

  const seriesListQuery = useVideoSeriesListQuery();
  const createSeriesMutation = useCreateVideoSeriesMutation();
  const createSeasonMutation = useCreateVideoSeasonMutation();

  const seriesOptions = createMemo(() =>
    (seriesListQuery.data?.pages ?? []).flatMap((p) =>
      p.items.map((s) => ({ value: s.id, label: s.title }))
    )
  );

  // common series_id across all loaded videos (null when mixed or unset).
  const commonSeriesId = createMemo<string | null>(() => {
    const list = videos();
    if (!list || list.length === 0) return null;
    const first = list[0]?.series_id ?? null;
    return list.every((v) => (v.series_id ?? null) === first) ? first : null;
  });
  const commonSeriesLabel = createMemo<string | null>(() => {
    const id = commonSeriesId();
    if (!id) return null;
    return seriesOptions().find((o) => o.value === id)?.label ?? null;
  });

  // series autocomplete input text and pending new series name (for
  // create-on-save flow, mirroring EditVideoModal.tsx).
  const [seriesInputValue, setSeriesInputValue] = createSignal("");
  const [pendingNewSeriesName, setPendingNewSeriesName] = createSignal<string | null>(null);
  const [formSeriesId, setFormSeriesId] = createSignal<string | null>(null);

  // same create-on-save pattern for season, mirroring EditVideoModal.tsx.
  // a pending new season is only created once (in handleSave), not once
  // per selected video.
  const [seasonInputValue, setSeasonInputValue] = createSignal("");
  const [pendingNewSeason, setPendingNewSeason] = createSignal<{
    season_number: number;
    title: string | null;
  } | null>(null);
  const [formSeasonId, setFormSeasonId] = createSignal<string | null>(null);
  const [isSaving, setIsSaving] = createSignal(false);

  const isValid = createMemo(
    () => seriesInputValue().trim().length > 0 || pendingNewSeriesName() !== null
  );

  const handleSeriesSelect = (selection: { id?: string; name: string; isNew: boolean }) => {
    setSeriesInputValue(selection.name);
    setSeasonInputValue("");
    setPendingNewSeason(null);
    setFormSeasonId(null);
    if (selection.isNew) {
      setPendingNewSeriesName(selection.name);
      setFormSeriesId(null);
    } else {
      setPendingNewSeriesName(null);
      setFormSeriesId(selection.id ?? null);
    }
  };

  const handleSeasonSelect = (selection: VideoSeasonSelection) => {
    setSeasonInputValue(
      `season ${selection.season_number}${selection.title ? ` - ${selection.title}` : ""}`
    );
    if (selection.isNew) {
      setPendingNewSeason({ season_number: selection.season_number, title: selection.title });
      setFormSeasonId(null);
    } else {
      setPendingNewSeason(null);
      setFormSeasonId(selection.id ?? null);
    }
  };

  const handleClearSeason = () => {
    setSeasonInputValue("");
    setPendingNewSeason(null);
    setFormSeasonId(null);
  };

  const handleSave = async () => {
    if (!isValid()) return;
    const remote = getCurrentRemote();
    if (!remote) {
      toast.error("connect to a remote to bulk-edit videos");
      return;
    }
    setIsSaving(true);
    try {
      // if a new series name was typed, create it first
      let seriesIdToApply = formSeriesId();
      const newSeriesName = pendingNewSeriesName();
      if (newSeriesName) {
        const newSeries = await createSeriesMutation.mutateAsync({ title: newSeriesName });
        seriesIdToApply = newSeries.id;
      }

      // same for a new season - created once here, not once per selected
      // video, then the resolved id is applied to all of them below.
      let seasonIdToApply = formSeasonId();
      const newSeason = pendingNewSeason();
      if (newSeason && seriesIdToApply) {
        const createdSeason = await createSeasonMutation.mutateAsync({
          series_id: seriesIdToApply,
          season_number: newSeason.season_number,
          title: newSeason.title,
        });
        seasonIdToApply = createdSeason.id;
      }

      const client = await getClientForRemote(remote);
      const result = await client.video.updateVideos({
        video_ids: props.videoIds,
        series_id: seriesIdToApply || null,
        season_id: seasonIdToApply || null,
      });
      if (!result.success) {
        toast.error("failed to update videos");
        return;
      }
      if (result.data.videos_failed.length > 0) {
        toast.warning(
          `updated ${result.data.videos_updated}, ${result.data.videos_failed.length} failed`
        );
      } else {
        toast.success(
          `updated ${result.data.videos_updated} video${result.data.videos_updated === 1 ? "" : "s"}`
        );
      }
      void queryClient.invalidateQueries({ queryKey: videoQueryKeys.videos.all() });
      props.onSuccess?.();
      props.onClose();
    } finally {
      setIsSaving(false);
    }
  };

  // invalidate on close regardless of whether save was clicked —
  // BulkVideoTaxonsEditor applies taxon edits immediately (no save step
  // of its own), so a user who only edited taxons and closed still needs
  // other views to pick up the change.
  const handleClose = () => {
    void queryClient.invalidateQueries({ queryKey: videoQueryKeys.videos.all() });
    props.onClose();
  };

  return (
    <Show when={props.isOpen}>
      <Modal isOpen={true} onClose={handleClose} title="edit videos" size="md">
        <div class="p-4 space-y-4">
          <div class="flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
            <span>
              {props.videoIds.length} video{props.videoIds.length === 1 ? "" : "s"} selected
            </span>
            <Show when={videos.loading}>
              <span class="italic text-[var(--color-text-disabled)]">loading…</span>
            </Show>
          </div>

          <div class="space-y-1">
            <VideoSeriesAutocomplete
              label="series"
              value={seriesInputValue()}
              onSelect={handleSeriesSelect}
              placeholder="search or type series title..."
              hint={commonSeriesLabel() ? `(current: ${commonSeriesLabel()})` : undefined}
            />
          </div>

          <Show when={formSeriesId()}>
            <div class="space-y-1">
              <VideoSeasonAutocomplete
                label="season"
                seriesId={formSeriesId() ?? undefined}
                value={seasonInputValue()}
                onSelect={handleSeasonSelect}
                placeholder="search or type season..."
                hint={
                  pendingNewSeason()
                    ? `season ${pendingNewSeason()!.season_number}${
                        pendingNewSeason()!.title ? ` - ${pendingNewSeason()!.title}` : ""
                      } will be created on save`
                    : undefined
                }
              />
              <Show when={seasonInputValue() || pendingNewSeason()}>
                <button
                  type="button"
                  onClick={handleClearSeason}
                  class="mt-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                >
                  remove from season
                </button>
              </Show>
            </div>
          </Show>

          <div class="border-t border-[var(--color-border-subtle)] pt-3">
            <BulkVideoTaxonsEditor
              videoIds={props.videoIds}
              excludeKinds={["genre", "mood", "style", "era", "label"]}
            />
          </div>

          <div class="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border-subtle)]">
            <Button variant="ghost" onClick={handleClose} disabled={isSaving()}>
              close
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleSave()}
              disabled={!isValid() || isSaving() || !canUpdateVideo()}
              loading={isSaving()}
            >
              save
            </Button>
          </div>
        </div>
      </Modal>
    </Show>
  );
}
