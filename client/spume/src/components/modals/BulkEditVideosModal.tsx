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
import { createEffect, createMemo, createResource, createSignal, onCleanup, Show } from "solid-js";
import { Modal } from "./Modal";
import { Button } from "../buttons/Button";
import { Select } from "../forms/Select";
import { VideoSeriesAutocomplete } from "../forms/VideoSeriesAutocomplete";
import { toast } from "../feedback/Toast";
import { getClientForRemote } from "../../app/api/client";
import { getCurrentRemote } from "../../music/data/currentState";
import { queryClient } from "../../queryClient";
import { getVideoDataSource } from "../../video/data";
import { videoQueryKeys } from "../../video/queries/queryKeys";
import { useVideoSeriesListQuery, useCreateVideoSeriesMutation } from "../../video/queries/series";
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
  const [seasonId, setSeasonId] = createSignal("");
  const [availableSeasons, setAvailableSeasons] = createSignal<
    Array<{ id: string; title: string; season_number: number }>
  >([]);
  const [isSaving, setIsSaving] = createSignal(false);

  // fetch seasons whenever the user picks a series in this modal.
  createEffect(() => {
    const id = formSeriesId();
    if (!id) {
      setAvailableSeasons([]);
      return;
    }
    const remote = getCurrentRemote();
    if (!remote) {
      setAvailableSeasons([]);
      return;
    }
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    void (async () => {
      const client = await getClientForRemote(remote);
      const result = await client.video.listVideoSeasons({ series_id: id });
      if (cancelled) return;
      setAvailableSeasons(
        result.success
          ? result.data.map((s) => ({
              id: s.id,
              title: s.title ?? "",
              season_number: s.season_number,
            }))
          : []
      );
    })();
  });

  const isValid = createMemo(
    () => seriesInputValue().trim().length > 0 || pendingNewSeriesName() !== null
  );

  const handleSeriesSelect = (selection: { id?: string; name: string; isNew: boolean }) => {
    setSeriesInputValue(selection.name);
    if (selection.isNew) {
      setPendingNewSeriesName(selection.name);
      setFormSeriesId(null);
      setSeasonId("");
    } else {
      setPendingNewSeriesName(null);
      setFormSeriesId(selection.id ?? null);
      setSeasonId("");
    }
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

      const client = await getClientForRemote(remote);
      const result = await client.video.updateVideos({
        video_ids: props.videoIds,
        series_id: seriesIdToApply || null,
        season_id: seasonId() || null,
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

  return (
    <Show when={props.isOpen}>
      <Modal isOpen={true} onClose={props.onClose} title="edit videos" size="md">
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
              <label class="text-sm text-[var(--color-text-secondary)] mb-1 block">season</label>
              <Select
                value={seasonId()}
                onchange={(e) => setSeasonId(e.currentTarget.value)}
                options={[
                  { value: "", label: "(none)" },
                  ...availableSeasons().map((s) => ({
                    value: s.id,
                    label: `season ${s.season_number}${s.title ? ` - ${s.title}` : ""}`,
                  })),
                ]}
                placeholder="select a season…"
                disabled={availableSeasons().length === 0}
              />
            </div>
          </Show>

          <div class="border-t border-[var(--color-border-subtle)] pt-3">
            <BulkVideoTaxonsEditor
              videoIds={props.videoIds}
              excludeKinds={["genre", "mood", "style", "era", "label"]}
            />
          </div>

          <div class="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border-subtle)]">
            <Button variant="ghost" onClick={props.onClose} disabled={isSaving()}>
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
