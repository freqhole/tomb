// local (IndexedDB) equivalent of grimoire's import_blobz +
// import_session_send_targetz review flow - see LocalImportReviewSession/
// LocalImportReviewBlob doc comments in ../types for the schema, and
// grimoire/src/music/entities/import_review/repository.rs for the
// server-side counterpart this mirrors method-for-method (list pending
// sessions, get a session's pending albums, mark an album reviewed,
// merge albums, move a song) so useImportReview.ts can drive either
// backend through the same shape.
import { initMusicDB } from "./init";
import { getAlbumById, getOrCreateAlbum, deleteAlbum, updateAlbum } from "./albums";
import { getOrCreateArtist, findArtistByName } from "./artists";
import { getSongById, getSongsByIds, updateSong } from "./songs";
import {
  STORE_IMPORT_REVIEW_BLOBZ,
  STORE_IMPORT_REVIEW_SESSIONZ,
  STORE_SONGS,
  type LocalImportReviewBlob,
  type LocalImportReviewSession,
} from "../types";
import type {
  ImportReviewAlbum,
  ImportReviewSong,
} from "../../../../components/import/ImportGroupingView";

export interface LocalImportReviewSendTarget {
  remoteId: string;
  remoteName: string;
}

/** start a new local-first import batch, optionally tagged with the
 * remote its reviewed output should be sent to once review completes. */
export async function createLocalImportSession(
  target?: LocalImportReviewSendTarget
): Promise<string> {
  const db = await initMusicDB();
  const session: LocalImportReviewSession = {
    session_id: crypto.randomUUID(),
    created_at: Date.now(),
    target_remote_id: target?.remoteId ?? null,
    target_remote_name: target?.remoteName ?? null,
  };
  await db.put(STORE_IMPORT_REVIEW_SESSIONZ, session);
  return session.session_id;
}

/** look up one session's own metadata (created_at, send target) - used
 * to render the "send to X" button label without re-deriving it from
 * the pending-blob list. */
export async function getLocalImportSession(
  sessionId: string
): Promise<LocalImportReviewSession | undefined> {
  const db = await initMusicDB();
  return db.get(STORE_IMPORT_REVIEW_SESSIONZ, sessionId);
}

/** record that `songId` (just imported) belongs to `sessionId` and still
 * needs review - mirrors grimoire's insert_import_blob. */
export async function recordLocalImportBlob(sessionId: string, songId: string): Promise<void> {
  const db = await initMusicDB();
  const row: LocalImportReviewBlob = {
    song_id: songId,
    session_id: sessionId,
    reviewed_at: null,
    created_at: Date.now(),
  };
  await db.put(STORE_IMPORT_REVIEW_BLOBZ, row);
}

/** every session with at least one still-pending (unreviewed) song whose
 * song row still exists - mirrors list_pending_sessions. */
export async function listLocalPendingSessions(): Promise<LocalImportReviewSession[]> {
  const db = await initMusicDB();
  const allBlobz = await db.getAll(STORE_IMPORT_REVIEW_BLOBZ);
  const pendingSessionIds = new Set<string>();
  for (const b of allBlobz as LocalImportReviewBlob[]) {
    if (b.reviewed_at == null) pendingSessionIds.add(b.session_id);
  }
  if (pendingSessionIds.size === 0) return [];

  const sessions: LocalImportReviewSession[] = [];
  for (const sid of pendingSessionIds) {
    // a session only counts as "pending" if it still has at least one
    // live song attached - a song deleted after import shouldn't leave a
    // permanently-stuck review card.
    const albums = await getLocalSessionAlbums(sid);
    if (albums.length === 0) continue;
    const session = await db.get(STORE_IMPORT_REVIEW_SESSIONZ, sid);
    if (session) sessions.push(session as LocalImportReviewSession);
  }
  sessions.sort((a, b) => b.created_at - a.created_at);
  return sessions;
}

/** pending albums (with full song lists) for one session - mirrors
 * list_pending_albums_for_session, reshaped into the same
 * `ImportReviewAlbum[]` the review UI already renders for grimoire. */
export async function getLocalSessionAlbums(sessionId: string): Promise<ImportReviewAlbum[]> {
  const db = await initMusicDB();
  const blobz = (await db.getAllFromIndex(
    STORE_IMPORT_REVIEW_BLOBZ,
    "by_session_id",
    sessionId
  )) as LocalImportReviewBlob[];
  const pendingSongIds = blobz.filter((b) => b.reviewed_at == null).map((b) => b.song_id);
  if (pendingSongIds.length === 0) return [];

  const songs = await getSongsByIds(pendingSongIds);
  const byAlbum = new Map<string, typeof songs>();
  for (const song of songs) {
    const list = byAlbum.get(song.album_id);
    if (list) list.push(song);
    else byAlbum.set(song.album_id, [song]);
  }

  const result: ImportReviewAlbum[] = [];
  for (const [albumId, albumSongs] of byAlbum) {
    const album = await getAlbumById(albumId);
    const reviewSongs: ImportReviewSong[] = albumSongs
      .sort((a, b) => a.disc_number - b.disc_number || a.track_number - b.track_number)
      .map((s) => ({
        id: s.id,
        title: s.title,
        trackNumber: s.track_number,
        discNumber: s.disc_number,
        durationSeconds: s.duration_seconds,
      }));
    const primaryImage = album?.images?.find((img) => img.is_primary) ?? album?.images?.[0];
    result.push({
      id: albumId,
      title: album?.title ?? albumSongs[0]?.album_title ?? "unknown album",
      artist: albumSongs[0]?.artist_name ?? null,
      artistId: album?.artist_id ?? null,
      artworkBlobId: primaryImage?.local_blob_id ?? null,
      images: album?.images,
      releaseDate: album?.release_date ?? null,
      label: album?.label ?? null,
      albumType: album?.album_type ?? null,
      songs: reviewSongs,
    });
  }
  result.sort((a, b) => a.title.localeCompare(b.title));
  return result;
}

/** mark every pending blob for `albumId` within `sessionId` reviewed -
 * mirrors mark_album_reviewed. */
export async function markLocalAlbumReviewed(sessionId: string, albumId: string): Promise<void> {
  const db = await initMusicDB();
  const blobz = (await db.getAllFromIndex(
    STORE_IMPORT_REVIEW_BLOBZ,
    "by_session_id",
    sessionId
  )) as LocalImportReviewBlob[];
  const pending = blobz.filter((b) => b.reviewed_at == null);
  if (pending.length === 0) return;

  const songs = await getSongsByIds(pending.map((b) => b.song_id));
  const songsInAlbum = new Set(songs.filter((s) => s.album_id === albumId).map((s) => s.id));
  if (songsInAlbum.size === 0) return;

  const tx = db.transaction(STORE_IMPORT_REVIEW_BLOBZ, "readwrite");
  const now = Date.now();
  await Promise.all(
    pending
      .filter((b) => songsInAlbum.has(b.song_id))
      .map((b) => tx.store.put({ ...b, reviewed_at: now }))
  );
  await tx.done;
}

/** merge `sourceIds` albums into `targetId` - reassigns every song, then
 * deletes the now-empty source albums. mirrors merge_albums_review
 * (session_id isn't needed locally - there's no server-side ACL to scope
 * it against). */
export async function mergeLocalAlbums(sourceIds: string[], targetId: string): Promise<void> {
  const target = await getAlbumById(targetId);
  if (!target) throw new Error(`target album not found: ${targetId}`);

  for (const sourceId of sourceIds) {
    if (sourceId === targetId) continue;
    const db = await initMusicDB();
    const index = db.transaction(STORE_SONGS).store.index("by_album_id");
    const songsInSource = await index.getAll(sourceId);
    for (const song of songsInSource) {
      await updateSong(song.id, {
        album_id: targetId,
        album_title: target.title,
        artist_id: target.artist_id ?? song.artist_id,
        artist_name: song.artist_name,
      });
    }
    await deleteAlbum(sourceId);
  }
}

/** move one song to `toAlbumId` (existing album), or to a brand-new
 * album named `newAlbumTitle` (find-or-create, same dedup as normal
 * import) when `toAlbumId` is omitted - mirrors move_song_review. */
export async function moveLocalSong(
  songId: string,
  toAlbumId: string | null,
  newAlbumTitle?: string | null,
  newAlbumArtistName?: string | null
): Promise<void> {
  const song = await getSongById(songId);
  if (!song) throw new Error(`song not found: ${songId}`);

  let destAlbumId = toAlbumId;
  let destAlbumTitle: string | undefined;
  let destArtistId: string | undefined;
  let destArtistName: string | undefined;

  if (!destAlbumId && newAlbumTitle) {
    const artist = await getOrCreateArtist(newAlbumArtistName || "Unknown Artist");
    const album = await getOrCreateAlbum(newAlbumTitle, artist.artist_id);
    destAlbumId = album.album_id;
    destAlbumTitle = album.title;
    destArtistId = artist.artist_id;
    destArtistName = artist.name;
  } else if (destAlbumId) {
    const album = await getAlbumById(destAlbumId);
    if (!album) throw new Error(`album not found: ${destAlbumId}`);
    destAlbumTitle = album.title;
    destArtistId = album.artist_id ?? undefined;
  }

  if (!destAlbumId) throw new Error("must provide either toAlbumId or newAlbumTitle");

  await updateSong(songId, {
    album_id: destAlbumId,
    album_title: destAlbumTitle,
    ...(destArtistId ? { artist_id: destArtistId } : {}),
    ...(destArtistName ? { artist_name: destArtistName } : {}),
  });

  // the review blob row just needs to keep pointing at the song - its
  // album is resolved fresh (via getSongsByIds) every time
  // getLocalSessionAlbums runs, so no update needed there.
}

export interface LocalSongReviewPatch {
  songId: string;
  title?: string | null;
  trackNumber?: number | null;
  discNumber?: number | null;
  trackArtist?: string | null;
}

export interface LocalAlbumReviewPatch {
  title?: string | null;
  artistId?: string | null;
  artistName?: string | null;
  albumType?: string | null;
  releaseDate?: string | null;
  label?: string | null;
  songs?: LocalSongReviewPatch[];
}

/** patch an album's metadata (and optionally per-song fields) during
 * review - mirrors patch_album_review. only fields that are set are
 * updated, same as the grimoire route. */
export async function patchLocalAlbum(albumId: string, req: LocalAlbumReviewPatch): Promise<void> {
  const album = await getAlbumById(albumId);
  if (!album) throw new Error(`album not found: ${albumId}`);

  let artistId = album.artist_id ?? undefined;
  let artistName: string | undefined;
  if (req.artistId) {
    artistId = req.artistId;
  } else if (req.artistName) {
    const artist =
      (await findArtistByName(req.artistName)) ?? (await getOrCreateArtist(req.artistName));
    artistId = artist.artist_id;
    artistName = artist.name;
  }

  await updateAlbum(albumId, {
    ...(req.title !== undefined && req.title !== null ? { title: req.title } : {}),
    ...(artistId ? { artist_id: artistId } : {}),
    ...(req.albumType !== undefined && req.albumType !== null ? { album_type: req.albumType } : {}),
    ...(req.releaseDate !== undefined ? { release_date: req.releaseDate } : {}),
    ...(req.label !== undefined ? { label: req.label } : {}),
  });

  if (req.songs) {
    for (const patch of req.songs) {
      await updateSong(patch.songId, {
        ...(patch.title !== undefined && patch.title !== null ? { title: patch.title } : {}),
        ...(patch.trackNumber !== undefined && patch.trackNumber !== null
          ? { track_number: patch.trackNumber }
          : {}),
        ...(patch.discNumber !== undefined && patch.discNumber !== null
          ? { disc_number: patch.discNumber }
          : {}),
        ...(patch.trackArtist !== undefined ? { track_artist: patch.trackArtist } : {}),
        ...(req.title ? { album_title: req.title } : {}),
        ...(artistName ? { artist_name: artistName } : {}),
      });
    }
  } else if (req.title || artistName) {
    // no per-song patch list, but the album/artist changed - keep every
    // song's denormalized album_title/artist_name in sync (mirrors what
    // grimoire's album update does to its own songz rows).
    const db = await initMusicDB();
    const index = db.transaction(STORE_SONGS).store.index("by_album_id");
    const songs = await index.getAll(albumId);
    for (const song of songs) {
      await updateSong(song.id, {
        ...(req.title ? { album_title: req.title } : {}),
        ...(artistName ? { artist_name: artistName } : {}),
      });
    }
  }
}
