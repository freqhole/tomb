// query hooks for tags

import { createQuery } from "@tanstack/solid-query";
import * as apiClient from "freqhole-api-client";
import { getCurrentRemote } from "../data";

/**
 * fetch all available tags
 */
export function useTagsQuery() {
  return createQuery(() => ({
    queryKey: ["tags", "list"],
    queryFn: async () => {
      const remote = getCurrentRemote();
      if (!remote) {
        throw new Error("no remote configured");
      }

      const result = await apiClient.music.listTags(remote.base_url);
      if (!result.success) {
        throw new Error("failed to fetch tags");
      }

      return result.data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - tags don't change often
  }));
}
