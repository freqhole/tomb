// video-domain equivalents of helpers.ts's fetchAlbumSongs — resolve a
// playable video list for a video/video_series/video_season node,
// working across BOTH real peer remotes and the local (browser) library.
//
// unlike music's fetchAlbumSongs (which only ever targets a real `Remote`,
// since local albums silently no-op today), video explicitly supports the
// local library here too — this session's testing showed local browsing
// is a primary use case, so "click play on a video node" needs to work
// there, not just for peer remotes.
import type { Remote } from "../../../../app/services/storage/schemas/remote";
import type { VideoDataSource, VideoSummary } from "../../../../video/data/types";
import { localVideoDataSource } from "../../../../video/data/local/localSource";
import { RemoteVideoDataSource } from "../../../../video/data/remote/remoteSource";
import { RemoteOfflineError } from "../../../../music/data/remote/remoteSource";
import { probeRemote } from "../../../../app/services/remotes/remoteHealth";
import { LOCAL_GRAPH_REMOTE_ID } from "./LocalAlbumsLoader";

function resolveVideoDataSource(remote: Remote | undefined, remoteId: string): VideoDataSource {
  if (!remote || remoteId === LOCAL_GRAPH_REMOTE_ID) return localVideoDataSource;
  return new RemoteVideoDataSource(remote);
}

/** retry-on-transient-offline wrapper, mirrors fetchAlbumSongs's shape
 *  (local data source calls never throw RemoteOfflineError, so the retry
 *  path is simply skipped for them). */
async function withOfflineRetry<T>(remote: Remote | undefined, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!(err instanceof RemoteOfflineError) || !remote) throw err;
    const isOnline = await probeRemote(remote, { force: true });
    if (!isOnline) throw err;
    return await run();
  }
}

export async function fetchVideoById(
  remote: Remote | undefined,
  remoteId: string,
  videoId: string
): Promise<VideoSummary | null> {
  return withOfflineRetry(remote, () =>
    resolveVideoDataSource(remote, remoteId).getVideoById(videoId)
  );
}

export async function fetchVideosForSeries(
  remote: Remote | undefined,
  remoteId: string,
  seriesId: string
): Promise<VideoSummary[]> {
  return withOfflineRetry(remote, async () => {
    const detail = await resolveVideoDataSource(remote, remoteId).getVideoSeriesDetail(seriesId);
    if (!detail) return [];
    return [...detail.seasons.flatMap((s) => s.videos), ...detail.unassignedVideos];
  });
}

export async function fetchVideosForSeason(
  remote: Remote | undefined,
  remoteId: string,
  seasonId: string
): Promise<VideoSummary[]> {
  return withOfflineRetry(remote, () =>
    resolveVideoDataSource(remote, remoteId).getVideosBySeason(seasonId)
  );
}
