import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDB } from "idb";
import { closeVideoDB, VIDEO_DB_NAME, STORE_VIDEOS } from "./init";
import { closeMusicDB } from "../../../../music/services/storage/db/init";
import { addLocalVideo, getLocalVideoById } from "./videos";
import { getLocalVideoSeriesById } from "./series";
import { localVideoDataSource } from "../../../data/local/localSource";
import {
  createLocalVideoImportSession,
  getLocalVideoImportSession,
  recordLocalVideoImport,
  listLocalPendingVideoReviews,
  patchLocalVideoReviewGroup,
  moveLocalReviewVideo,
} from "./importReview";
import { getVideoReviewBackend } from "../../reviewBackend";

async function addVideo(session: string, id: string, seriesId?: string) {
  const video = await addLocalVideo({
    id,
    title: id,
    opfs_path: `video/${id}.mp4`,
    file_name: `${id}.mp4`,
    file_size: 10,
    mime_type: "video/mp4",
    blake3: id.repeat(64).slice(0, 64),
    series_id: seriesId,
    content_type: seriesId ? "series" : "movie",
  });
  await recordLocalVideoImport(session, id);
  return video;
}

beforeEach(() => {
  closeVideoDB();
  closeMusicDB();
  indexedDB = new IDBFactory();
});
afterEach(() => {
  closeVideoDB();
  closeMusicDB();
});

describe("browser video review sessions", () => {
  it("adds the review store without losing existing v3 videos", async () => {
    const old = await openDB(VIDEO_DB_NAME, 3, {
      upgrade(db) {
        db.createObjectStore(STORE_VIDEOS, { keyPath: "id" });
      },
    });
    await old.put(STORE_VIDEOS, { id: "existing", title: "existing video" });
    old.close();
    const session = await createLocalVideoImportSession();
    expect(await getLocalVideoById("existing")).toMatchObject({ title: "existing video" });
    expect(await getLocalVideoImportSession(session)).toMatchObject({ video_ids: [] });
  });

  it("persists local sessions and their send target across reopening and review completion", async () => {
    const session = await createLocalVideoImportSession({
      remoteId: "dest",
      remoteName: "library",
    });
    await addVideo(session, "a");
    await recordLocalVideoImport(session, "a");
    closeVideoDB();
    const backend = getVideoReviewBackend(null);
    expect(await backend.listPendingSessions()).toMatchObject([
      {
        session_id: session,
        target_remote_id: "dest",
        groups: [{ group_key: "a" }],
      },
    ]);
    await backend.markReviewed(session, "a");
    closeVideoDB();
    expect(await backend.listPendingSessions()).toEqual([]);
    expect(await backend.getSessionTarget(session)).toEqual({ id: "dest", name: "library" });
    expect((await getLocalVideoImportSession(session)).video_ids).toEqual(["a"]);
  });

  it("groups episodes by series and saves season/title edits without clearing the series", async () => {
    const session = await createLocalVideoImportSession();
    const series = await localVideoDataSource.createVideoSeries({
      title: "series",
      description: "keep me",
    });
    await addVideo(session, "a", series.id);
    await addVideo(session, "b", series.id);
    const pending = await listLocalPendingVideoReviews(session);
    expect(pending[0].groups).toHaveLength(1);
    expect(pending[0].groups[0].pending_blob_count).toBe(2);
    await patchLocalVideoReviewGroup({
      session_id: session,
      group_key: series.id,
      videos: [
        {
          video_id: "a",
          title: "episode one",
          episode_number: 1,
          new_season: { season_number: 2, title: "second season" },
        },
      ],
    });
    expect(await getLocalVideoById("a")).toMatchObject({
      title: "episode one",
      episode_number: 1,
      series_id: series.id,
      content_type: "series",
    });
    expect(await getLocalVideoSeriesById(series.id)).toMatchObject({
      title: "series",
      description: "keep me",
    });
    expect(await localVideoDataSource.getVideoSeasons(series.id)).toMatchObject([
      { season_number: 2, title: "second season" },
    ]);
    expect(await listLocalPendingVideoReviews(session)).toEqual([]);
  });

  it("can move a singleton to a new series and finish reviewing it by video id", async () => {
    const session = await createLocalVideoImportSession();
    const oldSeries = await localVideoDataSource.createVideoSeries({ title: "old series" });
    await addVideo(session, "a", oldSeries.id);
    await moveLocalReviewVideo({
      video_id: "a",
      new_series_title: "new series",
      new_season: { season_number: 1, title: "season one" },
    });
    await patchLocalVideoReviewGroup({
      session_id: session,
      group_key: "a",
      videos: [{ video_id: "a", title: "renamed" }],
    });
    expect(await getLocalVideoById("a")).toMatchObject({
      title: "renamed",
      content_type: "series",
    });
    expect((await getLocalVideoById("a"))?.series_id).not.toBe(oldSeries.id);
    expect(await listLocalPendingVideoReviews(session)).toEqual([]);
  });

  it("resolves reviewed music links in local storage, not a selected remote", async () => {
    const session = await createLocalVideoImportSession();
    await addVideo(session, "a");
    await moveLocalReviewVideo({
      video_id: "a",
      content_type: "music_video",
      new_artist_name: "local artist",
      new_album_title: "local album",
    });
    const pending = await listLocalPendingVideoReviews(session);
    expect(pending[0].groups[0].videos[0]).toMatchObject({
      content_type: "music_video",
      artist_name: "local artist",
      album_title: "local album",
    });
  });

  it("rejects foreign videos before changing series metadata or marking anything reviewed", async () => {
    const session = await createLocalVideoImportSession();
    const other = await createLocalVideoImportSession();
    const series = await localVideoDataSource.createVideoSeries({ title: "original" });
    await addVideo(session, "a", series.id);
    await addVideo(other, "b");
    await expect(
      patchLocalVideoReviewGroup({
        session_id: session,
        group_key: series.id,
        series_title: "wrong",
        videos: [
          { video_id: "a", title: "wrong" },
          { video_id: "b", title: "wrong" },
        ],
      })
    ).rejects.toThrow("not in this review group");
    expect(await getLocalVideoSeriesById(series.id)).toMatchObject({ title: "original" });
    expect(await getLocalVideoById("a")).toMatchObject({ title: "a" });
    expect((await getLocalVideoImportSession(session)).reviewed_video_ids).toEqual([]);
  });

  it("rejects seasons from a different series without consuming the review", async () => {
    const session = await createLocalVideoImportSession();
    const first = await localVideoDataSource.createVideoSeries({ title: "first" });
    const second = await localVideoDataSource.createVideoSeries({ title: "second" });
    const season = await localVideoDataSource.createVideoSeason({
      series_id: second.id,
      season_number: 1,
    });
    await addVideo(session, "a", first.id);
    await expect(
      patchLocalVideoReviewGroup({
        session_id: session,
        group_key: first.id,
        videos: [{ video_id: "a", season_id: season.id }],
      })
    ).rejects.toThrow("season does not belong");
    expect((await getLocalVideoImportSession(session)).reviewed_video_ids).toEqual([]);
  });

  it("never treats an unresolved review origin as browser-local", () => {
    expect(() => getVideoReviewBackend(undefined)).toThrow("still loading");
  });
});
