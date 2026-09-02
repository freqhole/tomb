// adaptVideo / adaptVideoSeries / adaptVideoSeason
//
// converts a `VideoSummary` / `VideoSeries` / `VideoSeason` (the wire
// shapes returned by the video domain's data sources) into the graph-
// local `VideoNodeData` / `VideoSeriesNodeData` / `VideoSeasonNodeData`
// shapes. mirrors adaptAlbum.ts's role, deliberately minimal per phase 2
// of docs/graph-viz-video-domain-plan.md (no taxons).

import {
  videoNodeId,
  videoSeasonNodeId,
  videoSeriesNodeId,
} from "../../../../components/graph/data/nodeIds";
import type {
  VideoNodeData,
  VideoSeasonNodeData,
  VideoSeriesNodeData,
} from "../../../../components/graph/types";
import type { VideoSeason, VideoSeries, VideoSummary } from "../../../../video/data/types";

export function adaptVideo(video: VideoSummary, remoteId: string): VideoNodeData {
  return {
    id: videoNodeId(remoteId, video.id),
    kind: "video",
    videoId: video.id,
    title: video.title,
    seriesId: video.series_id ?? null,
    seasonId: video.season_id ?? null,
    posterBlobId: video.poster_blob_id ?? null,
    posterOpfsPath: video.source_type === "local" ? (video.poster_opfs_path ?? null) : null,
    remoteServerId: video.remote_server_id ?? null,
  };
}

export function adaptVideoSeries(
  series: VideoSeries,
  remoteId: string,
  videoCount: number
): VideoSeriesNodeData {
  return {
    id: videoSeriesNodeId(remoteId, series.id),
    kind: "video_series",
    seriesId: series.id,
    title: series.title,
    posterBlobId: series.poster_blob_id ?? null,
    remoteServerId: series.remote_server_id ?? null,
    videoCount,
  };
}

export function adaptVideoSeason(
  season: VideoSeason,
  remoteId: string,
  videoCount: number
): VideoSeasonNodeData {
  return {
    id: videoSeasonNodeId(remoteId, season.id),
    kind: "video_season",
    seasonId: season.id,
    seriesId: season.series_id,
    title: season.title ?? `season ${season.season_number}`,
    seasonNumber: season.season_number,
    posterBlobId: season.poster_blob_id ?? null,
    remoteServerId: season.remote_server_id ?? null,
    videoCount,
  };
}
