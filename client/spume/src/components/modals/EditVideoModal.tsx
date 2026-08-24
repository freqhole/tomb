// edit video modal — single-video metadata editor, mirrors
// SongEditorModal.tsx's shape but far simpler (no tabs/images/entity
// urls): title, description, episode number, release date, plus series/
// season assignment and renditions list with hard-delete.
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { Button } from "../buttons/Button";
import { TextInput } from "../forms/TextInput";
import { Select } from "../forms/Select";
import { toast } from "../feedback/Toast";
import { confirm } from "../../app/services/confirmState";
import { canUpdateVideo } from "../../video/data/permissions";
import { useUpdateVideoMutation, useVideoQuery } from "../../video/queries/videos";
import { useVideoSeriesListQuery } from "../../video/queries/series";
import { getClientForRemote } from "../../app/api/client";
import { getCurrentRemote } from "../../music/data";
import type { VideoRendition } from "@freqhole/api-client";
import { Modal } from "./Modal";
import { Icon, IconNames } from "../icons/registry";

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
  const updateMutation = useUpdateVideoMutation();
  const seriesListQuery = useVideoSeriesListQuery();

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

  // renditions list state
  const [renditions, setRenditions] = createSignal<VideoRendition[]>([]);
  const [renditionsLoading, setRenditionsLoading] = createSignal(false);
  const [deletingRendition, setDeletingRendition] = createSignal<string | null>(null);

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
      setLoadedVideoId(props.videoId);
    }
  });

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
      current.season_id !== initial.season_id
    );
  });

  const handleFieldChange = <K extends keyof FormData>(field: K, value: FormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSeriesChange = (value: string) => {
    if (value === "") {
      setFormData((prev) => ({ ...prev, series_id: null, season_id: null }));
    } else {
      setFormData((prev) => ({ ...prev, series_id: value, season_id: null }));
    }
  };

  const handleSeasonChange = (value: string) => {
    setFormData((prev) => ({ ...prev, season_id: value === "" ? null : value }));
  };

  const handleSave = async () => {
    const data = formData();
    try {
      await updateMutation.mutateAsync({
        video_id: props.videoId,
        title: data.title,
        description: data.description || null,
        episode_number: data.episode_number,
        release_date: data.release_date || null,
        series_id: data.series_id,
        season_id: data.season_id,
      });
      toast.success("video updated");
      props.onSave?.();
    } catch (err) {
      console.error("failed to update video:", err);
      toast.error("failed to update video");
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

          {/* series and season assignment */}
          <div class="space-y-4 border-t border-[var(--color-border-default)] pt-4">
            <h3 class="text-sm font-medium text-[var(--color-text-primary)]">series & season</h3>

            <div>
              <Select
                label="series"
                value={formData().series_id ?? ""}
                onchange={(e) => handleSeriesChange(e.currentTarget.value)}
                options={[
                  { value: "", label: "(none)" },
                  ...(seriesListQuery.data?.pages.flatMap((p) =>
                    p.items.map((s) => ({ value: s.id, label: s.title }))
                  ) ?? []),
                ]}
                placeholder="select a series..."
              />
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
