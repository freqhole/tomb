// tag CRUD operations
import { initMusicDB } from "./init";
import type { Tag } from "../types";
import { STORE_TAGS } from "../types";

export async function createTag(name: string): Promise<Tag> {
  const db = await initMusicDB();

  // check if tag already exists
  const existing = await findTagByName(name);
  if (existing) {
    return existing;
  }

  const tag: Tag = {
    tag_id: crypto.randomUUID(),
    name,
    created_at: Date.now(),
  };

  await db.put(STORE_TAGS, tag);
  return tag;
}

export async function getTagById(tagId: string): Promise<Tag | undefined> {
  const db = await initMusicDB();
  return db.get(STORE_TAGS, tagId);
}

export async function findTagByName(name: string): Promise<Tag | undefined> {
  const db = await initMusicDB();
  const index = db.transaction(STORE_TAGS).store.index("by_name");
  return index.get(name);
}

export async function getAllTags(): Promise<Tag[]> {
  const db = await initMusicDB();
  return db.getAll(STORE_TAGS);
}

export async function deleteTag(tagId: string): Promise<void> {
  const db = await initMusicDB();
  await db.delete(STORE_TAGS, tagId);
}
