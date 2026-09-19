// file processing service - extract metadata from audio files
import { parseBlob } from "music-metadata";
import { getFileExtension, isOPFSSupported, writeAudioToOPFS } from "../services/opfs/helpers";
import {
  getOrCreateAlbum,
  getOrCreateArtist,
  getOrCreateGenre,
  getSongsByAlbumId,
} from "../services/storage/db";
import type { NewSong } from "../services/storage/types";
import { debug, warn } from "../../utils/logger";
import { getMiddenNode } from "../../app/api/client";
import { isCharnelMode } from "../../app/services/charnel";

/** best-effort: register `file`'s bytes with this browser's own midden
 * node, returning the blake3 hash on success. this is what makes a
 * purely-local (never-uploaded) song servable to a remote's iroh-blobs
 * pull later on (see "send to remote" after review) - without it,
 * `blake3` stays null and the song can only ever live in this browser.
 * never called under charnel (its own local grimoire instance handles
 * blake3 registration itself - see grimoire's blobz/blake3.rs), and any
 * failure here (relay unavailable, node not ready yet) just leaves the
 * song without a blake3 rather than failing the import.
 *
 * streams the file into midden's chunked `ImportSession` (`start_import`)
 * instead of reading it whole via `file.arrayBuffer()` first - mirrors
 * `playerQueuePush.ts`'s `fetchAndImportStreaming` (the wasm chunked
 * branch), the established pattern for this exact primitive. falls back
 * to the one-shot `import_blob(bytes)` only when this node build predates
 * `start_import` - see docs/blob-transfer-opfs-and-sha256-refactor-plan.md
 * phase 5. */
async function registerBlake3(file: File): Promise<string | null> {
  if (isCharnelMode()) return null;
  try {
    const node = await getMiddenNode();
    if (!node.start_import) {
      if (!node.import_blob) return null;
      const bytes = new Uint8Array(await file.arrayBuffer());
      return await node.import_blob(bytes);
    }
    const session = node.start_import();
    const reader = file.stream().getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await session.push(value);
      }
      return await session.finish();
    } catch (err) {
      session.abort();
      throw err;
    } finally {
      reader.releaseLock();
    }
  } catch (err) {
    warn("fileProcessor", `failed to register blake3 for ${file.name}:`, err);
    return null;
  }
}

export interface AudioMetadata {
  title: string;
  artist: string;
  album: string;
  genre?: string;
  year?: number;
  track_number?: number;
  disc_number?: number;
  duration_seconds: number;
  mime_type: string;
  bpm?: number;
}

// extract metadata from audio file
export async function extractMetadata(file: File): Promise<AudioMetadata> {
  const [tags, duration] = await Promise.all([readID3Tags(file), getAudioDuration(file)]);

  return {
    title: tags.title || file.name.replace(/\.[^/.]+$/, ""), // fallback to filename without extension
    artist: tags.artist || "unknown artist",
    album: tags.album || "unknown album",
    genre: tags.genre,
    year: tags.year,
    track_number: tags.track_number,
    disc_number: tags.disc_number,
    duration_seconds: duration,
    mime_type: file.type || "audio/mpeg",
    bpm: tags.bpm,
  };
}

// read metadata tags from file
async function readID3Tags(file: File): Promise<{
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: number;
  track_number?: number;
  disc_number?: number;
  bpm?: number;
}> {
  try {
    const metadata = await parseBlob(file);
    return {
      title: metadata.common.title,
      artist: metadata.common.artist,
      album: metadata.common.album,
      genre: metadata.common.genre?.[0],
      year: metadata.common.year,
      track_number: metadata.common.track?.no ?? undefined,
      disc_number: metadata.common.disk?.no ?? undefined,
      bpm: metadata.common.bpm,
    };
  } catch (error) {
    // if tag reading fails, return empty object
    console.error("failed to read metadata:", error);
    return {};
  }
}

// get audio duration by loading file in audio element
async function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, _reject) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);

    audio.addEventListener("loadedmetadata", () => {
      URL.revokeObjectURL(url);
      // round to integer seconds to avoid floating point precision issues
      resolve(Math.round(audio.duration));
    });

    audio.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      // fallback to 0 if duration can't be read
      resolve(0);
    });

    audio.src = url;
  });
}

// create song object from file (with normalized schema).
//
// `opfsKey` is an opaque per-file storage key for the OPFS filename ONLY
// (e.g. `audio/<opfsKey>.mp3`) - it is NOT a content hash and is never
// stored as `Song.sha256`. this is part of the ongoing, deliberately
// incremental sha256->blake3 deprecation (see
// docs/blob-transfer-opfs-and-sha256-refactor-plan.md phase 7 and
// /memories/repo/tomb-sha256-vs-blake3-vs-id.md): a fresh local import no
// longer runs a whole-file crypto.subtle.digest just to mint an OPFS
// filename - the caller (localImport.ts) just generates a random id for
// that purpose, same as `Song.id` itself. `sha256` is left as `""` (the
// same "unknown, not computed" sentinel grimoire's own sync routes
// already accept - see phase 3) and `blake3` (computed just below via
// `registerBlake3`, streaming, no full-file buffer) is the song's real
// content identity from here on - see audioAccess.ts's
// `songTrackingKey()` for where callers should prefer it over `sha256`.
//
// tradeoff, written down on purpose so it isn't rediscovered the hard
// way later: this means the local-import dedup check (localImport.ts's
// `getSongBySha256`, still real for OLDER songs that have a genuine
// stored sha256 from before this change) can no longer catch "this exact
// file was already imported" for a very old, pre-blake3 song - the
// blake3 pre-check earlier in localImport.ts only matches against rows
// that already HAVE a blake3 stored. narrow, rare edge case (needs a song
// imported before blake3 support existed, re-imported unchanged today) -
// accepted deliberately rather than keep paying for a whole-file sha256
// read on every import to guard against it.
export async function processMusicFile(file: File, opfsKey: string): Promise<NewSong> {
  const metadata = await extractMetadata(file);

  // check opfs support
  if (!isOPFSSupported()) {
    throw new Error("opfs not supported in this browser");
  }

  // write file to opfs
  debug("fileProcessor", `writing to opfs: ${file.name}`);
  const extension = getFileExtension(metadata.mime_type, file.name);
  const opfsPath = await writeAudioToOPFS(file, opfsKey, extension);

  // best-effort - lets this song be sent to a remote later without
  // re-reading the file (see registerBlake3 doc comment above).
  const blake3 = await registerBlake3(file);

  // create or get artist
  const artist = await getOrCreateArtist(metadata.artist);

  // create or get album (linked to artist)
  const album = await getOrCreateAlbum(metadata.album, artist.artist_id);

  // create or get genre if present
  if (metadata.genre) {
    await getOrCreateGenre(metadata.genre);
    // TODO: link genre to album if album doesn't have one yet
  }

  const now = Date.now();

  // compute album_added_at: if this is first song in album, use now; otherwise use album's earliest added_at
  const existingSongsInAlbum = await getSongsByAlbumId(album.album_id);
  const albumAddedAt =
    existingSongsInAlbum.length > 0
      ? Math.min(...existingSongsInAlbum.map((s) => s.added_at), now)
      : now;

  // compute album_primary_genre_id: will be set to genre_id if we had one, or null
  // for now, just use null (genre detection not implemented yet)
  const albumPrimaryGenreId: string | null = null;

  const song: NewSong = {
    // "" = not computed for this song - see this function's doc comment.
    // prefer `blake3` (right below) for anything that needs a real
    // content-based identity.
    sha256: "",
    title: metadata.title,
    artist_id: artist.artist_id,
    album_id: album.album_id,
    track_number: metadata.track_number ?? 0,
    disc_number: metadata.disc_number ?? 1,
    duration_seconds: metadata.duration_seconds,
    year: metadata.year ?? null,
    bpm: metadata.bpm ?? null,
    track_artist: null,
    lyrics: null,
    metadata: null, // could store full metadata as json string if needed
    created_at: now,
    updated_at: now,

    // denormalized for quick access
    artist_name: artist.name,
    album_title: album.title,

    // denormalized for album-grouped sorting (songs always grouped by album then disc/track)
    album_added_at: albumAddedAt,
    album_primary_genre_id: albumPrimaryGenreId,

    // source information
    source_type: "local",
    opfs_path: opfsPath,
    file_name: file.name,
    file_size: file.size,
    last_modified: file.lastModified,
    mime_type: metadata.mime_type,

    // not used for local files
    source_url: null,
    downloaded_at: null,
    remote_server_id: null,
    remote_song_id: null,
    blake3,

    added_at: now,
  };

  return song;
}

// batch process multiple files. `opfsKeys` are opaque per-file storage
// keys (see processMusicFile's doc comment) - NOT content hashes.
export async function processMusicFiles(
  files: FileList | File[],
  opfsKeys: string[]
): Promise<NewSong[]> {
  const fileArray = Array.from(files);

  if (fileArray.length !== opfsKeys.length) {
    throw new Error("files and opfsKeys arrays must have same length");
  }

  const results = await Promise.all(
    fileArray.map((file, index) => processMusicFile(file, opfsKeys[index]))
  );
  return results;
}
