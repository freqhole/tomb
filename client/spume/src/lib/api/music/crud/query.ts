// mirrors grimoire/src/music/crud/query.rs's query_songs() - browser-side
// implementation backed by spume's own IDB `Song` store instead of
// grimoire's sqlite views. see docs/cenotaph-migration-plan.md phase 3,
// tier 2 for what's deliberately supported vs. deferred.

import type { QueryParams, SongQueryResult, SongsQueryResult } from "@freqhole/api-client";
import { getSongByBlake3 } from "../../../../music/services/storage/db/songs";
import type { Song } from "../../../../music/services/storage/types";
import { stageAndMapImages } from "../../images";

/** the id every song is keyed by on the wire: prefer blake3 (enables
 * iroh-blobs verified download), fall back to sha256 for songs that
 * predate the blake3 backfill (see storage/db/init.ts's `by_blake3`
 * index migration notes). */
function blobIdFor(song: Song): string {
  return song.blake3 ?? song.sha256;
}

/** maps a local, denormalized `Song` (artist/album/genre/taxon/tag fields
 * all already live directly on the row - no store joins needed) into
 * grimoire's `SongQueryResult` shape. */
export async function songToQueryResult(song: Song): Promise<SongQueryResult> {
  const [songImages, artistImages, albumImages] = await Promise.all([
    stageAndMapImages(song.images),
    stageAndMapImages(song.artist_images),
    stageAndMapImages(song.album_images),
  ]);

  return {
    song: {
      id: song.id,
      media_blob_id: blobIdFor(song),
      images: songImages,
      urls: song.urls,
      title: song.title,
      track_number: song.track_number,
      disc_number: song.disc_number,
      duration: song.duration_seconds,
      bpm: song.bpm ?? undefined,
      track_artist: song.track_artist ?? undefined,
      metadata: song.metadata ?? undefined,
      lyrics: song.lyrics ?? undefined,
      created_at: song.created_at,
      updated_at: song.updated_at,
    },
    artist: {
      id: song.artist_id,
      name: song.artist_name,
      images: artistImages,
      created_at: song.created_at,
      updated_at: song.updated_at,
    },
    album: {
      id: song.album_id,
      title: song.album_title,
      album_type: song.album_type ?? "album",
      taxons: song.album_taxons,
      images: albumImages,
      song_count: 0, // unknown at this scope - not read by adaptSongFromAPI
      total_duration: 0, // unknown at this scope - not read by adaptSongFromAPI
      created_at: song.created_at,
      updated_at: song.updated_at,
    },
    genre: song.album_primary_genre_name
      ? {
          id: song.album_primary_genre_id ?? "",
          name: song.album_primary_genre_name,
          created_at: song.created_at,
        }
      : undefined,
    media_blob: {
      id: blobIdFor(song),
      sha256: song.sha256,
      size: song.file_size ?? undefined,
      mime: song.mime_type ?? undefined,
      blob_type: "original",
      metadata: undefined,
      created_at: song.created_at,
      updated_at: song.updated_at,
      blake3: song.blake3 ?? undefined,
    },
    is_favorite: song.is_favorite ?? false,
    rating: song.user_rating,
    album_is_favorite: song.album_is_favorite ?? false,
    album_rating: song.album_rating,
    album_tags: song.album_tags,
  };
}

/**
 * query songs.
 *
 * grimoire's real `filters` object supports a much richer set of keys
 * (artist_id/album_id/genre/taxon_id/tag filters/etc - see grimoire's
 * `add_global_filters()`) than this browser implementation does today.
 * `filters` is open-ended JSON on the wire either way (`QueryParams.filters:
 * z.record(z.string(), z.any())`), so this is a forward-compatible partial
 * implementation, not a contract change: **only `filters.blake3` (a single
 * song's media blake3 hash) is supported right now** - the one lookup
 * cenotaph's tier-2 sync actually needs. anything else returns an empty
 * result rather than an error, so a caller that doesn't yet know it's
 * talking to a browser peer degrades gracefully instead of throwing.
 */
export async function querySongs(params: Partial<QueryParams>): Promise<SongsQueryResult> {
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  const emptyResult: SongsQueryResult = {
    items: [],
    total_count: 0,
    has_more: false,
    limit,
    offset,
  };

  const blake3 = params.filters?.blake3;
  if (typeof blake3 !== "string" || blake3.length === 0) {
    return emptyResult;
  }

  const song = await getSongByBlake3(blake3);
  if (!song) return emptyResult;

  return {
    items: [await songToQueryResult(song)],
    total_count: 1,
    has_more: false,
    limit,
    offset,
  };
}
