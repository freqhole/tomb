import { parseNodeId, relationHubId } from "../../../../components/graph/data/nodeIds";
import { toast } from "../../../../components/feedback/Toast";
import { getClientForRemote } from "../../../../app/api/client";
import type { Remote } from "../../../../app/services/storage/schemas/remote";
import type { AlbumNodeData, ArtistNodeData } from "../../../../components/graph/types";

export type ParsedId = ReturnType<typeof parseNodeId>;

export const tryParse = (id: string): ParsedId | null => {
  try {
    return parseNodeId(id);
  } catch {
    return null;
  }
};

export const isTaxonId = (p: ParsedId | null): boolean =>
  !!p && (p.kind === "value" || p.kind === "group");

export const summarizeMutation = (
  label: string,
  results: PromiseSettledResult<unknown>[]
): { ok: number; fail: number } => {
  let ok = 0;
  let fail = 0;
  for (const r of results) {
    if (r.status === "fulfilled") ok += 1;
    else {
      fail += 1;
      console.warn(`[graph] ${label} op failed`, r.reason);
    }
  }
  if (fail === 0 && ok > 0) toast.success(`${label}: ${ok} ok`);
  else if (ok === 0 && fail > 0) toast.error(`${label}: ${fail} failed`);
  else if (fail > 0) toast.warning(`${label}: ${ok} ok, ${fail} failed`);
  return { ok, fail };
};

export interface EditModeHandlersDeps {
  remotes: () => Remote[];
  isRemoteAdmin: (remoteId: string | null) => boolean;
  selectedTaxonInfo: () => {
    taxonId: string | null;
    remoteId: string;
    kindSlug: string;
    relHubId: string;
    albumCount: number | undefined;
    label: string;
  } | null;
  setEditMode: (next: boolean) => void;
  setMultiSelection: (next: Set<string>) => void;
  setSelectedId: (next: string | null) => void;
  taxonItemsByHub: Map<string, Map<string, { id: string; label: string; albumCount: number }>>;
  taxonParentsByHub: Map<string, Map<string, string>>;
  taxonsLoadedByHub: Set<string>;
  maybeLoadTaxonsForPivot: (nodeId: string) => Promise<void>;
  buildResult: () => { nodesById: Map<string, AlbumNodeData | ArtistNodeData> } | null;
}

export function createEditModeHandlers(deps: EditModeHandlersDeps) {
  const {
    remotes,
    isRemoteAdmin,
    selectedTaxonInfo,
    setEditMode,
    setMultiSelection,
    setSelectedId,
    taxonItemsByHub,
    taxonParentsByHub,
    taxonsLoadedByHub,
    maybeLoadTaxonsForPivot,
    buildResult,
  } = deps;

  const ancestorsInHub = (relHubId: string, taxonId: string): string[] => {
    const parents = taxonParentsByHub.get(relHubId);
    if (!parents) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    let cur: string | undefined = parents.get(taxonId);
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      out.push(cur);
      cur = parents.get(cur);
    }
    return out;
  };

  const taxonIdForNode = (p: ParsedId): { taxonId: string; relHubId: string } | null => {
    if (!p || (p.kind !== "value" && p.kind !== "group")) return null;
    const relHubId = relationHubId(p.remoteId, p.relationKind);
    const cache = taxonItemsByHub.get(relHubId);
    if (!cache) return null;
    const item = cache.get(p.valueSlug);
    if (!item) return null;
    return { taxonId: item.id, relHubId };
  };

  const refreshHub = async (relHubId: string) => {
    taxonsLoadedByHub.delete(relHubId);
    await maybeLoadTaxonsForPivot(relHubId);
  };

  const albumIdsForArtist = (remoteId: string, artistId: string): string[] => {
    const out: string[] = [];
    const result = buildResult();
    if (result) {
      for (const [key, node] of result.nodesById) {
        if (
          "title" in node &&
          (node as AlbumNodeData).artistId === artistId &&
          (node as AlbumNodeData).sourceRemoteId === remoteId
        ) {
          const parsed = tryParse(key);
          if (parsed?.kind === "album") out.push(parsed.albumId);
        }
      }
    }
    return out;
  };

  const handleDrop = async (sourceIds: string[], targetId: string) => {
    if (sourceIds.length === 0) return;
    const targetParsed = tryParse(targetId);
    if (!targetParsed) return;
    const srcParsed = sourceIds.map(tryParse).filter((p): p is ParsedId => !!p);
    if (srcParsed.length === 0) return;
    const targetRemote =
      "remoteId" in targetParsed ? (targetParsed as { remoteId: string }).remoteId : null;
    if (!targetRemote) return;
    if (
      srcParsed.some(
        (p) => "remoteId" in p && (p as { remoteId: string }).remoteId !== targetRemote
      )
    ) {
      console.warn("[graph] drop: cross-remote not supported");
      toast.warning("cross-remote bulk drop is not supported");
      return;
    }
    const remote = remotes().find((r) => r.remote_id === targetRemote);
    if (!remote) return;
    if (!isRemoteAdmin(targetRemote)) return;
    const client = await getClientForRemote(remote);

    if (isTaxonId(targetParsed)) {
      const tgt = taxonIdForNode(targetParsed);
      if (!tgt) return;
      const targetKind = (targetParsed as { relationKind: string }).relationKind;

      const allTaxonsSameKind = srcParsed.every(
        (p) => isTaxonId(p) && (p as { relationKind: string }).relationKind === targetKind
      );
      if (allTaxonsSameKind) {
        const parents = taxonParentsByHub.get(tgt.relHubId);
        const ops: Promise<unknown>[] = [];
        for (const p of srcParsed) {
          const src = taxonIdForNode(p);
          if (!src) continue;
          if (src.taxonId === tgt.taxonId) continue;
          const targetAncestors = ancestorsInHub(tgt.relHubId, tgt.taxonId);
          if (targetAncestors.includes(src.taxonId)) {
            console.warn("[graph] drop: would create cycle, skipping", {
              src: src.taxonId,
              tgt: tgt.taxonId,
            });
            continue;
          }
          const existingParent = parents?.get(src.taxonId);
          if (existingParent === tgt.taxonId) continue;
          if (existingParent) {
            ops.push(
              client.music.removeTaxonParent({ child_id: src.taxonId, parent_id: existingParent })
            );
          }
          ops.push(client.music.addTaxonParent({ child_id: src.taxonId, parent_id: tgt.taxonId }));
        }
        const results = await Promise.allSettled(ops);
        summarizeMutation("re-parent", results);
        await refreshHub(tgt.relHubId);
        return;
      }

      const albumIds = new Set<string>();
      for (const p of srcParsed) {
        if (p.kind === "album") albumIds.add(p.albumId);
        else if (p.kind === "artist") {
          for (const aid of albumIdsForArtist(targetRemote, p.artistId)) albumIds.add(aid);
        }
      }
      if (albumIds.size === 0) return;
      const ops: Promise<unknown>[] = [];
      for (const aid of albumIds) {
        ops.push(
          client.music.addAlbumTaxon({ album_id: aid, taxon_id: tgt.taxonId, origin: "manual" })
        );
      }
      const results = await Promise.allSettled(ops);
      summarizeMutation("assign taxon", results);
      await refreshHub(tgt.relHubId);
      return;
    }

    if (targetParsed.kind === "relation") {
      const relHubId = relationHubId(targetRemote, targetParsed.relationKind);
      const parents = taxonParentsByHub.get(relHubId);
      if (!parents) return;
      const ops: Promise<unknown>[] = [];
      for (const p of srcParsed) {
        if (
          !isTaxonId(p) ||
          (p as { relationKind: string }).relationKind !== targetParsed.relationKind
        )
          continue;
        const src = taxonIdForNode(p);
        if (!src) continue;
        const existingParent = parents.get(src.taxonId);
        if (!existingParent) continue;
        ops.push(
          client.music.removeTaxonParent({ child_id: src.taxonId, parent_id: existingParent })
        );
      }
      const results = await Promise.allSettled(ops);
      summarizeMutation("detach taxon", results);
      await refreshHub(relHubId);
      return;
    }
  };

  const handleEdgeRightClick = async (srcId: string, tgtId: string) => {
    const srcParsed = tryParse(srcId);
    const tgtParsed = tryParse(tgtId);
    if (!srcParsed || !tgtParsed) return;
    const remoteId =
      "remoteId" in srcParsed
        ? (srcParsed as { remoteId: string }).remoteId
        : "remoteId" in tgtParsed
          ? (tgtParsed as { remoteId: string }).remoteId
          : null;
    if (!remoteId || !isRemoteAdmin(remoteId)) return;
    const remote = remotes().find((r) => r.remote_id === remoteId);
    if (!remote) return;

    if (
      isTaxonId(srcParsed) &&
      isTaxonId(tgtParsed) &&
      (srcParsed as { relationKind: string }).relationKind ===
        (tgtParsed as { relationKind: string }).relationKind
    ) {
      const parent = taxonIdForNode(srcParsed);
      const child = taxonIdForNode(tgtParsed);
      if (!parent || !child) return;
      const parents = taxonParentsByHub.get(parent.relHubId);
      if (parents?.get(child.taxonId) !== parent.taxonId) return;
      if (!window.confirm("remove this parent link?")) return;
      const client = await getClientForRemote(remote);
      const resp = await client.music.removeTaxonParent({
        child_id: child.taxonId,
        parent_id: parent.taxonId,
      });
      if (!resp.success) {
        console.warn("[graph] remove parent edge failed", resp);
        toast.error("failed to remove parent link");
      } else {
        toast.success("parent link removed");
      }
      await refreshHub(parent.relHubId);
      return;
    }

    const valueP = isTaxonId(srcParsed) ? srcParsed : isTaxonId(tgtParsed) ? tgtParsed : null;
    const albumP =
      srcParsed.kind === "album" ? srcParsed : tgtParsed.kind === "album" ? tgtParsed : null;
    if (valueP && albumP && (valueP.kind === "value" || valueP.kind === "group")) {
      const t = taxonIdForNode(valueP);
      if (!t) return;
      if (!window.confirm("remove this album-taxon link?")) return;
      const client = await getClientForRemote(remote);
      const resp = await client.music.removeAlbumTaxon({
        album_id: albumP.albumId,
        taxon_id: t.taxonId,
      });
      if (!resp.success) {
        console.warn("[graph] remove album-taxon link failed", resp);
        toast.error("failed to remove album link");
      } else {
        toast.success("album link removed");
      }
      await refreshHub(t.relHubId);
      return;
    }
  };

  const handleCreateTaxon = async (label: string) => {
    const info = selectedTaxonInfo();
    if (!info) return;
    const trimmed = label.trim();
    if (!trimmed) return;
    const remote = remotes().find((r) => r.remote_id === info.remoteId);
    if (!remote) return;
    if (!isRemoteAdmin(info.remoteId)) return;
    const parsedHub = tryParse(info.relHubId);
    if (!parsedHub || parsedHub.kind !== "relation") return;
    const client = await getClientForRemote(remote);
    const created = await client.music.createTaxon({
      kind_slug: parsedHub.relationKind,
      label: trimmed,
    });
    if (!created.success || !created.data) {
      console.warn("[graph] create taxon failed", created);
      toast.error("failed to create taxon");
      return;
    }
    toast.success(`taxon '${trimmed}' created`);
    if (info.taxonId) {
      const parented = await client.music.addTaxonParent({
        child_id: created.data.id,
        parent_id: info.taxonId,
      });
      if (!parented.success) console.warn("[graph] parent new taxon failed", parented);
    }
    await refreshHub(info.relHubId);
  };

  const handleDeleteTaxon = async () => {
    const info = selectedTaxonInfo();
    if (!info?.taxonId) return;
    const remote = remotes().find((r) => r.remote_id === info.remoteId);
    if (!remote) return;
    if (!isRemoteAdmin(info.remoteId)) return;
    const client = await getClientForRemote(remote);
    const resp = await client.music.deleteTaxon({ id: info.taxonId });
    if (!resp.success) {
      console.warn("[graph] delete taxon failed", resp);
      toast.error("failed to delete taxon");
      return;
    }
    toast.success("taxon deleted");
    setEditMode(false);
    setMultiSelection(new Set<string>());
    setSelectedId(null);
    await refreshHub(info.relHubId);
  };

  return {
    handleDrop,
    handleEdgeRightClick,
    handleCreateTaxon,
    handleDeleteTaxon,
    // shared helpers reused by bulkHandlers via the parent component
    taxonIdForNode,
    refreshHub,
    albumIdsForArtist,
  };
}
