// reactive query: which metadata-enrichment sources are enabled on the
// remote backing the current modal. driven by `/api/hello` (serverInfo),
// which exposes `musicbrainz_enabled`, `lastfm_enabled`, and
// `audiodb_enabled`.
//
// used by AlbumEditorModal to hide tabs for sources the operator hasn't
// configured in `freqhole-config.toml`. defaults to all-true when the
// server is older / missing the fields, so the ui doesn't regress for
// pre-upgrade remotes.

import { createQuery } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { getClientForRemote } from "../../app/api/client";

export interface EnrichmentEnabled {
  mb: boolean;
  lastfm: boolean;
  audiodb: boolean;
}

const DEFAULT_ALL_ENABLED: EnrichmentEnabled = {
  mb: true,
  lastfm: true,
  audiodb: true,
};

export function useEnrichmentEnabledQuery(remote: Accessor<Remote | undefined>) {
  return createQuery(() => ({
    queryKey: ["enrichment", "enabled", remote()?.remote_id ?? null],
    queryFn: async (): Promise<EnrichmentEnabled> => {
      const r = remote();
      if (!r) return DEFAULT_ALL_ENABLED;
      try {
        const client = await getClientForRemote(r);
        const resp = await client.app.serverInfo();
        if (!resp.success || !resp.data) return DEFAULT_ALL_ENABLED;
        const info = resp.data as {
          musicbrainz_enabled?: boolean | null;
          lastfm_enabled?: boolean | null;
          audiodb_enabled?: boolean | null;
        };
        // missing field on older servers => assume enabled (don't hide
        // tabs the user might still want).
        return {
          mb: info.musicbrainz_enabled ?? true,
          lastfm: info.lastfm_enabled ?? true,
          audiodb: info.audiodb_enabled ?? true,
        };
      } catch {
        return DEFAULT_ALL_ENABLED;
      }
    },
    enabled: () => !!remote(),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  }));
}
