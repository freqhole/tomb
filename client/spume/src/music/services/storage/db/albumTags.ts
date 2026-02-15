// album-tag junction table operations
import { initMusicDB } from "./init";
import type { AlbumTag, Tag } from "../types";
import { STORE_ALBUM_TAGS, STORE_TAGS } from "../types";

export async function getAlbumTags(albumId: string): Promise<Tag[]> {
  const db = await initMusicDB();

  // get all album_tag entries for this album
  const albumTags = await db.getAllFromIndex(
    STORE_ALBUM_TAGS,
    "by_album_id",
    albumId
  );

  // fetch the actual tag objects
  const tags: Tag[] = [];
  for (const albumTag of albumTags) {
    const tag = await db.get(STORE_TAGS, albumTag.tag_id);
    if (tag) {
      tags.push(tag);
    }
  }

  return tags;
}

export async function addAlbumTag(
  albumId: string,
  tagId: string
): Promise<void> {
  const db = await initMusicDB();

  const albumTag: AlbumTag = {
    album_id: albumId,
    tag_id: tagId,
    created_at: Date.now(),
  };

  await db.put(STORE_ALBUM_TAGS, albumTag);
}

export async function removeAlbumTag(
  albumId: string,
  tagId: string
): Promise<void> {
  const db = await initMusicDB();
  await db.delete(STORE_ALBUM_TAGS, [albumId, tagId]);
}

export async function clearAlbumTags(albumId: string): Promise<void> {
  const db = await initMusicDB();

  const albumTags = await db.getAllFromIndex(
    STORE_ALBUM_TAGS,
    "by_album_id",
    albumId
  );

  for (const albumTag of albumTags) {
    await db.delete(STORE_ALBUM_TAGS, [albumTag.album_id, albumTag.tag_id]);
  }
}
