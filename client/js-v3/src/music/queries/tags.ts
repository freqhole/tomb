// query hooks for tags

import { createQuery } from "@tanstack/solid-query";
import { getDataSource } from "../data";

/**
 * fetch all available tags
 */
export function useTagsQuery() {
  return createQuery(() => ({
    queryKey: ["tags", "list"],
    queryFn: async () => {
      const dataSource = getDataSource();
      if (!dataSource.getTags) {
        throw new Error("current data source does not support tags");
      }

      return await dataSource.getTags();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - tags don't change often
  }));
}
