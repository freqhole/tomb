// album CRUD operations
import { initMusicDB } from "./init";
import type { Album } from "../types";
import { STORE_ALBUMS, STORE_SONGS } from "../types";

export async function createAlbum(album: Album): Promise<void> {
  const db = await initMusicDB();
  await db.put(STORE_ALBUMS, album);
}

export async function getAlbumById(albumId: string): Promise<Album | undefined> {
  const db = await initMusicDB();
  return db.get(STORE_ALBUMS, albumId);
}

export async function findAlbumByArtistAndTitle(
  artistId: string | null,
  title: string,
): Promise<Album | undefined> {
  const db = await initMusicDB();
  const index = db.transaction(STORE_ALBUMS).store.index("by_artist_title");
  // IDB keys don't accept null - use empty string as sentinel for "no artist"
  return index.get([artistId ?? "", title]);
}

export async function getOrCreateAlbum(
  title: string,
  artistId: string | null,
  albumType: string = "album",
): Promise<Album> {
  const existing = await findAlbumByArtistAndTitle(artistId, title);
  if (existing) return existing;

  const album: Album = {
    album_id: crypto.randomUUID(),
    title,
    artist_id: artistId,
    album_type: albumType,
    release_date: null,
    release_date_precision: null,
    label: null,
    genre_id: null,
    year: null,
    created_at: Date.now(),
    updated_at: Date.now(),
  };

  await createAlbum(album);
  return album;
}

export async function updateAlbum(
  albumId: string,
  updates: Partial<Album>,
): Promise<void> {
  const db = await initMusicDB();
  const existing = await db.get(STORE_ALBUMS, albumId);
  if (!existing) {
    throw new Error(`album not found: ${albumId}`);
  }

  const updated = {
    ...existing,
    ...updates,
    updated_at: Date.now(),
  };

  await db.put(STORE_ALBUMS, updated);
}

export async function deleteAlbum(albumId: string): Promise<void> {
  const db = await initMusicDB();
  await db.delete(STORE_ALBUMS, albumId);
}

export async function countSongsByAlbum(albumId: string): Promise<number> {
  const db = await initMusicDB();
  const index = db.transaction(STORE_SONGS).store.index("by_album_id");
  const songs = await index.getAll(albumId);
  return songs.length;
}
