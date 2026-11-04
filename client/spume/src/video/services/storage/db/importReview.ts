import type {
  PendingVideoReviewSession,
  PendingVideoReviewGroup,
  PatchVideoGroupReviewRequest,
  MoveVideoReviewRequest,
} from "@freqhole/api-client";
import { getVideoDB, STORE_IMPORT_REVIEW_SESSIONS } from "./init";
import { getLocalVideoById } from "./videos";
import { localVideoDataSource } from "../../../data/local/localSource";
import { getArtistById, getAlbumById } from "../../../../music/services/storage/db";

export interface LocalVideoReviewSession {
  session_id: string;
  created_at: number;
  target_remote_id: string | null;
  target_remote_name: string | null;
  video_ids: string[];
  reviewed_video_ids: string[];
}

export async function createLocalVideoImportSession(target?: {
  remoteId: string;
  remoteName: string;
}): Promise<string> {
  const session: LocalVideoReviewSession = {
    session_id: crypto.randomUUID(),
    created_at: Math.floor(Date.now() / 1000),
    target_remote_id: target?.remoteId ?? null,
    target_remote_name: target?.remoteName ?? null,
    video_ids: [],
    reviewed_video_ids: [],
  };
  await (await getVideoDB()).put(STORE_IMPORT_REVIEW_SESSIONS, session);
  return session.session_id;
}

export async function getLocalVideoImportSession(id: string): Promise<LocalVideoReviewSession> {
  const session = await (await getVideoDB()).get(STORE_IMPORT_REVIEW_SESSIONS, id);
  if (!session) throw new Error("video import session not found");
  return session;
}

export async function recordLocalVideoImport(sessionId: string, videoId: string): Promise<void> {
  const db = await getVideoDB();
  const tx = db.transaction(STORE_IMPORT_REVIEW_SESSIONS, "readwrite");
  const session: LocalVideoReviewSession = await tx.store.get(sessionId);
  if (!session) throw new Error("video import session not found");
  if (!session.video_ids.includes(videoId)) session.video_ids.push(videoId);
  await tx.store.put(session);
  await tx.done;
}

export async function listLocalPendingVideoReviews(
  sessionId?: string
): Promise<PendingVideoReviewSession[]> {
  const sessions: LocalVideoReviewSession[] = sessionId
    ? [await getLocalVideoImportSession(sessionId)]
    : await (await getVideoDB()).getAll(STORE_IMPORT_REVIEW_SESSIONS);
  const result: PendingVideoReviewSession[] = [];
  for (const session of sessions) {
    const groups = new Map<string, PendingVideoReviewGroup>();
    for (const id of session.video_ids) {
      if (session.reviewed_video_ids.includes(id)) continue;
      const video = await getLocalVideoById(id);
      if (!video || video.deleted_at) continue;
      const series = video.series_id
        ? await localVideoDataSource.getVideoSeriesById(video.series_id)
        : null;
      const seasons = series ? await localVideoDataSource.getVideoSeasons(series.id) : [];
      const season = seasons.find((s) => s.id === video.season_id);
      const artist = video.artist_id ? await getArtistById(video.artist_id) : null;
      const album = video.album_id ? await getAlbumById(video.album_id) : null;
      const key = series?.id ?? video.id;
      const group = groups.get(key) ?? {
        group_key: key,
        series_id: series?.id ?? null,
        series_title: series?.title ?? null,
        poster_blob_id: null,
        pending_blob_count: 0,
        videos: [],
      };
      group.videos.push({
        video_id: video.id,
        title: video.title,
        content_type: video.content_type,
        season_id: season?.id ?? null,
        season_number: season?.season_number ?? null,
        season_title: season?.title ?? null,
        episode_number: video.episode_number,
        artist_id: video.artist_id,
        artist_name: artist?.name ?? null,
        album_id: video.album_id,
        album_title: album?.title ?? null,
      });
      group.pending_blob_count++;
      groups.set(key, group);
    }
    if (groups.size)
      result.push({
        session_id: session.session_id,
        created_at: session.created_at,
        uploader_username: null,
        target_remote_id: session.target_remote_id,
        target_remote_name: session.target_remote_name,
        groups: [...groups.values()],
      });
  }
  return result;
}

async function groupVideoIds(sessionId: string, groupKey: string): Promise<string[]> {
  const session = await getLocalVideoImportSession(sessionId);
  const videos = await Promise.all(session.video_ids.map(getLocalVideoById));
  const ids = videos.flatMap((v) =>
    v && !v.deleted_at && (v.id === groupKey || v.series_id === groupKey) ? [v.id] : []
  );
  if (!ids.length) throw new Error("video review group not found in this session");
  return ids;
}

export async function markLocalVideoGroupReviewed(
  sessionId: string,
  groupKey: string
): Promise<void> {
  const ids = await groupVideoIds(sessionId, groupKey);
  const db = await getVideoDB();
  const tx = db.transaction(STORE_IMPORT_REVIEW_SESSIONS, "readwrite");
  const session: LocalVideoReviewSession = await tx.store.get(sessionId);
  session.reviewed_video_ids = [...new Set([...session.reviewed_video_ids, ...ids])];
  await tx.store.put(session);
  await tx.done;
}

export async function patchLocalVideoReviewGroup(req: PatchVideoGroupReviewRequest): Promise<void> {
  const ids = await groupVideoIds(req.session_id, req.group_key);
  for (const patch of req.videos ?? []) {
    if (!ids.includes(patch.video_id)) throw new Error("video is not in this review group");
    const video = await getLocalVideoById(patch.video_id);
    if (!video?.series_id && (patch.season_id || patch.new_season)) {
      throw new Error("choose a series before assigning a season");
    }
    if (patch.season_id && video?.series_id) {
      const seasons = await localVideoDataSource.getVideoSeasons(video.series_id);
      if (!seasons.some((s) => s.id === patch.season_id)) {
        throw new Error("season does not belong to this series");
      }
    }
  }
  const first = await getLocalVideoById(ids[0]);
  if (first?.series_id) {
    await localVideoDataSource.updateVideoSeries({
      series_id: first.series_id,
      ...(req.series_title != null ? { title: req.series_title } : {}),
      ...(req.series_description != null ? { description: req.series_description } : {}),
    });
  }
  for (const patch of req.videos ?? []) {
    const video = await getLocalVideoById(patch.video_id);
    let seasonId = patch.season_id;
    if (!seasonId && patch.new_season) {
      if (!video?.series_id) throw new Error("choose a series before creating a season");
      seasonId = (
        await localVideoDataSource.createVideoSeason({
          series_id: video.series_id,
          ...patch.new_season,
        })
      ).id;
    }
    await localVideoDataSource.updateVideo({
      video_id: patch.video_id,
      title: patch.title ?? undefined,
      episode_number: patch.episode_number ?? undefined,
      content_type: patch.content_type ?? undefined,
      season_id: seasonId ?? undefined,
    });
  }
  await markLocalVideoGroupReviewed(req.session_id, req.group_key);
}

export async function moveLocalReviewVideo(req: MoveVideoReviewRequest): Promise<void> {
  if (!(await getLocalVideoById(req.video_id))) throw new Error("video not found");
  let seriesId = req.to_series_id;
  if (req.new_series_title?.trim()) {
    seriesId = (
      await localVideoDataSource.createVideoSeries({ title: req.new_series_title.trim() })
    ).id;
  }
  if (seriesId && !(await localVideoDataSource.getVideoSeriesById(seriesId)))
    throw new Error("series not found");
  let seasonId = req.to_season_id;
  if (req.new_season) {
    if (!seriesId) throw new Error("choose a series before creating a season");
    seasonId = (
      await localVideoDataSource.createVideoSeason({ series_id: seriesId, ...req.new_season })
    ).id;
  }
  if (seasonId) {
    if (
      !seriesId ||
      !(await localVideoDataSource.getVideoSeasons(seriesId)).some((s) => s.id === seasonId)
    ) {
      throw new Error("season does not belong to this series");
    }
  }
  await localVideoDataSource.updateVideo({
    video_id: req.video_id,
    series_id: seriesId ?? null,
    season_id: seasonId ?? null,
    content_type: seriesId ? "series" : (req.content_type ?? "movie"),
    artist_id: req.to_artist_id,
    artist_name: req.new_artist_name,
    album_id: req.to_album_id,
    album_title: req.new_album_title,
    clear_artist_id: !req.to_artist_id && !req.new_artist_name,
    clear_album_id: !req.to_album_id && !req.new_album_title,
  });
}
