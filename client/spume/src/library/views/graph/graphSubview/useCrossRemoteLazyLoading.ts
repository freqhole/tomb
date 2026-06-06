import type { QueryClient } from "@tanstack/solid-query";
import type { Remote } from "../../../../app/services/storage/schemas/remote";
import type { AlbumNodeData, ArtistNodeData } from "../../../../components/graph/types";
import type { AlbumSummary } from "../../../../music/data/types";
import type { GraphDriver } from "../../../../components/graph/drivers/GraphDriver";
import { adaptAlbum } from "../adaptAlbum";
import { deriveArtistNodes } from "../deriveArtistNodes";
import { buildWalkGraph } from "../../../../components/graph/data/buildWalkGraph";
import { slug } from "../../../../components/graph/data/nodeIds";
import { getClientForRemote } from "../../../../app/api/client";
import { adaptApiImage, adaptApiUrls } from "../../../../music/data/remote/adapters";

type LookupState = "loading" | "loaded" | "absent";

export interface CrossRemoteLazyLoadingDeps {
  remotes: () => Remote[];
  offlineByRemote: () => Map<string, boolean>;
  crossRemoteLookups: Map<string, LookupState>;
  setFetchingByRemote: (
    updater: (prev: Map<string, boolean>) => Map<string, boolean>
  ) => void;
  queryClient: QueryClient;
  setExtraNodesById: (
    updater: (prev: Map<string, AlbumNodeData | ArtistNodeData>) => Map<string, AlbumNodeData | ArtistNodeData>
  ) => void;
  walkerClient: () => GraphDriver | null;
  // optional: invoked after a sibling-remote artist is merged into the
  // walker so the host can fan out per-artist loaders (taxon chips,
  // related-artist cloud, entity-relation edges).
  onArtistMerged?: (artistId: string) => void;
}

export function createCrossRemoteLazyLoading(deps: CrossRemoteLazyLoadingDeps) {
  const {
    remotes,
    offlineByRemote,
    crossRemoteLookups,
    setFetchingByRemote,
    queryClient,
    setExtraNodesById,
    walkerClient,
    onArtistMerged,
  } = deps;

  const batchLookupAndMerge = async (
    otherRemoteId: string,
    candidates: Map<string, string>
  ) => {
    console.log("[xremote/batchLookup] enter", {
      otherRemoteId,
      candidateCount: candidates.size,
      candidates: Array.from(candidates.entries()),
    });
    if (candidates.size === 0) {
      console.log("[xremote/batchLookup] bail: empty candidates");
      return;
    }
    const remote = remotes().find((r) => r.remote_id === otherRemoteId);
    if (!remote) {
      console.warn("[xremote/batchLookup] bail: remote not in list", { otherRemoteId });
      for (const slugKey of candidates.keys()) {
        crossRemoteLookups.set(`${otherRemoteId}::${slugKey}`, "absent");
      }
      return;
    }
    if (offlineByRemote().get(otherRemoteId) === true) {
      console.warn("[xremote/batchLookup] bail: remote offline", { otherRemoteId });
      for (const slugKey of candidates.keys()) {
        crossRemoteLookups.delete(`${otherRemoteId}::${slugKey}`);
      }
      return;
    }

    const names = Array.from(candidates.values());
    const fetchKey = `xremote-batch::${otherRemoteId}::${Array.from(candidates.keys()).sort().join(",")}`;
    try {
      setFetchingByRemote((prev) => {
        const next = new Map(prev);
        next.set(fetchKey, true);
        return next;
      });
      const summaries = await queryClient.fetchQuery({
        queryKey: ["xremote-artist-batch", otherRemoteId, ...names.slice().sort()] as const,
        queryFn: async () => {
          const client = await getClientForRemote(remote);
          const resp = await client.music.queryAlbums({
            q: null,
            search_fields: null,
            filters: { artist_names: names },
            sort_by: null,
            sort_direction: null,
            limit: 1000,
            offset: 0,
            user_id: null,
            favorites_only: null,
            min_rating: null,
          });
          if (!resp.success || !resp.data) throw new Error("xremote album query failed");
          const baseUrl = (remote as { base_url?: string }).base_url ?? "";
          const rid = remote.remote_id;
          return resp.data.items.map(
            (item): AlbumSummary => ({
              album_id: item.album.id,
              title: item.album.title,
              artist_id: item.artist?.id ?? "",
              artist_name: item.artist?.name ?? "unknown artist",
              album_type: item.album.album_type,
              year: undefined,
              release_date: item.album.release_date ?? undefined,
              label: item.album.label ?? undefined,
              genres: item.album.genres ?? undefined,
              song_count: item.album.song_count,
              total_duration: item.album.total_duration,
              images: item.images?.length
                ? item.images.map((img) => adaptApiImage(img, baseUrl, rid))
                : undefined,
              urls: adaptApiUrls(item.album.urls),
              is_favorite: item.is_favorite ?? undefined,
              user_rating: item.rating ?? undefined,
              tags: item.album_tags ?? undefined,
              created_at: item.album.created_at,
              updated_at: item.album.updated_at,
              created_by_username: item.album.created_by_username ?? undefined,
              updated_by_username: item.album.updated_by_username ?? undefined,
              metadata: item.album.metadata ?? null,
              mb_lookup_status: item.album.mb_lookup_status ?? null,
              mb_lookup_at: item.album.mb_lookup_at ?? null,
              mb_lookup_by: item.album.mb_lookup_by ?? null,
            })
          );
        },
        staleTime: 60_000,
      });

      const albums = summaries.map((s) => adaptAlbum(s, { remoteId: otherRemoteId }));
      console.log("[xremote/batchLookup] query result", {
        otherRemoteId,
        summariesReturned: summaries.length,
        sampleArtistNames: albums.slice(0, 10).map((a) => a.artistName),
        candidateSlugs: Array.from(candidates.keys()),
      });
      const matchesBySlug = new Map<string, typeof albums>();
      for (const a of albums) {
        const s = slug(a.artistName);
        if (!candidates.has(s)) continue;
        if (!matchesBySlug.has(s)) matchesBySlug.set(s, []);
        matchesBySlug.get(s)!.push(a);
      }
      console.log("[xremote/batchLookup] slug matches", {
        otherRemoteId,
        matchCount: matchesBySlug.size,
        matchedSlugs: Array.from(matchesBySlug.keys()),
      });

      for (const slugKey of candidates.keys()) {
        if (!matchesBySlug.has(slugKey)) {
          crossRemoteLookups.set(`${otherRemoteId}::${slugKey}`, "absent");
        }
      }

      const allMatches = albums.filter((a) => candidates.has(slug(a.artistName)));
      if (allMatches.length === 0) {
        console.warn("[xremote/batchLookup] zero matches after slug filter", { otherRemoteId });
        return;
      }

      const artistNodes = deriveArtistNodes(allMatches, new Set());
      const slice = buildWalkGraph({
        remoteIds: [otherRemoteId],
        albumsByRemote: new Map([[otherRemoteId, allMatches]]),
        artistsByRemote: new Map([[otherRemoteId, artistNodes]]),
        charnelManagedRemoteIds: new Set(
          remotes()
            .filter((r) => !!r.is_charnel_managed)
            .map((r) => r.remote_id)
        ),
        remoteNamesById: new Map(remotes().map((r) => [r.remote_id, r.name])),
      });

      const sliceArtistIds = new Set(
        slice.graph.nodes
          .filter((n) => n.id.startsWith(`artist::${otherRemoteId}::`))
          .map((n) => n.id)
      );
      const sliceAlbumIds = new Set(
        slice.graph.nodes
          .filter((n) => n.id.startsWith(`album::${otherRemoteId}::`))
          .map((n) => n.id)
      );
      // taxon-hub + value nodes that buildWalkGraph synthesized for
      // this remote (genres/tags/moods/etc + their values). including
      // them lets the artist appear connected to its taxon chips on
      // the sibling remote, opening more walk paths.
      const sliceRelHubIds = new Set(
        slice.graph.nodes
          .filter((n) => n.id.startsWith(`relation::${otherRemoteId}::`))
          .map((n) => n.id)
      );
      const sliceValueIds = new Set(
        slice.graph.nodes
          .filter(
            (n) =>
              n.id.startsWith(`value::${otherRemoteId}::`) ||
              n.id.startsWith(`group::${otherRemoteId}::`)
          )
          .map((n) => n.id)
      );
      const remoteHub = `remote::${otherRemoteId}`;
      const includeIds = new Set<string>([
        ...sliceArtistIds,
        ...sliceAlbumIds,
        ...sliceRelHubIds,
        ...sliceValueIds,
      ]);
      const addNodes = slice.graph.nodes.filter((n) => includeIds.has(n.id));
      const addEdges = slice.graph.edges.filter(
        (e) =>
          (includeIds.has(e.source) && includeIds.has(e.target)) ||
          (e.source === remoteHub && includeIds.has(e.target)) ||
          (e.target === remoteHub && includeIds.has(e.source))
      );

      setExtraNodesById((prev) => {
        const next = new Map(prev);
        for (const [id, node] of slice.nodesById) next.set(id, node);
        return next;
      });

      console.log("[xremote/batchLookup] merging into walker", {
        otherRemoteId,
        addNodes: addNodes.length,
        addEdges: addEdges.length,
        artistIds: Array.from(sliceArtistIds),
        albumIds: Array.from(sliceAlbumIds),
        relHubIds: Array.from(sliceRelHubIds),
        valueIds: Array.from(sliceValueIds),
        walkerReady: !!walkerClient(),
      });
      const wc = walkerClient();
      wc?.merge(addNodes, addEdges);
      // expand the sibling remote hub, each relation hub, and each
      // matched artist so the newly-merged subtree (including taxon
      // chips) actually appears in the visible-ids stream.
      if (wc) {
        wc.expand(remoteHub);
        for (const rid of sliceRelHubIds) wc.expand(rid);
        for (const aId of sliceArtistIds) wc.expand(aId);
      }

      // fan out per-artist loaders so each sibling artist's taxon
      // chips, related-artist cloud, and entity-relation edges
      // render. without this the sibling artist + its remote hub
      // appear, but with no connections to taxon hubs / values.
      if (onArtistMerged) {
        for (const aId of sliceArtistIds) {
          console.log("[xremote/batchLookup] onArtistMerged", { aId, otherRemoteId });
          onArtistMerged(aId);
        }
      }

      for (const slugKey of matchesBySlug.keys()) {
        crossRemoteLookups.set(`${otherRemoteId}::${slugKey}`, "loaded");
      }
    } catch (err) {
      console.warn("cross-remote batch lookup failed", {
        otherRemoteId,
        candidateCount: candidates.size,
        err,
      });
      for (const slugKey of candidates.keys()) {
        crossRemoteLookups.delete(`${otherRemoteId}::${slugKey}`);
      }
    } finally {
      setFetchingByRemote((prev) => {
        const next = new Map(prev);
        next.delete(fetchKey);
        return next;
      });
    }
  };

  return { batchLookupAndMerge };
}
