// video (+ video_series) tag adapter — backs the generic TagSelectorModal
// with the domain-neutral entity_tagz routes / video's own local
// indexeddb tag stores. factory-shaped so a caller picks which video
// entity kind ("video" vs "video_series") it's managing tags for.
import { getVideoDataSource } from "../../../video/data";
import { getClientForRemote } from "../../../app/api/client";
import type { Remote } from "../../../app/services/storage/schemas/remote";
import type { VideoImageEntityType } from "../../../video/data/types";
import type { Tag, TagAdapter } from "./types";

export function createVideoTagAdapter(entityType: VideoImageEntityType): TagAdapter {
  return {
    async listAllTags(remote?: Remote): Promise<Tag[]> {
      if (remote) {
        const client = await getClientForRemote(remote);
        const resp = await client.music.listTags();
        if (!resp.success) return [];
        return resp.data.map((t) => ({
          tag_id: t.id,
          name: t.name,
          created_at: t.created_at,
        }));
      }
      const datasource = getVideoDataSource();
      return (await datasource.getTags?.()) ?? [];
    },

    async getEntityTagCounts(entityIds: string[], remote?: Remote): Promise<Map<string, number>> {
      const counts = new Map<string, number>();
      if (entityIds.length === 0) return counts;

      if (remote) {
        const client = await getClientForRemote(remote);
        const resp = await client.entities.getEntitiesTags({
          entity_type: entityType,
          entity_ids: entityIds,
        });
        if (resp.success) {
          for (const row of resp.data) counts.set(row.tag_id, row.count);
        }
        return counts;
      }

      const datasource = getVideoDataSource();
      const rows = (await datasource.getEntitiesTags?.({ entityType, entityIds })) ?? [];
      for (const row of rows) counts.set(row.tag_id, row.count);
      return counts;
    },

    async addTags(entityIds: string[], tagNames: string[], remote?: Remote): Promise<void> {
      if (tagNames.length === 0) return;
      if (remote) {
        const client = await getClientForRemote(remote);
        await client.entities.addEntitiesTags({
          entity_type: entityType,
          entity_ids: entityIds,
          tag_names: tagNames,
        });
        return;
      }
      const datasource = getVideoDataSource();
      await datasource.addEntitiesTags?.({ entityType, entityIds, tagNames });
    },

    async removeTags(entityIds: string[], tagIds: string[], remote?: Remote): Promise<void> {
      if (tagIds.length === 0) return;
      if (remote) {
        const client = await getClientForRemote(remote);
        await client.entities.removeEntitiesTags({
          entity_type: entityType,
          entity_ids: entityIds,
          tag_ids: tagIds,
        });
        return;
      }
      const datasource = getVideoDataSource();
      await datasource.removeEntitiesTags?.({ entityType, entityIds, tagIds });
    },
  };
}
