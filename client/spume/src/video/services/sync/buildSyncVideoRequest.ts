// shared request-body builder for POST /api/sync/video-by-blake3 - used by
// both directions of video sync: syncVideoViaLocalGrimoire.ts (pull a video
// FROM a remote peer INTO local grimoire) and sendVideoToRemote.ts (push a
// local video TO a remote peer). the route itself is symmetric - which
// direction happens is purely a function of which instance you POST to and
// what you pass as `source_node_id` - so both callers share this one
// request-building logic instead of each re-deriving series/season context
// and image inlining independently.
import { getClientForRemote } from "../../../app/api/client";
import type { Remote } from "../../../app/services/storage/schemas/remote";
import type { QueuedVideo } from "../../../app/services/storage/mediaItem";
import {
  inlineImagesForSync,
  type InlinableImage,
  type InlineImageCache,
} from "../../../music/services/sync/syncImages";
import type { SyncVideoByBlake3Request, Transport } from "@freqhole/api-client";
import { warn } from "../../../utils/logger";

/** series/season context for a video, resolved from wherever its metadata
 *  currently lives. all fields are best-effort - a video with no series
 *  still syncs fine. */
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
 * ids, so those have to be looked up on whichever remote holds the video's
 * current metadata before syncing. */
async function resolveSeriesContext(
  video: QueuedVideo,
  metadataRemote: Remote
): Promise<SeriesContext> {
  if (!video.series_id) return EMPTY_SERIES_CONTEXT;
  try {
    const client = await getClientForRemote(metadataRemote);
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
    warn("buildSyncVideoRequest", `series lookup failed for ${video.series_id}:`, e);
    return EMPTY_SERIES_CONTEXT;
  }
}

/** the video's own poster, plus any other images its metadata lists for it. */
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

export interface BuildSyncVideoByBlake3Options {
  video: QueuedVideo;
  /** remote holding the video's current metadata - used to resolve its
   *  series/season context. for a pull, this is the remote peer being
   *  pulled from; for a push, this is wherever the video's metadata
   *  actually lives (its own local/charnel-managed instance). */
  metadataRemote: Remote;
  /** transport to fetch image bytes from (same remote as `metadataRemote`
   *  in practice, but kept separate since callers already have one in hand). */
  sourceTransport: Transport;
  blake3: string;
  sha256?: string | null;
  size?: number | null;
  filename: string;
  sourceNodeId: string;
  sourceRemoteId?: string | null;
  remoteName?: string | null;
}

/** build the full request body for POST /api/sync/video-by-blake3. */
export async function buildSyncVideoByBlake3Body(
  opts: BuildSyncVideoByBlake3Options
): Promise<SyncVideoByBlake3Request> {
  const { video, metadataRemote, sourceTransport } = opts;
  const inlineCache: InlineImageCache = new Map();
  const label = `[video "${video.title}"]`;
  const series = await resolveSeriesContext(video, metadataRemote);

  const [videoImagesBody, seriesImagesBody, seasonImagesBody] = await Promise.all([
    inlineImagesForSync(videoImages(video), sourceTransport, inlineCache, label),
    inlineImagesForSync(series.seriesImages, sourceTransport, inlineCache, `${label} [series]`),
    inlineImagesForSync(series.seasonImages, sourceTransport, inlineCache, `${label} [season]`),
  ]);

  return {
    blake3: opts.blake3,
    sha256: opts.sha256 ?? null,
    size: opts.size ?? null,
    filename: opts.filename,
    source_node_id: opts.sourceNodeId,
    source_remote_id: opts.sourceRemoteId ?? null,
    remote_name: opts.remoteName ?? null,
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
}
