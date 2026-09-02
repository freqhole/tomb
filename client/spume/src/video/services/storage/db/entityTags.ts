// entity_tags junction operations for the video domain — generalized
// over entity_type (mirrors the server's entity_tagz table + video's
// bulk-first offal routes; unlike music's album-only album_tags store)
import { getVideoDB, STORE_ENTITY_TAGS } from "./init";
import { createTag, findTagByName, getTagById, type VideoTag } from "./tags";
import type { VideoImageEntityType } from "../../../data/types";

interface EntityTagRow {
  entity_type: VideoImageEntityType;
  entity_id: string;
  tag_id: string;
  created_at: number;
}

export async function getEntityTags(
  entityType: VideoImageEntityType,
  entityId: string
): Promise<VideoTag[]> {
  const db = await getVideoDB();
  const rows: EntityTagRow[] = await db.getAllFromIndex(STORE_ENTITY_TAGS, "by_entity", [
    entityType,
    entityId,
  ]);

  const tags: VideoTag[] = [];
  for (const row of rows) {
    const tag = await getTagById(row.tag_id);
    if (tag) tags.push(tag);
  }
  return tags;
}

export async function addEntityTag(
  entityType: VideoImageEntityType,
  entityId: string,
  tagId: string
): Promise<void> {
  const db = await getVideoDB();
  const row: EntityTagRow = {
    entity_type: entityType,
    entity_id: entityId,
    tag_id: tagId,
    created_at: Date.now(),
  };
  await db.put(STORE_ENTITY_TAGS, row);
}

export async function removeEntityTag(
  entityType: VideoImageEntityType,
  entityId: string,
  tagId: string
): Promise<void> {
  const db = await getVideoDB();
  await db.delete(STORE_ENTITY_TAGS, [entityType, entityId, tagId]);
}

/** per-tag usage counts across the given entities (mirrors the server's
 *  `get_entities_tags` GROUP BY count) — used to render "on all/some/none
 *  of the selection" state in the generic tag selector modal. */
export async function getEntitiesTagCounts(
  entityType: VideoImageEntityType,
  entityIds: string[]
): Promise<{ tag_id: string; tag_name: string; tag_created_at: number; count: number }[]> {
  const counts = new Map<string, { tag_name: string; tag_created_at: number; count: number }>();
  for (const entityId of entityIds) {
    const tags = await getEntityTags(entityType, entityId);
    for (const tag of tags) {
      const existing = counts.get(tag.tag_id);
      if (existing) {
        existing.count++;
      } else {
        counts.set(tag.tag_id, { tag_name: tag.name, tag_created_at: tag.created_at, count: 1 });
      }
    }
  }
  return Array.from(counts.entries()).map(([tag_id, v]) => ({ tag_id, ...v }));
}

export async function addEntitiesTags(
  entityType: VideoImageEntityType,
  entityIds: string[],
  tagNames: string[]
): Promise<void> {
  for (const name of tagNames) {
    let tag = await findTagByName(name);
    if (!tag) tag = await createTag(name);
    for (const entityId of entityIds) {
      await addEntityTag(entityType, entityId, tag.tag_id);
    }
  }
}

export async function removeEntitiesTags(
  entityType: VideoImageEntityType,
  entityIds: string[],
  tagIds: string[]
): Promise<void> {
  for (const entityId of entityIds) {
    for (const tagId of tagIds) {
      await removeEntityTag(entityType, entityId, tagId);
    }
  }
}
