// reactive query: whether the active remote has video url fetching
// enabled and fully configured. driven by `/api/hello` which exposes
// `fetch_video_enabled`.
//
// used by AddVideoModal to decide whether to show the "download urls"
// tab at all - unlike music's precheck flag, video fetch has its own
// separate config section (fetch_video) that can be disabled/unset
// independently of fetch_music.

import { createQuery } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import type { RemoteLike } from "../../app/api/client";
import { getClientForRemote } from "../../app/api/client";

export function useFetchVideoEnabledQuery(remote: Accessor<RemoteLike | null | undefined>) {
  return createQuery(() => ({
    queryKey: [
      "fetch",
      "video",
      "enabled",
      (remote() as { remote_id?: string } | null | undefined)?.remote_id ?? null,
    ],
    queryFn: async (): Promise<boolean> => {
      const r = remote();
      if (!r) return false;
      try {
        const client = await getClientForRemote(r);
        const resp = await client.app.serverInfo();
        if (!resp.success || !resp.data) return false;
        const info = resp.data as { fetch_video_enabled?: boolean | null };
        return info.fetch_video_enabled ?? false;
      } catch {
        return false;
      }
    },
    enabled: () => !!remote(),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  }));
}
