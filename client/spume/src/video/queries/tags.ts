// query hooks for video tags — mirrors music/queries/tags.ts's shape,
// against the video domain's own data source (local IDB or remote).
import { createQuery } from "@tanstack/solid-query";
import { getVideoDataSource } from "../data";
import type { VideoImageEntityType } from "../data/types";
import { videoQueryKeys } from "./queryKeys";

export function useVideoTagsQuery() {
  return createQuery(() => ({
    queryKey: videoQueryKeys.tags.list(),
    queryFn: async () => {
      const dataSource = getVideoDataSource();
      if (!dataSource.getTags) return [];
      return await dataSource.getTags();
    },
    staleTime: 5 * 60 * 1000,
  }));
}

/** tag names for a single video/video_series entity — works uniformly
 * for local + remote sources since it goes through the datasource's
 * `getEntitiesTags` (a single-element `entityIds` array is a de-facto
 * single-entity tag list). used by VideoDetailView and VideosTable's
 * per-row tags column. */
export function useVideoEntityTagsQuery(
  entityType: VideoImageEntityType,
  entityId: () => string | undefined
) {
  return createQuery(() => ({
    queryKey: videoQueryKeys.tags.entity(entityType, entityId() || ""),
    queryFn: async (): Promise<string[]> => {
      const id = entityId();
      if (!id) return [];
      const dataSource = getVideoDataSource();
      const rows = (await dataSource.getEntitiesTags?.({ entityType, entityIds: [id] })) ?? [];
      return rows.map((row) => row.tag_name);
    },
    enabled: !!entityId(),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  }));
}

/** unique tag names collected across a series' own tags plus every tag
 * on any video belonging to it (episodes across all seasons + any
 * season-less videos) — used by VideoSeriesDetailPanel's header. */
export function useVideoSeriesAggregateTagsQuery(
  seriesId: () => string | undefined,
  videoIds: () => string[]
) {
  return createQuery(() => ({
    queryKey: [...videoQueryKeys.tags.seriesAggregate(seriesId() || ""), videoIds()],
    queryFn: async (): Promise<string[]> => {
      const id = seriesId();
      if (!id) return [];
      const dataSource = getVideoDataSource();
      const ids = videoIds();
      const [seriesRows, videoRows] = await Promise.all([
        dataSource.getEntitiesTags?.({ entityType: "video_series", entityIds: [id] }) ?? [],
        ids.length > 0
          ? (dataSource.getEntitiesTags?.({ entityType: "video", entityIds: ids }) ?? [])
          : Promise.resolve([]),
      ]);
      const names = new Set<string>();
      for (const row of [...seriesRows, ...videoRows]) names.add(row.tag_name);
      return Array.from(names).sort((a, b) => a.localeCompare(b));
    },
    enabled: !!seriesId(),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  }));
}
