// genre CRUD operations
import { initMusicDB } from "./init";
import type { Genre } from "../types";
import { STORE_GENRES } from "../types";

export async function createGenre(genre: Genre): Promise<void> {
  const db = await initMusicDB();
  await db.put(STORE_GENRES, genre);
}

export async function getGenreById(genreId: string): Promise<Genre | undefined> {
  const db = await initMusicDB();
  return db.get(STORE_GENRES, genreId);
}

export async function findGenreByName(name: string): Promise<Genre | undefined> {
  const db = await initMusicDB();
  const index = db.transaction(STORE_GENRES).store.index("by_name");
  return index.get(name);
}

export async function getOrCreateGenre(name: string): Promise<Genre> {
  const existing = await findGenreByName(name);
  if (existing) return existing;

  const genre: Genre = {
    genre_id: crypto.randomUUID(),
    name,
    created_at: Date.now(),
  };

  await createGenre(genre);
  return genre;
}
