// tag CRUD operations for the video domain's own indexeddb (mirrors
// music/services/storage/db/tags.ts, kept as its own store per the
// video domain isolation rule)
import { getVideoDB, STORE_TAGS } from "./init";

export interface VideoTag {
  tag_id: string;
  name: string;
  created_at: number;
}

export async function createTag(name: string): Promise<VideoTag> {
  const db = await getVideoDB();

  const existing = await findTagByName(name);
  if (existing) {
    return existing;
  }

  const tag: VideoTag = {
    tag_id: crypto.randomUUID(),
    name,
    created_at: Date.now(),
  };

  await db.put(STORE_TAGS, tag);
  return tag;
}

export async function getTagById(tagId: string): Promise<VideoTag | undefined> {
  const db = await getVideoDB();
  return db.get(STORE_TAGS, tagId);
}

export async function findTagByName(name: string): Promise<VideoTag | undefined> {
  const db = await getVideoDB();
  return db.getFromIndex(STORE_TAGS, "by_name", name);
}

export async function getAllTags(): Promise<VideoTag[]> {
  const db = await getVideoDB();
  return db.getAll(STORE_TAGS);
}

export async function deleteTag(tagId: string): Promise<void> {
  const db = await getVideoDB();
  await db.delete(STORE_TAGS, tagId);
}
