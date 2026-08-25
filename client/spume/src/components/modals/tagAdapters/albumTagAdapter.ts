// album tag adapter — extracted from TagSelectorModal.tsx's original
// album-only implementation, now behind the generic TagAdapter interface.
import { getDataSource } from "../../../music/data";
import { getClientForRemote } from "../../../app/api/client";
import type { Remote } from "../../../app/services/storage/schemas/remote";
import type { Tag, TagAdapter } from "./types";

export const albumTagAdapter: TagAdapter = {
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
    const datasource = await getDataSource();
    return (await datasource.getTags?.()) ?? [];
  },

  async getEntityTagCounts(albumIds: string[], remote?: Remote): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (albumIds.length === 0) return counts;

    if (remote) {
      const client = await getClientForRemote(remote);
      const resp = await client.music.getAlbumsTags({ album_ids: albumIds });
      if (resp.success) {
        // each row is one (album_id, tag) pair; count tag_id
        // occurrences across all rows.
        for (const row of resp.data) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const r: any = row;
          const tagId = r.tag?.id ?? r.tag_id;
          if (tagId) counts.set(tagId, (counts.get(tagId) || 0) + 1);
        }
      }
      return counts;
    }

    const datasource = await getDataSource();
    if (!datasource.getAlbumTags) return counts;
    const allTags = await albumTagAdapter.listAllTags();
    for (const albumId of albumIds) {
      const tagNames = await datasource.getAlbumTags(albumId);
      for (const name of tagNames ?? []) {
        const tag = allTags.find((t) => t.name === name);
        if (tag) counts.set(tag.tag_id, (counts.get(tag.tag_id) || 0) + 1);
      }
    }
    return counts;
  },

  async addTags(albumIds: string[], tagNames: string[], remote?: Remote): Promise<void> {
    if (tagNames.length === 0) return;
    if (remote) {
      const client = await getClientForRemote(remote);
      await client.music.addAlbumsTags({ album_ids: albumIds, tag_ids: [], tag_names: tagNames });
      return;
    }
    const datasource = await getDataSource();
    for (const albumId of albumIds) {
      await datasource.addTagsToAlbum?.(albumId, tagNames);
    }
  },

  async removeTags(albumIds: string[], tagIds: string[], remote?: Remote): Promise<void> {
    if (tagIds.length === 0) return;
    if (remote) {
      const client = await getClientForRemote(remote);
      await client.music.removeAlbumsTags({ album_ids: albumIds, tag_ids: tagIds });
      return;
    }
    const datasource = await getDataSource();
    for (const albumId of albumIds) {
      await datasource.removeTagsFromAlbum?.(albumId, tagIds);
    }
  },
};
