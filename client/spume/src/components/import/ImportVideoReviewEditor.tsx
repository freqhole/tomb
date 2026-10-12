// wrapper that connects ImportVideoEditorPanel to the live api inside
// ImportVideoReviewModal's renderGroupEditor render prop - mirrors
// components/import/ImportReviewEditor.tsx.
//
// "looks good" is handled by the modal footer which calls onMarkReviewed in
// App.tsx - that flushes this component's registered save fn before
// marking the group reviewed server-side.
import { createSignal, createEffect, onCleanup, Show } from "solid-js";
import { ImportVideoEditorPanel, type ImportVideoEdit } from "./ImportVideoEditorPanel";
import { musicLinkFromVideo, musicLinkToUpdateFields } from "../forms/VideoMusicLinkFields";
import { isMusicContentType } from "../../video/utils/contentType";
import type { VideoGroupEditorRenderProps } from "../modals/ImportVideoReviewModal";
import type {
  VideoImportReviewHandle,
  ImportReviewVideoGroup,
} from "../../video/hooks/useVideoImportReview";
import { Icon } from "../icons/registry";

function groupToEdit(group: ImportReviewVideoGroup): ImportVideoEdit {
  const isSeries = !!group.seriesId;
  return {
    contentType: isSeries ? "series" : (group.videos[0]?.contentType ?? "movie"),
    musicLink: musicLinkFromVideo(group.videos[0] ?? {}),
    seriesId: group.seriesId ?? null,
    pendingNewSeriesName: null,
    seriesTitle: group.seriesTitle ?? "",
    seriesDescription: "",
    videos: group.videos.map((v) => ({
      id: v.id,
      title: v.title,
      seasonNumber: v.seasonNumber ?? null,
      seasonTitle: v.seasonTitle ?? null,
      seasonId: v.seasonId ?? null,
      pendingNewSeason: null,
      episodeNumber: v.episodeNumber ?? null,
    })),
  };
}

export interface ImportVideoReviewEditorProps extends VideoGroupEditorRenderProps {
  reviewHandle: VideoImportReviewHandle;
  onRegisterSave: (groupKey: string, save: () => Promise<void>) => void;
  onUnregisterSave: (groupKey: string) => void;
}

export function ImportVideoReviewEditor(props: ImportVideoReviewEditorProps) {
  const [edit, setEdit] = createSignal<ImportVideoEdit>(groupToEdit(props.group));

  // reset edit state when the group changes
  createEffect(() => {
    setEdit(groupToEdit(props.group));
    props.reviewHandle.clearError();
  });

  // register a save fn keyed by groupKey so App.tsx can flush before marking reviewed
  createEffect(() => {
    const groupKey = props.group.groupKey;
    const wasSeries = !!props.group.seriesId;
    const saveFn = async () => {
      const e = edit();
      const singleton = e.videos.length === 1;

      // a new series/season is resolved (find-or-create) server-side,
      // inside the already owner-or-admin-gated review handlers - never
      // through the separately admin-gated create_video_series/
      // create_video_season routes, so an uploading member can name a new
      // series/season for their own upload without needing admin rights.
      if (singleton) {
        const video = e.videos[0];
        // series/season/content_type assignment for a singleton always
        // goes through moveVideo - it's the only route that can both
        // attach AND detach a video from a series (patchGroup never
        // touches series_id, since a multi-video group's series is
        // fixed by its grouping key). the same call carries the
        // artist/album for music video/karaoke content - the server finds
        // or creates them by name under this review permission, and
        // cleans up the series/artist/album the video just left.
        const isSeries = e.contentType === "series";
        const musicFields = musicLinkToUpdateFields(e.musicLink);
        await props.reviewHandle.moveVideo(
          video.id,
          isSeries ? e.seriesId : null,
          isSeries ? video.seasonId : null,
          isSeries ? null : e.contentType,
          isSeries ? e.pendingNewSeriesName : null,
          isSeries ? video.pendingNewSeason : null,
          !isSeries && isMusicContentType(e.contentType)
            ? {
                artistId: musicFields.artist_id,
                artistName: musicFields.artist_name,
                albumId: musicFields.album_id,
                albumTitle: musicFields.album_title,
              }
            : null
        );
        await props.reviewHandle.patchGroup(groupKey, {
          videos: [
            {
              video_id: video.id,
              title: video.title || null,
              episode_number: video.episodeNumber ?? null,
            },
          ],
        });
        return;
      }

      await props.reviewHandle.patchGroup(groupKey, {
        series_title: wasSeries ? e.seriesTitle || null : null,
        series_description: wasSeries ? e.seriesDescription || null : null,
        videos: e.videos.map((v) => ({
          video_id: v.id,
          title: v.title || null,
          episode_number: v.episodeNumber ?? null,
          season_id: v.seasonId ?? null,
          new_season: v.pendingNewSeason ?? null,
        })),
      });
    };
    props.onRegisterSave(groupKey, saveFn);
    onCleanup(() => props.onUnregisterSave(groupKey));
  });

  return (
    <div class="flex flex-col gap-3">
      <Show when={props.reviewHandle.error()}>
        <div class="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[var(--color-error)]/10 body-xs text-[var(--color-error)]">
          <Icon name="alertTriangle" size={14} color="var(--color-error)" />
          <span>{props.reviewHandle.error()}</span>
        </div>
      </Show>
      <ImportVideoEditorPanel value={edit()} onChange={setEdit} isSeries={!!props.group.seriesId} />
    </div>
  );
}
