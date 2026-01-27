// file processing service - extract metadata from audio files
import { parseBlob } from "music-metadata";
import {
  getFileExtension,
  isOPFSSupported,
  writeAudioToOPFS,
} from "../opfs/helpers";
import {
  getOrCreateAlbum,
  getOrCreateArtist,
  getOrCreateGenre,
  getSongsByAlbumId,
} from "../storage/db";
import type { NewSong, Song } from "../storage/types";

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
  key_signature?: string;
}

// extract metadata from audio file
export async function extractMetadata(file: File): Promise<AudioMetadata> {
  const [tags, duration] = await Promise.all([
    readID3Tags(file),
    getAudioDuration(file),
  ]);

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
    key_signature: tags.key_signature,
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
  key_signature?: string;
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
      key_signature: metadata.common.key,
    };
  } catch (error) {
    // if tag reading fails, return empty object
    console.error("failed to read metadata:", error);
    return {};
  }
}

// get audio duration by loading file in audio element
async function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);

    audio.addEventListener("loadedmetadata", () => {
      URL.revokeObjectURL(url);
      resolve(audio.duration);
    });

    audio.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      // fallback to 0 if duration can't be read
      resolve(0);
    });

    audio.src = url;
  });
}

// create song object from file (with normalized schema)
export async function processMusicFile(
  file: File,
  songId: string,
): Promise<NewSong> {
  const metadata = await extractMetadata(file);

  // check opfs support
  if (!isOPFSSupported()) {
    throw new Error("opfs not supported in this browser");
  }

  // write file to opfs
  console.log(`writing to opfs: ${file.name}`);
  const extension = getFileExtension(metadata.mime_type, file.name);
  const opfsPath = await writeAudioToOPFS(file, songId, extension);

  // create or get artist
  const artist = await getOrCreateArtist(metadata.artist);

  // create or get album (linked to artist)
  const album = await getOrCreateAlbum(metadata.album, artist.artist_id);

  // create or get genre if present
  let genreId: string | null = null;
  if (metadata.genre) {
    const genre = await getOrCreateGenre(metadata.genre);
    genreId = genre.genre_id;

    // also link genre to album if album doesn't have one yet
    // TODO: update album.genre_id if null
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
    sha256: songId,
    title: metadata.title,
    artist_id: artist.artist_id,
    album_id: album.album_id,
    track_number: metadata.track_number ?? 0,
    disc_number: metadata.disc_number ?? 1,
    duration_seconds: metadata.duration_seconds,
    year: metadata.year ?? null,
    bpm: metadata.bpm ?? null,
    key_signature: metadata.key_signature ?? null,
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
    remote_sha256: null,

    added_at: now,
  };

  return song;
}

// batch process multiple files
export async function processMusicFiles(
  files: FileList | File[],
  songIds: string[],
): Promise<NewSong[]> {
  const fileArray = Array.from(files);

  if (fileArray.length !== songIds.length) {
    throw new Error("files and songIds arrays must have same length");
  }

  const results = await Promise.all(
    fileArray.map((file, index) => processMusicFile(file, songIds[index])),
  );
  return results;
}
