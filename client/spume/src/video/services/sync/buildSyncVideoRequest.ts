// shared request-body builder for POST /api/sync/video-by-blake3 - used by
// both directions of video sync: syncVideoViaLocalGrimoire.ts (pull a video
// FROM a remote peer INTO local grimoire) and sendVideoToRemote.ts (push a
// local video TO a remote peer). the route itself is symmetric - which
// direction happens is purely a function of which instance you POST to and
// what you pass as `source_node_id` - so both callers share this one
// request-building logic instead of each re-deriving series/season/artist context
// and image inlining independently.
import { getClientForRemote, getMiddenNode } from "../../../app/api/client";
import { isLocalBrowserSourceRemote } from "../../../music/services/send/localBrowserSource";
import { getArtistById, getAlbumById } from "../../../music/services/storage/db";
import { getBlob } from "../../../music/services/storage/blobs";
import type { ImageMetadata } from "../../../music/services/storage/types";
import { getLocalVideoById } from "../storage/db/videos";
import { getLocalVideoSeriesById } from "../storage/db/series";
import { getLocalVideoSeasons } from "../storage/db/seasons";
import { readVideoPosterFromOPFS } from "../opfs/helpers";
import type { Remote } from "../../../app/services/storage/schemas/remote";
import type { QueuedVideo } from "../../../app/services/storage/mediaItem";
import {
  inlineImagesForSync,
  type InlinableImage,
  type InlineImageCache,
  type SyncImageRefBody,
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
  localSeriesImages?: ImageMetadata[];
  localSeasonImages?: ImageMetadata[];
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
  if (isLocalBrowserSourceRemote(metadataRemote)) {
    const series = await getLocalVideoSeriesById(video.series_id);
    if (!series) throw new Error("reviewed series no longer exists locally");
    const season = video.season_id
      ? (await getLocalVideoSeasons(series.id)).find((s) => s.id === video.season_id)
      : undefined;
    if (video.season_id && !season) throw new Error("reviewed season no longer exists locally");
    return {
      seriesTitle: series.title,
      seriesDescription: series.description ?? undefined,
      seasonNumber: season?.season_number,
      seasonTitle: season?.title ?? undefined,
      seriesImages: [],
      seasonImages: [],
      localSeriesImages: series.images,
      localSeasonImages: season?.images,
    };
  }
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

/** artist/album context for a music_video/karaoke video. like series, the
 * destination resolves these by NAME (find-or-create), never by the
 * source's own ids. best-effort - a video with no artist still syncs fine. */
async function resolveMusicContext(
  video: QueuedVideo,
  metadataRemote: Remote
): Promise<{ artistName?: string; albumTitle?: string }> {
  if (!video.artist_id) return {};
  if (isLocalBrowserSourceRemote(metadataRemote)) {
    const [artist, album] = await Promise.all([
      getArtistById(video.artist_id),
      video.album_id ? getAlbumById(video.album_id) : null,
    ]);
    if (!artist || (video.album_id && !album))
      throw new Error("reviewed music link no longer exists locally");
    return { artistName: artist.name, albumTitle: album?.title };
  }
  try {
    const client = await getClientForRemote(metadataRemote);
    const [artist, album] = await Promise.all([
      client.music.getArtist({ id: video.artist_id }),
      video.album_id ? client.music.getAlbum({ id: video.album_id }) : null,
    ]);
    return {
      artistName: artist.success ? artist.data.name : undefined,
      albumTitle: album?.success ? album.data.title : undefined,
    };
  } catch (e) {
    warn("buildSyncVideoRequest", `artist/album lookup failed for ${video.artist_id}:`, e);
    return {};
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

/** the source's parent movie's own content hash (see
 * `Video::parent_video_id`) - never the source's
 * raw `parent_video_id` itself, which is a foreign, meaningless-locally db
 * id on the destination. the destination resolves this blake3 to its own
 * local video id (or stashes it for later, if that movie hasn't
 * synced/imported there yet) - see grimoire's `resolve_sync_parent_video`. */
async function resolveParentBlake3(
  video: QueuedVideo,
  metadataRemote: Remote
): Promise<string | null> {
  if (!video.parent_video_id) return null;
  if (isLocalBrowserSourceRemote(metadataRemote)) {
    const parent = await getLocalVideoById(video.parent_video_id);
    if (!parent?.blake3) throw new Error("parent video has no local content hash");
    return parent.blake3;
  }
  try {
    const client = await getClientForRemote(metadataRemote);
    const result = await client.video.getVideo({ id: video.parent_video_id });
    if (!result.success || !result.data) return null;
    return result.data.blake3 ?? null;
  } catch (e) {
    warn("buildSyncVideoRequest", `parent lookup failed for ${video.parent_video_id}:`, e);
    return null;
  }
}

async function stageLocalImages(
  images: ImageMetadata[] = [],
  fallbackPoster?: () => Promise<Blob>
): Promise<SyncImageRefBody[]> {
  const refs: SyncImageRefBody[] = [];
  const stage = async (blob: Blob, primary: boolean, type: string) => {
    const node = await getMiddenNode();
    if (!node.import_blob) throw new Error("local P2P image storage is unavailable");
    return {
      blake3: await node.import_blob(new Uint8Array(await blob.arrayBuffer())),
      mime_type: blob.type || "image/jpeg",
      is_primary: primary,
      blob_type: type,
    };
  };
  for (const image of images) {
    const blob = image.local_opfs_path
      ? await readVideoPosterFromOPFS(image.local_opfs_path)
      : image.local_blob_id
        ? await getBlob(image.local_blob_id)
        : null;
    if (!blob) throw new Error("video artwork no longer exists locally");
    refs.push(await stage(blob, !!image.is_primary, image.blob_type ?? "original"));
  }
  if (!refs.length && fallbackPoster) {
    refs.push(await stage(await fallbackPoster(), true, "thumbnail"));
  }
  return refs;
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
  const [series, parentBlake3, music] = await Promise.all([
    resolveSeriesContext(video, metadataRemote),
    resolveParentBlake3(video, metadataRemote),
    resolveMusicContext(video, metadataRemote),
  ]);

  const localVideo = isLocalBrowserSourceRemote(metadataRemote)
    ? await getLocalVideoById(video.id)
    : null;
  if (isLocalBrowserSourceRemote(metadataRemote) && !localVideo) {
    throw new Error("video no longer exists locally");
  }
  const [videoImagesBody, seriesImagesBody, seasonImagesBody] = localVideo
    ? await Promise.all([
        stageLocalImages(
          localVideo.images,
          localVideo.poster_opfs_path
            ? () => readVideoPosterFromOPFS(localVideo.poster_opfs_path!)
            : undefined
        ),
        stageLocalImages(series.localSeriesImages),
        stageLocalImages(series.localSeasonImages),
      ])
    : await Promise.all([
        inlineImagesForSync(videoImages(video), sourceTransport, inlineCache, label),
        inlineImagesForSync(series.seriesImages, sourceTransport, inlineCache, `${label} [series]`),
        inlineImagesForSync(series.seasonImages, sourceTransport, inlineCache, `${label} [season]`),
      ]);

  return {
    blake3: opts.blake3,
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
    artist_name: music.artistName ?? null,
    album_title: music.albumTitle ?? null,
    parent_blake3: parentBlake3,
    video_images: videoImagesBody,
    series_images: seriesImagesBody,
    season_images: seasonImagesBody,
  };
}
