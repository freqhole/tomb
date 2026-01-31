// query hooks for tags

import { createQuery } from "@tanstack/solid-query";
import { getDataSource } from "../data";
import { queryKeys } from "./queryKeys";

/**
 * fetch all available tags
 */
export function useTagsQuery() {
  return createQuery(() => ({
    queryKey: queryKeys.tags.list(),
    queryFn: async () => {
      const dataSource = getDataSource();
      if (!dataSource.getTags) {
        // return empty array for sources that don't support tags
        return [];
      }

      return await dataSource.getTags();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - tags don't change often
  }));
}
