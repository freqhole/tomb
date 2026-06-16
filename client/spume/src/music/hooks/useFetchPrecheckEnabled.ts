// reactive query: whether the active remote has precheck configured.
// driven by `/api/hello` which exposes `fetch_precheck_enabled`.
//
// used by AddMusicModal to decide whether to show the precheck step
// before submitting download urls. defaults to false when the field
// is missing (older servers skip the step, direct download instead).

import { createQuery } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import type { RemoteLike } from "../../app/api/client";
import { getClientForRemote } from "../../app/api/client";

export function useFetchPrecheckEnabledQuery(remote: Accessor<RemoteLike | null | undefined>) {
  return createQuery(() => ({
    queryKey: ["fetch", "precheck", "enabled", (remote() as { remote_id?: string } | null | undefined)?.remote_id ?? null],
    queryFn: async (): Promise<boolean> => {
      const r = remote();
      if (!r) return false;
      try {
        const client = await getClientForRemote(r);
        const resp = await client.app.serverInfo();
        if (!resp.success || !resp.data) return false;
        const info = resp.data as { fetch_precheck_enabled?: boolean | null };
        return info.fetch_precheck_enabled ?? false;
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
