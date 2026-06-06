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

  // sibling-remote artist ids that need to stay visible so each
  // contributing remote's square + relation-hub chain renders. the
  // walker's pin-loop walks each pinned id's ancestors up to root, so
  // pinning the sibling artist (whose parents are remote::sib and
  // every value::sib::* wired to it) surfaces every chip we need. the
  // final visibility collapse fuses the sibling artist itself into
  // the leader glyph, but the remote square + relation hubs + value
  // chips remain visible. cleared by setPinned([]) elsewhere (search,
  // pivotToTaxonNode); rebuilt as new batches resolve.
  const crossRemotePinnedArtists = new Set<string>();

  const batchLookupAndMerge = async (
    otherRemoteId: string,
    candidates: Map<string, string>
  ) => {
    if (candidates.size === 0) return;
    const remote = remotes().find((r) => r.remote_id === otherRemoteId);
    if (!remote) {
      for (const slugKey of candidates.keys()) {
        crossRemoteLookups.set(`${otherRemoteId}::${slugKey}`, "absent");
      }
      return;
    }
    if (offlineByRemote().get(otherRemoteId) === true) {
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
      const matchesBySlug = new Map<string, typeof albums>();
      for (const a of albums) {
        const s = slug(a.artistName);
        if (!candidates.has(s)) continue;
        if (!matchesBySlug.has(s)) matchesBySlug.set(s, []);
        matchesBySlug.get(s)!.push(a);
      }

      for (const slugKey of candidates.keys()) {
        if (!matchesBySlug.has(slugKey)) {
          crossRemoteLookups.set(`${otherRemoteId}::${slugKey}`, "absent");
        }
      }

      const allMatches = albums.filter((a) => candidates.has(slug(a.artistName)));
      console.log("[xremote-diag] batch result", {
        otherRemoteId,
        candidateNames: names,
        albumsReturned: albums.length,
        matchedAlbums: allMatches.length,
        sampleAlbumGenres: allMatches.slice(0, 3).map((a) => ({
          title: a.title,
          artist: a.artistName,
          genres: a.genres,
          tags: a.tags,
          moods: a.moods,
          styles: a.styles,
          era: a.era,
          label: a.label,
          customTaxons: a.customTaxons,
        })),
      });
      if (allMatches.length === 0) return;

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

      const wc = walkerClient();
      console.log("[xremote-diag] merging", {
        otherRemoteId,
        walkerReady: !!wc,
        addNodes: addNodes.length,
        addEdges: addEdges.length,
        artistIds: Array.from(sliceArtistIds),
        relHubIds: Array.from(sliceRelHubIds),
        valueIds: Array.from(sliceValueIds),
        sampleEdges: addEdges.slice(0, 6),
      });
      wc?.merge(addNodes, addEdges);
      // do NOT call wc.expand(remoteHub) here. expand() walks the
      // linear breadcrumb and would drag the pivot off the
      // deep-linked artist onto the sibling remote hub. the walker's
      // strategy A clustering already fuses sibling artists into the
      // pivoted artist's cluster, so their albums + value chips
      // surface naturally via clusterChildrenOf(piv) without any
      // expand() calls. handlePivot on each sibling artist (below)
      // wires its value->artist edges via maybeLoadRelationsForEntityPivot.
      console.log("[xremote-diag] post-merge", {
        otherRemoteId,
        note: "no expand() calls; relying on clustering + value->artist edges for visibility",
      });

      if (onArtistMerged) {
        for (const aId of sliceArtistIds) {
          console.log("[xremote-diag] onArtistMerged → handlePivot", { aId, otherRemoteId });
          onArtistMerged(aId);
        }
      }

      // pin sibling artist nodes so the walker's ancestor walk
      // surfaces remote::sib + relation::sib::* + value::sib::* in
      // the visible set. without this, only the leader's remote
      // square renders because non-leader remote hubs aren't reached
      // by any descent from the pivot. handlePivot above must run
      // first so each sibling artist has its value->artist edges
      // merged (those edges add the values to parentsOf[artist],
      // which is what the pin's ancestor walk traverses).
      for (const aId of sliceArtistIds) crossRemotePinnedArtists.add(aId);
      console.log("[xremote-diag] pinning sibling artists", {
        totalPinned: crossRemotePinnedArtists.size,
        ids: Array.from(crossRemotePinnedArtists),
      });
      wc?.setPinned(Array.from(crossRemotePinnedArtists));

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

  // drop every pinned sibling artist (and tell the walker about it).
  // call this when the user pivots away from the artist-of-interest
  // (hits home, picks a different artist, taps a relation hub, etc.)
  // so stale remote squares + relation chains stop hanging around.
  const clearCrossRemotePins = () => {
    if (crossRemotePinnedArtists.size === 0) return;
    crossRemotePinnedArtists.clear();
    walkerClient()?.setPinned([]);
  };

  const isArtistPinned = (artistId: string) => crossRemotePinnedArtists.has(artistId);

  return { batchLookupAndMerge, clearCrossRemotePins, isArtistPinned };
}
