// artist CRUD operations
import { initMusicDB } from "./init";
import type { Artist } from "../types";
import { STORE_ARTISTS, STORE_SONGS } from "../types";

export async function createArtist(artist: Artist): Promise<void> {
  const db = await initMusicDB();
  await db.put(STORE_ARTISTS, artist);
}

export async function getArtistById(artistId: string): Promise<Artist | undefined> {
  const db = await initMusicDB();
  return db.get(STORE_ARTISTS, artistId);
}

export async function findArtistByName(name: string): Promise<Artist | undefined> {
  const db = await initMusicDB();
  const index = db.transaction(STORE_ARTISTS).store.index("by_name");
  return index.get(name);
}

export async function getOrCreateArtist(name: string): Promise<Artist> {
  const existing = await findArtistByName(name);
  if (existing) return existing;

  const artist: Artist = {
    artist_id: crypto.randomUUID(),
    name,
    created_at: Date.now(),
    updated_at: Date.now(),
  };

  await createArtist(artist);
  return artist;
}

export async function updateArtist(
  artistId: string,
  updates: Partial<Artist>,
): Promise<void> {
  const db = await initMusicDB();
  const existing = await db.get(STORE_ARTISTS, artistId);
  if (!existing) {
    throw new Error(`artist not found: ${artistId}`);
  }

  const updated = {
    ...existing,
    ...updates,
    updated_at: Date.now(),
  };

  await db.put(STORE_ARTISTS, updated);
}

export async function deleteArtist(artistId: string): Promise<void> {
  const db = await initMusicDB();
  await db.delete(STORE_ARTISTS, artistId);
}

export async function countSongsByArtist(artistId: string): Promise<number> {
  const db = await initMusicDB();
  const index = db.transaction(STORE_SONGS).store.index("by_artist_id");
  const songs = await index.getAll(artistId);
  return songs.length;
}
