// charnel/tauri path for video sync-to-local.
//
// mirrors music's `syncSongViaLocalGrimoire`: instead of writing to OPFS
// (unavailable in WKWebView, which has no async `createWritable()`), hand the
// source peer's iroh node id + full metadata to the local grimoire and let it
// pull the video bytes itself by blake3 over verified streaming.

import { getClientForRemote, getTransportForRemote } from "../../../app/api/client";
import { extractNodeIdStrict } from "../../../app/services/remotes/peerAddr";
import { isP2PRemote } from "../../../app/services/storage/schemas/remote";
import type { Remote } from "../../../app/services/storage/schemas/remote";
import type { QueuedVideo } from "../../../app/services/storage/mediaItem";
import {
  inlineImagesForSync,
  type InlinableImage,
  type InlineImageCache,
  type SyncImageRefBody,
} from "../../../music/services/sync/syncImages";
import { debug, warn, error as errorLog } from "../../../utils/logger";

export interface VideoSyncResult {
  success: boolean;
  error?: string;
  videoId?: string;
  /** true if the destination already had this video */
  skipped?: boolean;
}

/** series/season context for a video, resolved from the source remote. all
 * fields are best-effort - a video with no series still syncs fine. */
interface SeriesContext {
  seriesTitle?: string;
  seriesDescription?: string;
  seasonNumber?: number;
  seasonTitle?: string;
  seriesImages: InlinableImage[];
  seasonImages: InlinableImage[];
}

const EMPTY_SERIES_CONTEXT: SeriesContext = { seriesImages: [], seasonImages: [] };

/** grimoire resolves series/season by title + number, not by the source's own
 * ids, so those have to be looked up on the source before syncing. */
async function resolveSeriesContext(video: QueuedVideo, remote: Remote): Promise<SeriesContext> {
  if (!video.series_id) return EMPTY_SERIES_CONTEXT;
  try {
    const client = await getClientForRemote(remote);
    const result = await client.video.getVideoSeriesDetail({ id: video.series_id });
    if (!result.success || !result.data) return EMPTY_SERIES_CONTEXT;

    const { series, seasons } = result.data;
    const season = video.season_id
      ? seasons.find((s) => s.season.id === video.season_id)?.season
      : undefined;

    return {
      seriesTitle: series.title,
      seriesDescription: series.description ?? undefined,
      seasonNumber: season?.season_number,
      seasonTitle: season?.title ?? undefined,
      seriesImages: series.poster_blob_id
        ? [{ blobId: series.poster_blob_id, isPrimary: true, blobType: "thumbnail" }]
        : [],
      seasonImages: season?.poster_blob_id
        ? [{ blobId: season.poster_blob_id, isPrimary: true, blobType: "thumbnail" }]
        : [],
    };
  } catch (e) {
    warn("syncVideoViaLocalGrimoire", `series lookup failed for ${video.series_id}:`, e);
    return EMPTY_SERIES_CONTEXT;
  }
}

/** the video's own poster, plus any other images the source lists for it. */
function videoImages(video: QueuedVideo): InlinableImage[] {
  const images: InlinableImage[] = (video.images ?? []).map((img) => ({
    blobId: img.blob_id,
    isPrimary: !!img.is_primary,
    blobType: img.blob_type,
  }));
  const poster = video.poster_blob_id;
  if (poster && !images.some((i) => i.blobId === poster)) {
    images.unshift({ blobId: poster, isPrimary: true, blobType: "thumbnail" });
  }
  return images;
}

/**
 * sync a video into the local charnel-managed grimoire via the iroh-blobs
 * pull path. requires a P2P source remote (the node id is what grimoire dials
 * to fetch the bytes) and a blake3 for the blob being synced.
 */
export async function syncVideoViaLocalGrimoire(
  video: QueuedVideo,
  remote: Remote,
  blobId: string,
  blake3: string | null,
  size?: number | null,
  mime?: string | null
): Promise<VideoSyncResult> {
  if (!blake3) {
    return { success: false, error: "video blob has no blake3 (cannot pull via iroh)" };
  }
  if (!isP2PRemote(remote)) {
    return { success: false, error: "source remote is not p2p — cannot resolve iroh node id" };
  }
  const sourceNodeId = extractNodeIdStrict(remote.peer_addr);
  if (!sourceNodeId) {
    return { success: false, error: "source remote has no usable iroh node id" };
  }

  try {
    // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
    const { invoke } = await import("@tauri-apps/api/core");

    const sourceTransport = await getTransportForRemote(remote);
    const inlineCache: InlineImageCache = new Map();
    const label = `[video "${video.title}"]`;
    const series = await resolveSeriesContext(video, remote);

    const [videoImagesBody, seriesImagesBody, seasonImagesBody]: SyncImageRefBody[][] =
      await Promise.all([
        inlineImagesForSync(videoImages(video), sourceTransport, inlineCache, label),
        inlineImagesForSync(series.seriesImages, sourceTransport, inlineCache, `${label} [series]`),
        inlineImagesForSync(series.seasonImages, sourceTransport, inlineCache, `${label} [season]`),
      ]);

    const body = {
      blake3,
      sha256: null,
      size: size ?? null,
      // no reliable extension yet (bytes aren't fetched client-side here) -
      // leave the stem alone so grimoire sniffs the real mime after download
      filename: video.title || blobId,
      source_node_id: sourceNodeId,
      source_remote_id: remote.remote_id,
      remote_name: remote.name,
      title: video.title,
      description: video.description ?? null,
      content_type: video.content_type ?? null,
      episode_number: video.episode_number ?? null,
      duration_seconds: video.duration_seconds ?? null,
      release_date: video.release_date ?? null,
      series_title: series.seriesTitle ?? null,
      series_description: series.seriesDescription ?? null,
      season_number: series.seasonNumber ?? null,
      season_title: series.seasonTitle ?? null,
      video_images: videoImagesBody,
      series_images: seriesImagesBody,
      season_images: seasonImagesBody,
    };

    debug(
      "syncVideoViaLocalGrimoire",
      `${label} pulling blake3=${blake3.slice(0, 8)} from ${sourceNodeId.slice(0, 8)} series=${series.seriesTitle ?? "none"} season=${series.seasonNumber ?? "none"} images=${videoImagesBody.length}/${seriesImagesBody.length}/${seasonImagesBody.length} mime=${mime ?? "unknown"}`
    );

    const response = (await invoke("api_call", {
      path: "/api/sync/video-by-blake3",
      body,
    })) as {
      success: boolean;
      message: string;
      errors?: Array<{ error_type: string; title: string; detail: string }>;
      data?: {
        video_id: string;
        media_blob_id: string;
        file_path: string;
        series_id: string | null;
        season_id: string | null;
        existing: boolean;
        images_linked: number;
        missing_image_sha256s: string[];
      };
    };

    if (!response.success) {
      errorLog("videoSync", `sync_video_by_blake3 failed for "${video.title}":`, response.message);
      // same stale-portal-grant case syncSongToLocal.ts translates
      if (response.errors?.some((e) => e.error_type === "stale_doc_portal_path")) {
        return {
          success: false,
          error:
            "fetched media folder is no longer accessible - reselect it in settings > fetched music storage.",
        };
      }
      return { success: false, error: response.message };
    }

    const data = response.data;
    debug(
      "syncVideoViaLocalGrimoire",
      `${label} synced video=${data?.video_id} existing=${data?.existing ?? false} series=${data?.series_id ?? "none"} images_linked=${data?.images_linked ?? 0}`
    );
    return {
      success: true,
      videoId: data?.video_id,
      skipped: data?.existing ?? false,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    errorLog("videoSync", "local grimoire video sync failed:", e);
    return { success: false, error: message };
  }
}
