// presentational form for editing a video import-review group's metadata -
// mirrors components/import/ImportAlbumEditorPanel.tsx, but much simpler
// (no musicbrainz/taxons/artwork-upload tabs): content type (for a
// singleton group), series title/description, series/season assignment
// (with create-new support, mirroring EditVideoModal.tsx), plus per-video
// title + episode number.
import { For, Index, Show } from "solid-js";
import { TextArea } from "../forms/TextArea";
import { VideoSeriesAutocomplete } from "../forms/VideoSeriesAutocomplete";
import {
  VideoSeasonAutocomplete,
  formatSeasonLabel,
  type VideoSeasonSelection,
} from "../forms/VideoSeasonAutocomplete";

export interface ImportVideoEditVideo {
  id: string;
  title: string;
  seasonNumber: number | null;
  seasonTitle: string | null;
  seasonId: string | null;
  /** season to create on save (create-then-assign) - set by picking
   * "create new" in the season autocomplete. */
  pendingNewSeason: { season_number: number; title: string | null } | null;
  episodeNumber: number | null;
}

export interface ImportVideoEdit {
  /** "series" | "movie" | "clip" - only editable for a singleton group
   * (exactly one video); a multi-video group is always "series" (that's
   * how the grouping key works) and this field is fixed/hidden for it. */
  contentType: string;
  /** resolved existing (or freshly picked) series id */
  seriesId: string | null;
  /** series to create on save (create-then-attach) - set by picking
   * "create new" in the series autocomplete. */
  pendingNewSeriesName: string | null;
  seriesTitle: string;
  seriesDescription: string;
  videos: ImportVideoEditVideo[];
}

export interface ImportVideoEditorPanelProps {
  value: ImportVideoEdit;
  onChange: (next: ImportVideoEdit) => void;
  /** false for a standalone (non-series) video/clip - hides the series
   * title/description editor (only meaningful for an already-attached
   * multi-video series group). */
  isSeries: boolean;
}

function fmtEpisode(v: { seasonNumber: number | null; episodeNumber: number | null }): string {
  if (v.seasonNumber != null && v.episodeNumber != null)
    return `S${v.seasonNumber}E${v.episodeNumber}`;
  if (v.episodeNumber != null) return `E${v.episodeNumber}`;
  return "";
}

const CONTENT_TYPES = ["series", "movie", "clip"] as const;

export function ImportVideoEditorPanel(props: ImportVideoEditorPanelProps) {
  const isSingleton = () => props.value.videos.length === 1;
  const isSeriesContent = () => props.value.contentType === "series";
  const seriesChosen = () => !!(props.value.seriesId || props.value.pendingNewSeriesName);

  const updateVideo = (id: string, patch: Partial<ImportVideoEditVideo>) => {
    props.onChange({
      ...props.value,
      videos: props.value.videos.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    });
  };

  const seriesDisplayValue = () =>
    props.value.pendingNewSeriesName ?? (props.value.seriesId ? props.value.seriesTitle : "");

  const seasonDisplayValue = (v: ImportVideoEditVideo) => {
    if (v.pendingNewSeason) {
      return formatSeasonLabel(v.pendingNewSeason.season_number, v.pendingNewSeason.title);
    }
    if (v.seasonId) return formatSeasonLabel(v.seasonNumber ?? 0, v.seasonTitle);
    return "";
  };

  // switching to "movie"/"clip" clears any series/season assignment
  // (they're hidden for standalone content, mirroring
  // EditVideoModal.tsx's handleContentTypeChange); switching to "series"
  // just reveals the series picker below.
  const handleContentTypeChange = (type: (typeof CONTENT_TYPES)[number]) => {
    if (type === "series") {
      props.onChange({ ...props.value, contentType: type });
      return;
    }
    props.onChange({
      ...props.value,
      contentType: type,
      seriesId: null,
      pendingNewSeriesName: null,
      videos: props.value.videos.map((v) => ({
        ...v,
        seasonId: null,
        pendingNewSeason: null,
      })),
    });
  };

  const handleSeriesSelect = (selection: { id?: string; name: string; isNew: boolean }) => {
    props.onChange({
      ...props.value,
      contentType: "series",
      seriesId: selection.isNew ? null : (selection.id ?? null),
      pendingNewSeriesName: selection.isNew ? selection.name : null,
      // a different series invalidates any season picked for the old one
      videos: props.value.videos.map((v) => ({
        ...v,
        seasonId: null,
        pendingNewSeason: null,
      })),
    });
  };

  const handleClearSeries = () => {
    props.onChange({
      ...props.value,
      seriesId: null,
      pendingNewSeriesName: null,
      videos: props.value.videos.map((v) => ({
        ...v,
        seasonId: null,
        pendingNewSeason: null,
      })),
    });
  };

  const handleSeasonSelect = (videoId: string, selection: VideoSeasonSelection) => {
    updateVideo(videoId, {
      seasonId: selection.isNew ? null : (selection.id ?? null),
      pendingNewSeason: selection.isNew
        ? { season_number: selection.season_number, title: selection.title }
        : null,
      seasonNumber: selection.season_number,
      seasonTitle: selection.title,
    });
  };

  const handleClearSeason = (videoId: string) => {
    updateVideo(videoId, { seasonId: null, pendingNewSeason: null });
  };

  return (
    <div class="flex flex-col gap-4">
      <Show when={isSingleton()}>
        <div class="flex flex-col gap-1">
          <label class="body-xs text-[var(--color-text-muted)]">content type</label>
          <div class="flex gap-2">
            <For each={CONTENT_TYPES}>
              {(type) => (
                <button
                  type="button"
                  onClick={() => handleContentTypeChange(type)}
                  class={`px-3 py-1.5 text-sm rounded ${
                    props.value.contentType === type
                      ? "bg-[var(--color-accent-500)] text-white"
                      : "bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]"
                  }`}
                >
                  {type}
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>

      <Show when={isSeriesContent() && isSingleton()}>
        <div class="flex flex-col gap-1">
          <VideoSeriesAutocomplete
            label="series"
            value={seriesDisplayValue()}
            onSelect={handleSeriesSelect}
            placeholder="search or type series title..."
            hint={
              props.value.pendingNewSeriesName
                ? `"${props.value.pendingNewSeriesName}" will be created as a new series on save`
                : undefined
            }
          />
          <Show when={seriesChosen()}>
            <button
              type="button"
              onClick={handleClearSeries}
              class="mt-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] self-start"
            >
              remove from series
            </button>
          </Show>
        </div>
      </Show>

      <Show when={props.isSeries && !isSingleton()}>
        <div class="flex flex-col gap-1">
          <label class="body-xs text-[var(--color-text-muted)]" for="video-review-series-title">
            series title
          </label>
          <input
            id="video-review-series-title"
            type="text"
            class="body-small px-2 py-1.5 rounded border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]"
            value={props.value.seriesTitle}
            onInput={(e) => props.onChange({ ...props.value, seriesTitle: e.currentTarget.value })}
          />
        </div>

        <div class="flex flex-col gap-1">
          <label
            class="body-xs text-[var(--color-text-muted)]"
            for="video-review-series-description"
          >
            series description
          </label>
          <TextArea
            id="video-review-series-description"
            value={props.value.seriesDescription}
            onInput={(e) =>
              props.onChange({ ...props.value, seriesDescription: e.currentTarget.value })
            }
            rows={3}
          />
        </div>
      </Show>

      <div class="flex flex-col gap-2">
        <p class="body-xs text-[var(--color-text-muted)]">videos in this group</p>
        {/* rounded-lg + divide-y (no overflow-hidden - that clipped the
            season/series autocomplete popovers below); each row is keyed
            by position via Index (not For, which keys by object identity
            and would remount the row - and lose input focus - every
            keystroke, since updateVideo() replaces the edited item). */}
        <div class="rounded-lg border border-[var(--color-border-default)] divide-y divide-[var(--color-border-subtle)]">
          <Index each={props.value.videos}>
            {(video) => (
              <div class="flex flex-col gap-1.5 px-3 py-2 bg-[var(--color-bg-secondary)] first:rounded-t-lg last:rounded-b-lg">
                <div class="flex items-center gap-2">
                  <span class="w-14 text-right body-xs text-[var(--color-text-muted)] flex-shrink-0">
                    {fmtEpisode(video())}
                  </span>
                  <input
                    type="text"
                    class="flex-1 min-w-0 body-small px-2 py-1 rounded border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]"
                    value={video().title}
                    onInput={(e) => updateVideo(video().id, { title: e.currentTarget.value })}
                    aria-label={`title for ${video().title}`}
                  />
                  <input
                    type="number"
                    class="w-16 body-small px-2 py-1 rounded border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]"
                    value={video().episodeNumber ?? ""}
                    onInput={(e) =>
                      updateVideo(video().id, {
                        episodeNumber: e.currentTarget.value ? Number(e.currentTarget.value) : null,
                      })
                    }
                    aria-label={`episode number for ${video().title}`}
                  />
                </div>

                <Show when={isSeriesContent() && seriesChosen()}>
                  <div class="pl-16 flex flex-col gap-1">
                    <VideoSeasonAutocomplete
                      seriesId={props.value.seriesId ?? undefined}
                      value={seasonDisplayValue(video())}
                      onSelect={(selection) => handleSeasonSelect(video().id, selection)}
                      placeholder="assign to season..."
                      hint={
                        video().pendingNewSeason
                          ? `${formatSeasonLabel(video().pendingNewSeason!.season_number, video().pendingNewSeason!.title)} will be created on save`
                          : undefined
                      }
                    />
                    <Show when={video().seasonId || video().pendingNewSeason}>
                      <button
                        type="button"
                        onClick={() => handleClearSeason(video().id)}
                        class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] self-start"
                      >
                        remove from season
                      </button>
                    </Show>
                  </div>
                </Show>
              </div>
            )}
          </Index>
        </div>
      </div>
    </div>
  );
}
