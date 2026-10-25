// reactively picks the single best video-streamable radio station for a
// given remote - shared by every "play" button's stream caret
// (VideoDetailView, series header, season mini buttons) so they all
// agree on the same pick, and only fetch the station list once per
// remote (react-query's cache dedupes concurrent/rapid calls sharing the
// same queryKey, same as any other query hook in this codebase).
import { createQuery } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import { getClientForRemote } from "../../app/api/client";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { pickStreamStation } from "./pickStreamStation";

export function useStreamStation(remote: Accessor<Remote | null>) {
  const query = createQuery(() => ({
    queryKey: ["radio", "streamableStations", remote()?.remote_id ?? "none"],
    queryFn: async () => {
      const r = remote();
      if (!r) return [];
      const client = await getClientForRemote(r);
      const result = await client.app.radioStationsFull();
      return result.success ? result.data.stations : [];
    },
    enabled: !!remote(),
    staleTime: 30 * 1000,
  }));

  return () => pickStreamStation(query.data ?? []);
}
