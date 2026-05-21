// sync remote song to local storage
// in browser mode: downloads audio blob to OPFS and creates IDB records
//   (transport handles iroh-blobs verified streaming under the hood)
// in charnel mode: delegates to the local grimoire via the new
//   /api/sync/song-by-blake3 offal route — the local grimoire pulls the
//   audio directly from the source remote's iroh node id by blake3.
//   no base64; no inline audio bytes.

import { getClientForRemote, getTransportForRemote } from "../../../app/api/client";
import { getRemoteById } from "../../../app/services/remotes/remoteManager";
import { isCharnelMode } from "../../../app/services/charnel";
import { extractNodeIdStrict } from "../../../app/services/remotes/peerAddr";
import { isP2PRemote } from "../../../app/services/storage/schemas/remote";
import { debug, warn } from "../../../utils/logger";
import { writeAudioToOPFS } from "../opfs/helpers";
import {
  getOrCreateAlbum,
  getOrCreateArtist,
  initMusicDB,
} from "../storage/db";
import { updateAlbum } from "../storage/db/albums";
import { getOrCreateGenre } from "../storage/db/genres";
import { createTag } from "../storage/db/tags";
import { addAlbumTag, getAlbumTags } from "../storage/db/albumTags";
import { storeBlob } from "../storage/blobs";
import {
  markSongSynced,
  canStartDownload,
  isDownloadInProgress,
  registerDownload,
} from "../download";
import type { ImageMetadata, Song, TaxonRef } from "../storage/types";
import type { Remote } from "../../../app/services/storage/schemas/remote";
import type { Transport } from "freqhole-api-client";

// shape sent to /api/sync/song-by-blake3 for each image. matches grimoire
// `SyncImageRef`. `data_base64` is the inline-bytes path (preferred when
// content is fetched from source); a null `data_base64` means "lookup by
// sha256 on dest" (used when bytes aren't available locally).
interface SyncImageRefBody {
  content_sha256: string;
  data_base64: string | null;
  mime_type: string;
  is_primary: boolean;
  blob_type: string | null;
}

// per-image-bytes cache keyed by source remote_blob_id, so an album cover
// that appears both as song.images[k] AND song.album_images[k] across many
// tracks is fetched once.
type InlineImageCache = Map<
  string,
  { sha256: string; b64: string; mime: string }
>;

function bytesToBase64(bytes: Uint8Array): string {
  // chunked to avoid maximum-call-stack on String.fromCharCode for big arrays.
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", ab);
  const view = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * fetch each image's bytes from the source transport and build inline
 * `SyncImageRef` payloads (sha256 + base64). per-image fetch failures are
 * skipped (logged as warn) so a missing remote_blob_id never blocks song
 * sync. caches by `remote_blob_id` across calls within one sync run.
 */
async function inlineImagesForSync(
  images: ImageMetadata[] | undefined,
  sourceTransport: Transport,
  cache: InlineImageCache,
  logPrefix: string,
): Promise<SyncImageRefBody[]> {
  if (!images || images.length === 0) return [];
  const out: SyncImageRefBody[] = [];
  const anyPrimary = images.some((i) => !!i.is_primary);
  for (let idx = 0; idx < images.length; idx++) {
    const img = images[idx];
    const blobId = img.remote_blob_id;
    if (!blobId) {
      debug(
        "syncSongViaLocalGrimoire",
        `${logPrefix} [img ${idx}] no remote_blob_id, skipping`,
      );
      continue;
    }
    let entry = cache.get(blobId);
    if (!entry) {
      try {
        const blob = await sourceTransport.fetchBlob(blobId);
        const bytes = new Uint8Array(blob.data.byteLength);
        bytes.set(blob.data);
        const sha256 = await sha256Hex(bytes);
        const b64 = bytesToBase64(bytes);
        entry = {
          sha256,
          b64,
          mime: blob.contentType || "image/jpeg",
        };
        cache.set(blobId, entry);
        debug(
          "syncSongViaLocalGrimoire",
          `${logPrefix} [img ${idx}] fetched source blob ${blobId.slice(0, 8)} (${bytes.byteLength}b, ${entry.mime}, sha=${sha256.slice(0, 8)})`,
        );
      } catch (e) {
        warn(
          "syncSongViaLocalGrimoire",
          `${logPrefix} [img ${idx}] fetchBlob failed for ${blobId}: ${String(e)}`,
        );
        continue;
      }
    }
    out.push({
      content_sha256: entry.sha256,
      data_base64: entry.b64,
      mime_type: entry.mime,
      is_primary: anyPrimary ? !!img.is_primary : idx === 0,
      blob_type: img.blob_type ?? "original",
    });
  }
  return out;
}

/**
 * sync a song to the local charnel-managed grimoire via the iroh-blobs path.
 *
 * the local grimoire receives metadata + the source remote's iroh node id,
 * then pulls the audio directly from the source by blake3 (verified). no
 * inline audio bytes are shipped over IPC.
 *
 * requires:
 *  - song.blake3 + song.sha256
 *  - source remote is a p2p remote with a usable peer_addr
 */
async function syncSongViaLocalGrimoire(
  song: SyncableSong,
  remote: Remote,
): Promise<SyncResult> {
  if (!song.blake3) {
    return { success: false, error: "song missing blake3 (cannot pull via iroh)" };
  }
  if (!isP2PRemote(remote)) {
    return {
      success: false,
      error: "source remote is not p2p — cannot resolve iroh node id",
    };
  }
  const sourceNodeId = extractNodeIdStrict(remote.peer_addr);
  if (!sourceNodeId) {
    return { success: false, error: "source remote has no usable iroh node id" };
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");

    // DIAGNOSTIC: log incoming image arrays so we can see whether the source
    // remote actually returned any images for this song / its album.
    debug(
      "syncSongViaLocalGrimoire",
      `song="${song.title}" sha256=${song.sha256.slice(0, 8)} song.images=${song.images?.length ?? 0} album_images=${song.album_images?.length ?? 0} artist_images=${song.artist_images?.length ?? 0}`,
    );
    if (song.images && song.images.length > 0) {
      debug(
        "syncSongViaLocalGrimoire",
        `song.images sample: ${song.images.slice(0, 3).map((i) => `${i.blob_type ?? "?"}:${i.remote_blob_id?.slice(0, 8) ?? "no-rbid"}`).join(", ")}`,
      );
    }

    // pull image bytes from source transport and inline as base64. without
    // this the dest grimoire receives an empty `song_images` array and no
    // images get persisted (audio path uses iroh-blobs but image path is
    // currently inline-base64 only).
    const sourceTransport = await getTransportForRemote(remote);
    const inlineCache: InlineImageCache = new Map();
    const songImagesBody = await inlineImagesForSync(
      song.images,
      sourceTransport,
      inlineCache,
      `[song "${song.title}"]`,
    );
    const albumImagesBody = await inlineImagesForSync(
      song.album_images,
      sourceTransport,
      inlineCache,
      `[album "${song.album_title}"]`,
    );
    debug(
      "syncSongViaLocalGrimoire",
      `inlined ${songImagesBody.length} song_images + ${albumImagesBody.length} album_images for "${song.title}"`,
    );

    // build SyncSongByBlake3Request shape (matches grimoire offal/sync types).
    const body = {
      blake3: song.blake3,
      sha256: song.sha256,
      size: null,
      filename: `${song.title || song.sha256}.bin`,
      source_node_id: sourceNodeId,
      source_remote_id: remote.remote_id,
      remote_name: remote.name,
      title: song.title,
      artist_name: song.artist_name || "unknown artist",
      album_title: song.album_title || "unknown album",
      track_number: song.track_number ?? 0,
      disc_number: song.disc_number ?? 1,
      duration_ms:
        song.duration_seconds != null
          ? Math.round(song.duration_seconds * 1000)
          : null,
      year: song.year ?? null,
      bpm: song.bpm ?? null,
      track_artist: song.track_artist ?? null,
      lyrics: song.lyrics ?? null,
      metadata: song.metadata ?? null,
      genre_name: song.album_taxons?.find((t) => t.kind_slug === "genre")?.label ?? null,
      song_images: songImagesBody,
      album_images: albumImagesBody,
      is_compilation: false,
    };

    const response = (await invoke("api_call", {
      path: "/api/sync/song-by-blake3",
      body,
    })) as {
      success: boolean;
      message: string;
      data?: {
        song_id: string;
        media_blob_id: string;
        file_path: string;
        sha256: string;
        blake3: string;
        existing: boolean;
        images_linked: number;
        missing_image_sha256s: string[];
      };
    };

    if (!response.success) {
      console.error(
        `[syncSongToLocal] sync_song_by_blake3 failed for ${song.title}:`,
        response.message,
      );
      return { success: false, error: response.message };
    }

    const data = response.data;
    markSongSynced(song.sha256);
    debug(
      "syncSongViaLocalGrimoire",
      `synced song ${song.title} via iroh (existing=${data?.existing ?? false}) images_linked=${data?.images_linked ?? 0} missing_image_sha256s=${data?.missing_image_sha256s?.length ?? 0}`,
    );
    if (data?.missing_image_sha256s && data.missing_image_sha256s.length > 0) {
      debug(
        "syncSongViaLocalGrimoire",
        `missing_image_sha256s for "${song.title}": ${data.missing_image_sha256s.slice(0, 5).map((s) => s.slice(0, 8)).join(", ")}`,
      );
    }
    return {
      success: true,
      localSongId: data?.song_id ?? song.sha256,
      localMediaBlobId: data?.media_blob_id,
      localPath: data?.file_path,
      skipped: data?.existing ?? false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`failed to sync song via local grimoire:`, error);
    return { success: false, error: message };
  }
}

/**
 * sync progress callback
 */
export type SyncProgressCallback = (received: number, total: number) => void;

/**
 * result of syncing a song
 */
export interface SyncResult {
  success: boolean;
  localSongId?: string; // sha256, the local song ID
  /// local media_blob.id (the *new* one created/found by the sync,
  /// not the source remote's blob id). only populated by the charnel
  /// path — browser sync stores blobs in OPFS, not the local
  /// grimoire DB, so there's no media_blob row to point at.
  localMediaBlobId?: string;
  /// absolute fs path the local grimoire wrote the audio to. only
  /// populated by the charnel path. callers (e.g. rodioBackend) can
  /// use this directly without re-resolving via `resolve_blob_path`.
  localPath?: string;
  error?: string;
  skipped?: boolean; // true if song already existed locally
}

/**
 * input data for syncing a song - subset of Song with required remote fields
 */
export interface SyncableSong {
  sha256: string;
  media_blob_id?: string;
  title: string;
  artist_name: string;
  artist_id?: string; // optional, used to fetch artist images if not provided
  album_title: string;
  track_number: number;
  disc_number: number;
  duration_seconds: number;
  year?: number | null;
  bpm?: number | null;
  track_artist?: string | null;
  lyrics?: string | null;
  metadata?: string | null;
  images?: ImageMetadata[];
  urls?: Array<{ id?: string; name?: string; url: string }>;
  album_taxons?: TaxonRef[];
  album_images?: ImageMetadata[];
  album_tags?: string[]; // tags from remote album
  artist_images?: ImageMetadata[]; // artist images from remote
  remote_server_id: string;
  remote_song_id?: string | null;
  blake3?: string | null;
  skip_feed_events?: boolean; // skip album feed events when syncing (e.g., playlist songs)
}

/**
 * get file extension from mime type
 */
function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/flac": "flac",
    "audio/x-flac": "flac",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/ogg": "ogg",
    "audio/vorbis": "ogg",
    "audio/aac": "aac",
    "audio/x-aac": "aac",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
  };
  return mimeToExt[mimeType.toLowerCase()] || "mp3";
}

/**
 * download remote images and store them locally in IndexedDB/OPFS.
 * returns ImageMetadata array with local_blob_id set for offline access.
 */
export async function downloadAndStoreImages(
  remote: Remote,
  apiImages: ImageMetadata[] | undefined,
): Promise<ImageMetadata[]> {
  debug(
    "downloadAndStoreImages",
    `remote=${remote.name} count=${apiImages?.length ?? 0}`,
  );
  if (!apiImages?.length) return [];

  const results: ImageMetadata[] = [];
  const transport = await getTransportForRemote(remote);

  for (const img of apiImages) {
    try {
      debug(
        "downloadAndStoreImages",
        `img blob_type=${img.blob_type ?? "?"} remote_blob_id=${img.remote_blob_id?.slice(0, 8) ?? "?"} primary=${!!img.is_primary}`,
      );
      // need remote_blob_id to fetch via transport
      if (!img.remote_blob_id) {
        // keep remote_url reference if we have it
        if (img.remote_url) {
          results.push({
            remote_url: img.remote_url,
            is_primary: img.is_primary,
            blob_type: img.blob_type || "thumbnail",
          });
        }
        continue;
      }

      // fetch via transport (handles P2P vs HTTP)
      const blobUrl = await transport.getBlobUrl(img.remote_blob_id);
      const response = await fetch(blobUrl);

      if (!response.ok) {
        debug("syncSongToLocal", `failed to fetch image ${img.remote_blob_id}: ${response.status}`);
        // keep remote reference as fallback
        results.push({
          remote_url: img.remote_url,
          is_primary: img.is_primary,
          blob_type: img.blob_type || "thumbnail",
          remote_blob_id: img.remote_blob_id,
          remote_server_id: img.remote_server_id,
        });
        continue;
      }

      const blob = await response.blob();
      const mimeType = blob.type || "image/jpeg";

      // store blob locally and get local_blob_id
      const localBlobId = await storeBlob(blob, mimeType);

      results.push({
        local_blob_id: localBlobId,
        remote_url: img.remote_url, // keep as fallback
        is_primary: img.is_primary,
        blob_type: img.blob_type || "thumbnail",
      });

      debug("syncSongToLocal", `stored image ${img.remote_blob_id?.slice(0, 8)}... as local blob ${localBlobId.slice(0, 8)}...`);
    } catch (err) {
      debug("syncSongToLocal", `error downloading image ${img.remote_blob_id}:`, err);
      // keep remote reference as fallback
      results.push({
        remote_url: img.remote_url,
        is_primary: img.is_primary,
        blob_type: img.blob_type || "thumbnail",
        remote_blob_id: img.remote_blob_id,
        remote_server_id: img.remote_server_id,
      });
    }
  }

  return results;
}

/**
 * sync album taxons (genre kind) from remote data to local IDB.
 * creates genre records and sets album.genre_id to the primary (first) genre.
 * non-genre taxons are passed through verbatim onto the local song record so
 * chips still render offline; only genre kinds materialize as local genre rows.
 * returns the primary genre id and the full TaxonRef array for denormalization on songs.
 */
async function syncAlbumTaxons(
  albumId: string,
  remoteTaxons: TaxonRef[] | undefined,
): Promise<{ primaryGenreId: string | null; primaryGenreName: string | null; taxonRefs: TaxonRef[] }> {
  if (!remoteTaxons?.length) {
    return { primaryGenreId: null, primaryGenreName: null, taxonRefs: [] };
  }

  const taxonRefs: TaxonRef[] = [];
  let primaryGenreId: string | null = null;
  let primaryGenreName: string | null = null;

  for (const remoteTaxon of remoteTaxons) {
    if (remoteTaxon.kind_slug === "genre") {
      const localGenre = await getOrCreateGenre(remoteTaxon.label);
      taxonRefs.push({ id: localGenre.genre_id, kind_slug: "genre", label: localGenre.name });
      // first genre is the primary one
      if (!primaryGenreId) {
        primaryGenreId = localGenre.genre_id;
        primaryGenreName = localGenre.name;
      }
    } else {
      // non-genre taxon: pass through verbatim (no local table for these yet)
      taxonRefs.push({ ...remoteTaxon });
    }
  }

  // set album.genre_id to the primary genre
  if (primaryGenreId) {
    await updateAlbum(albumId, { genre_id: primaryGenreId });
  }

  return { primaryGenreId, primaryGenreName, taxonRefs };
}

/**
 * sync a remote song to local storage.
 * downloads the audio blob to OPFS and creates local IDB records.
 * 
 * @param song - the remote song data to sync
 * @param onProgress - optional progress callback for download
 * @returns sync result with success status and local song ID
 */
export async function syncSongToLocal(
  song: SyncableSong,
  onProgress?: SyncProgressCallback,
): Promise<SyncResult> {
  const { sha256, media_blob_id, remote_server_id } = song;

  if (!sha256) {
    return { success: false, error: "song missing sha256" };
  }

  if (!media_blob_id) {
    return { success: false, error: "song missing media_blob_id" };
  }

  if (!remote_server_id) {
    return { success: false, error: "song missing remote_server_id" };
  }

  // check unified download state BEFORE any async work
  // this prevents duplicate downloads when multiple triggers fire
  if (!canStartDownload(sha256)) {
    const reason = isDownloadInProgress(sha256) ? "download in progress" : "already synced";
    debug("syncSongToLocal", `skipping ${sha256.slice(0, 8)}... (${reason})`);
    return { success: true, localSongId: sha256, skipped: true };
  }

  // wrap the actual sync work in a promise we can register
  const syncPromise = (async (): Promise<SyncResult> => {
    try {
      const db = await initMusicDB();

      // double-check DB in case another sync completed between our check and registration
      const existingSong = await db.get("songs", sha256);
      if (existingSong) {
        debug("syncSongToLocal", `song already exists locally: ${sha256.slice(0, 8)}...`);
        return { success: true, localSongId: sha256, skipped: true };
      }

    // get the remote configuration
    const remote = await getRemoteById(remote_server_id);
    if (!remote) {
      return { success: false, error: `remote not found: ${remote_server_id}` };
    }

    debug("syncSongToLocal", `syncing song ${song.title} (${sha256.slice(0, 8)}...) from ${remote.name}`);

    // in charnel mode, delegate to the local grimoire via the iroh-blobs
    // path. the local grimoire pulls audio directly from the source remote's
    // iroh node id by blake3; no audio bytes cross the IPC boundary.
    if (isCharnelMode()) {
      return syncSongViaLocalGrimoire(song, remote);
    }

    // browser mode: fetch via transport and persist to OPFS + IDB.
    // (transport handles iroh-blobs verified streaming under the hood when
    // the remote is p2p and a blake3 is available.)

    // get transport for fetching
    const transport = await getTransportForRemote(remote);

    // get blob metadata for mime type
    const client = await getClientForRemote(remote);
    const metadataResult = await client.music.blobMetadata({ id: media_blob_id });
    
    if (!metadataResult.success || !metadataResult.data) {
      return { success: false, error: `failed to fetch blob metadata for ${media_blob_id}` };
    }

    const blobMetadata = metadataResult.data;
    const mimeType = blobMetadata.mime || "audio/mpeg";
    const extension = getExtensionFromMimeType(mimeType);

    // fetch audio blob via transport (handles P2P vs HTTP)
    let blobUrl: string;
    if (onProgress && transport.getBlobUrlWithProgress) {
      blobUrl = await transport.getBlobUrlWithProgress(media_blob_id, onProgress, song.blake3 ?? undefined);
    } else {
      blobUrl = await transport.getBlobUrl(media_blob_id, song.blake3 ?? undefined);
    }

    // fetch the blob data
    const response = await fetch(blobUrl);
    if (!response.ok) {
      return { success: false, error: `failed to fetch audio blob: ${response.statusText}` };
    }

    const blob = await response.blob();

    // browser mode: save to OPFS and IndexedDB

    // save to OPFS using sha256 as filename
    const opfsPath = await writeAudioToOPFS(blob, sha256, extension);

    // create or get artist record
    const artistRecord = await getOrCreateArtist(song.artist_name || "unknown artist");
    const artistId = artistRecord.artist_id;

    // create or get album record
    const albumRecord = await getOrCreateAlbum(song.album_title || "unknown album", artistId);
    const albumId = albumRecord.album_id;

    // tag album with remote name for discoverability
    const existingTags = await getAlbumTags(albumId);
    const existingTagNames = new Set(existingTags.map(t => t.name));
    
    // add remote name as tag
    if (!existingTagNames.has(remote.name)) {
      const tag = await createTag(remote.name);
      await addAlbumTag(albumId, tag.tag_id);
      debug("syncSongToLocal", `tagged album ${albumId.slice(0, 8)}... with "${remote.name}"`);
    }
    
    // sync album tags from remote
    if (song.album_tags?.length) {
      for (const tagName of song.album_tags) {
        if (!existingTagNames.has(tagName)) {
          const tag = await createTag(tagName);
          await addAlbumTag(albumId, tag.tag_id);
          debug("syncSongToLocal", `synced remote tag "${tagName}" to album ${albumId.slice(0, 8)}...`);
        }
      }
    }

    // download and store images
    const songImages = await downloadAndStoreImages(remote, song.images);
    const albumImages = await downloadAndStoreImages(remote, song.album_images);

    // update album images if we got new ones and album doesn't have any
    if (albumImages.length > 0 && !albumRecord.images?.length) {
      await updateAlbum(albumId, { images: albumImages });
    }

    // sync album taxons (genre kind plus pass-through of others)
    const { primaryGenreId, primaryGenreName, taxonRefs } = await syncAlbumTaxons(
      albumId,
      song.album_taxons,
    );

    // create local song record
    const localSong: Song = {
      id: sha256, // use sha256 as the primary key
      sha256,
      media_blob_id,
      title: song.title || "untitled",
      artist_id: artistId,
      album_id: albumId,
      track_number: song.track_number || 0,
      disc_number: song.disc_number || 1,
      duration_seconds: song.duration_seconds || 0,
      year: song.year ?? null,
      bpm: song.bpm ?? null,
      track_artist: song.track_artist ?? null,
      lyrics: song.lyrics ?? null,
      metadata: song.metadata ?? null,
      created_at: Date.now(),
      updated_at: Date.now(),
      artist_name: song.artist_name || "unknown artist",
      album_title: song.album_title || "unknown album",
      images: songImages.length > 0 ? songImages : undefined,
      // unwrap proxy array before storing in IDB (same pattern as queueHistory.ts)
      urls: song.urls ? song.urls.map((url) => ({ ...url })) : undefined,
      album_added_at: Date.now(),
      album_primary_genre_id: primaryGenreId,
      album_primary_genre_name: primaryGenreName,
      album_taxons: taxonRefs.length > 0 ? taxonRefs : undefined,
      source_type: "synced" as Song["source_type"],
      opfs_path: opfsPath,
      file_name: `${song.title || "untitled"}.${extension}`,
      file_size: blob.size,
      last_modified: Date.now(),
      mime_type: mimeType,
      source_url: null, // not downloaded via HTTP URL
      downloaded_at: Date.now(),
      remote_server_id: null, // no longer remote after sync
      remote_song_id: song.remote_song_id ?? null, // keep for reference
      blake3: song.blake3 ?? null,
      added_at: Date.now(),
    };

    // save to database
    await db.put("songs", localSong);

    // mark as synced in reactive store for UI updates
    markSongSynced(sha256);

    debug("syncSongToLocal", `synced song ${song.title} to local storage`);
    return { success: true, localSongId: sha256 };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`failed to sync song ${song.title}:`, error);
      return { success: false, error: message };
    }
  })();

  // register this download so other callers can check/skip
  registerDownload(sha256, syncPromise as unknown as Promise<void>);

  return syncPromise;
}

/**
 * check if a song can be synced (is remote and has required fields)
 */
export function canSyncSong(song: Song): song is Song & SyncableSong {
  return (
    song.source_type === "remote" &&
    !!song.sha256 &&
    !!song.media_blob_id &&
    !!song.remote_server_id
  );
}
