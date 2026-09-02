// pluggable tag-management backend for the generic TagSelectorModal.
// each domain (album, video, ...) implements one of these so the modal
// itself never needs to know which entity kind it's managing tags for.
import type { Remote } from "../../../app/services/storage/schemas/remote";

export interface Tag {
  tag_id: string;
  name: string;
  created_at: number;
}

export interface TagAdapter {
  /** the full tag vocabulary available to pick/create from. */
  listAllTags(remote?: Remote): Promise<Tag[]>;
  /** per-tag usage count across the given entities, keyed by tag_id -
   *  used to render "on all/some/none of the selection". */
  getEntityTagCounts(entityIds: string[], remote?: Remote): Promise<Map<string, number>>;
  /** apply the given tag names (found-or-created) to every entity. */
  addTags(entityIds: string[], tagNames: string[], remote?: Remote): Promise<void>;
  /** remove the given tag ids from every entity. */
  removeTags(entityIds: string[], tagIds: string[], remote?: Remote): Promise<void>;
}
