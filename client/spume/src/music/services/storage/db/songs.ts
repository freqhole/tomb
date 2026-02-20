// song CRUD operations
import { initMusicDB } from "./init";
import type { NewSong, Song } from "../types";
import { STORE_SONGS } from "../types";
import { generateUUID } from "../../../../utils/uuid";
import { debug } from "../../../../utils/logger";

export async function createSong(newSong: NewSong): Promise<Song> {
  const db = await initMusicDB();

  // generate UUID for song
  const songId = generateUUID();

  // create full song object with generated UUID
  const song: Song = {
    ...newSong,
    id: songId,
  };

  // add to IDB
  await db.add(STORE_SONGS, song);

  // sync album_added_at for all songs in this album
  await syncAlbumFields(song.album_id);

  return song;
}

export async function getSongById(songId: string): Promise<Song | undefined> {
  const db = await initMusicDB();
  return db.get(STORE_SONGS, songId);
}

export async function getSongsByIds(songIds: string[]): Promise<Song[]> {
  if (songIds.length === 0) return [];
  const db = await initMusicDB();
  const tx = db.transaction(STORE_SONGS, "readonly");
  const songs = await Promise.all(songIds.map((id) => tx.store.get(id)));
  await tx.done;
  // filter out undefined and preserve order
  return songs.filter((s): s is Song => s != null);
}

export async function getSongBySha256(sha256: string): Promise<Song | undefined> {
  const db = await initMusicDB();
  const index = db.transaction(STORE_SONGS).store.index("by_sha256");
  const song = await index.get(sha256);
  debug(`getSongBySha256(${sha256.slice(0, 8)}...):`, song ? `found song id ${song.id}` : 'not found');
  return song;
}

export async function getSongsByAlbumId(albumId: string): Promise<Song[]> {
  const db = await initMusicDB();
  const index = db.transaction(STORE_SONGS).store.index("by_album_id");
  return index.getAll(albumId);
}

export async function updateSong(
  songId: string,
  updates: Partial<Song>,
): Promise<void> {
  const db = await initMusicDB();
  const existing = await db.get(STORE_SONGS, songId);
  if (!existing) {
    throw new Error(`song not found: ${songId}`);
  }

  const updated = {
    ...existing,
    ...updates,
    updated_at: Date.now(),
  };

  await db.put(STORE_SONGS, updated);
}

export async function deleteSong(songId: string): Promise<void> {
  const db = await initMusicDB();
  await db.delete(STORE_SONGS, songId);
}

// sync album_added_at and album_primary_genre_id for all songs in an album
async function syncAlbumFields(albumId: string): Promise<void> {
  const db = await initMusicDB();

  const allSongsInAlbum = await getSongsByAlbumId(albumId);
  if (allSongsInAlbum.length === 0) return;

  // compute album_added_at: earliest added_at
  const albumAddedAt = Math.min(...allSongsInAlbum.map((s) => s.added_at));

  // compute album_primary_genre_id: most common genre (or null)
  const genreCounts = new Map<string | null, number>();
  for (const song of allSongsInAlbum) {
    const genreId = (song as any).genre_id || null;
    genreCounts.set(genreId, (genreCounts.get(genreId) || 0) + 1);
  }
  let albumPrimaryGenreId: string | null = null;
  let maxCount = 0;
  for (const [genreId, count] of genreCounts) {
    if (count > maxCount) {
      maxCount = count;
      albumPrimaryGenreId = genreId;
    }
  }

  // update all songs in album with synced values
  const tx = db.transaction(STORE_SONGS, "readwrite");
  const store = tx.objectStore(STORE_SONGS);

  for (const song of allSongsInAlbum) {
    const updated = {
      ...song,
      album_added_at: albumAddedAt,
      album_primary_genre_id: albumPrimaryGenreId,
    };
    await store.put(updated);
  }

  await tx.done;
}
