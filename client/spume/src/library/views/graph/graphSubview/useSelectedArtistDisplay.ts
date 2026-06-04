import { createEffect, createMemo, createSignal } from "solid-js";
import type { Remote } from "../../../../app/services/storage/schemas/remote";
import type { ArtistNodeData } from "../../../../components/graph/types";
import type { ContributingRemote } from "../../../../components/graph/RemoteSplitButton";
import { parseNodeId, slug } from "../../../../components/graph/data/nodeIds";
import { useArtistQuery } from "../../../../music/queries/songs";
import { pickPrimaryImage } from "./helpers";
import type { ClusterMember } from "./useArtistClusterIndex";

export interface SelectedArtistDisplayDeps {
  selectedArtist: () => ArtistNodeData | null;
  selectedId: () => string | null;
  artistClusterByNameSlug: () => Map<string, ClusterMember[]>;
  primaryWalkRemoteId: () => string | null;
  remotes: () => Remote[];
  contributingRemotesForArtist: (artist: ArtistNodeData) => ContributingRemote[];
}

export function createSelectedArtistDisplay(deps: SelectedArtistDisplayDeps) {
  const {
    selectedArtist,
    selectedId,
    artistClusterByNameSlug,
    primaryWalkRemoteId,
    remotes,
    contributingRemotesForArtist,
  } = deps;

  const [dataSourceRemoteOverride, setDataSourceRemoteOverride] = createSignal<{
    artistSlug: string;
    remoteId: string;
  } | null>(null);

  createEffect(() => {
    const a = selectedArtist();
    if (!a) {
      setDataSourceRemoteOverride(null);
      return;
    }
    const ov = dataSourceRemoteOverride();
    if (ov && ov.artistSlug !== slug(a.name)) {
      setDataSourceRemoteOverride(null);
    }
  });

  const selectedArtistMember = createMemo<ClusterMember | null>(() => {
    const a = selectedArtist();
    if (!a) return null;
    const graphId = selectedId();
    if (!graphId) return null;
    const cluster = artistClusterByNameSlug().get(slug(a.name)) ?? [];
    const override = dataSourceRemoteOverride();
    if (override && override.artistSlug === slug(a.name)) {
      const match = cluster.find((m) => m.remoteId === override.remoteId);
      if (match) return match;
    }
    const primary = primaryWalkRemoteId();
    if (primary) {
      const match = cluster.find((m) => m.remoteId === primary);
      if (match) return match;
    }
    let leaderRemote: string | null = null;
    try {
      const parsed = parseNodeId(graphId);
      if (parsed.kind === "artist") leaderRemote = parsed.remoteId;
    } catch {
      // ignore
    }
    if (leaderRemote) {
      const match = cluster.find((m) => m.remoteId === leaderRemote);
      if (match) return match;
    }
    if (leaderRemote) {
      return { nodeId: graphId, remoteId: leaderRemote, data: a };
    }
    return null;
  });

  const selectedArtistRemote = createMemo<Remote | undefined>(() => {
    const member = selectedArtistMember();
    if (member) {
      const found = remotes().find((r) => r.remote_id === member.remoteId);
      if (found) return found;
    }
    const a = selectedArtist();
    if (!a) return undefined;
    const fallback = a.sourceRemoteIds?.[0];
    if (fallback) {
      const found = remotes().find((r) => r.remote_id === fallback);
      if (found) return found;
    }
    return remotes()[0];
  });

  createEffect(() => {
    const a = selectedArtist();
    if (!a) return;
    const r = selectedArtistRemote();
    const member = selectedArtistMember();
    console.info("[graph] artist detail source", {
      selectedGraphId: selectedId(),
      nodeIdField: a.id,
      selectedArtistId: a.artistId,
      selectedName: a.name,
      sourceRemoteIds: a.sourceRemoteIds,
      primaryWalkRemoteId: primaryWalkRemoteId(),
      resolvedRemoteId: r?.remote_id,
      resolvedRemoteName: r?.name,
      resolvedMemberArtistId: member?.data.artistId,
      clusterMembers:
        artistClusterByNameSlug()
          .get(slug(a.name))
          ?.map((m) => ({ remoteId: m.remoteId, artistId: m.data.artistId })) ?? [],
    });
  });

  const artistQuery = useArtistQuery(
    () => selectedArtistMember()?.data.artistId ?? selectedArtist()?.artistId ?? undefined,
    () => selectedArtistRemote()
  );

  const selectedArtistDisplay = createMemo<ArtistNodeData | null>(() => {
    const a = selectedArtist();
    if (!a) return null;
    const member = selectedArtistMember();
    const base = member?.data ?? a;
    let image = base.image ?? null;
    let imageUrl = base.imageUrl ?? null;
    const q = artistQuery.data;
    const memberArtistId = member?.data.artistId ?? a.artistId;
    if (!image && q && q.artist_id === memberArtistId && q.images?.length) {
      image = pickPrimaryImage(q.images);
    }
    if (!image) {
      const cluster = artistClusterByNameSlug().get(slug(a.name)) ?? [];
      for (const m of cluster) {
        if (m.data.image) {
          image = m.data.image;
          break;
        }
      }
    }
    if (!imageUrl) {
      const cluster = artistClusterByNameSlug().get(slug(a.name)) ?? [];
      for (const m of cluster) {
        if (m.data.imageUrl) {
          imageUrl = m.data.imageUrl;
          break;
        }
      }
    }
    if (image === base.image && imageUrl === base.imageUrl) return base;
    return { ...base, image, imageUrl };
  });

  const dataSourceRemotesForSelected = createMemo<ContributingRemote[]>(() => {
    const a = selectedArtist();
    if (!a) return [];
    return contributingRemotesForArtist(a);
  });

  return {
    dataSourceRemoteOverride,
    setDataSourceRemoteOverride,
    selectedArtistMember,
    selectedArtistRemote,
    selectedArtistDisplay,
    dataSourceRemotesForSelected,
    artistQuery,
  };
}
