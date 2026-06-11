import { createMemo, createSignal } from "solid-js";
import { parseNodeId, relationHubId } from "../../../../components/graph/data/nodeIds";
import { getClientForRemote } from "../../../../app/api/client";
import { toast } from "../../../../components/feedback/Toast";
import type { Remote } from "../../../../app/services/storage/schemas/remote";
import type {
  BulkAvailableTaxon,
  BulkCandidateParent,
  BulkCurrentTaxon,
  BulkMode,
} from "../../../../components/graph/BulkSelectionPopover";
import { tryParse, summarizeMutation, type ParsedId } from "./editModeHandlers";

export interface BulkHandlersDeps {
  remotes: () => Remote[];
  isRemoteAdmin: (remoteId: string | null) => boolean;
  editMode: () => boolean;
  multiSelection: () => Set<string>;
  setMultiSelection: (next: Set<string>) => void;
  setSelectedId: (next: string | null) => void;
  taxonItemsByHub: Map<string, Map<string, { id: string; label: string; albumCount: number }>>;
  taxonParentsByHub: Map<string, Map<string, string>>;
  taxonKindMetaByHub: Map<string, { label: string; color: string | null }>;
  taxonIdForNode: (p: ParsedId) => { taxonId: string; relHubId: string } | null;
  refreshHub: (relHubId: string) => Promise<void>;
  albumIdsForArtist: (remoteId: string, artistId: string) => string[];
}

export function createBulkHandlers(deps: BulkHandlersDeps) {
  const {
    remotes,
    isRemoteAdmin,
    editMode,
    multiSelection,
    setMultiSelection,
    setSelectedId,
    taxonItemsByHub,
    taxonParentsByHub,
    taxonIdForNode,
    refreshHub,
    albumIdsForArtist,
    taxonKindMetaByHub,
  } = deps;

  const bulkParsedSelection = createMemo(() => {
    const out: ParsedId[] = [];
    for (const id of multiSelection()) {
      const p = tryParse(id);
      if (p) out.push(p);
    }
    return out;
  });

  const bulkCounts = createMemo(() => {
    const c = { taxons: 0, albums: 0, artists: 0 };
    for (const p of bulkParsedSelection()) {
      if (p.kind === "value" || p.kind === "group") c.taxons += 1;
      else if (p.kind === "album") c.albums += 1;
      else if (p.kind === "artist") c.artists += 1;
    }
    return c;
  });

  const bulkMode = createMemo<BulkMode>(() => {
    const c = bulkCounts();
    if (c.taxons > 0 && c.albums === 0 && c.artists === 0) return "taxons";
    if (c.taxons === 0 && (c.albums > 0 || c.artists > 0)) return "media";
    return "mixed";
  });

  const bulkRemoteId = createMemo<string | null>(() => {
    let remote: string | null = null;
    for (const p of bulkParsedSelection()) {
      if (!("remoteId" in p)) continue;
      const rid = (p as { remoteId: string }).remoteId;
      if (remote === null) remote = rid;
      else if (remote !== rid) return null;
    }
    return remote;
  });

  const bulkKindSlug = createMemo<string | null>(() => {
    let kind: string | null = null;
    for (const p of bulkParsedSelection()) {
      if (p.kind !== "value" && p.kind !== "group") continue;
      const k = (p as { relationKind: string }).relationKind;
      if (kind === null) kind = k;
      else if (kind !== k) return null;
    }
    return kind;
  });

  const bulkRelHubId = createMemo<string | null>(() => {
    const rid = bulkRemoteId();
    const kind = bulkKindSlug();
    if (!rid || !kind) return null;
    return relationHubId(rid, kind);
  });

  const childrenForHub = (relHubId: string): Map<string, Set<string>> => {
    const out = new Map<string, Set<string>>();
    const parents = taxonParentsByHub.get(relHubId);
    if (!parents) return out;
    for (const [child, parent] of parents) {
      if (!out.has(parent)) out.set(parent, new Set());
      out.get(parent)!.add(child);
    }
    return out;
  };

  const bulkSelectedTaxonIds = createMemo<Set<string>>(() => {
    const out = new Set<string>();
    for (const p of bulkParsedSelection()) {
      if (p.kind !== "value" && p.kind !== "group") continue;
      const t = taxonIdForNode(p);
      if (t) out.add(t.taxonId);
    }
    return out;
  });

  const bulkAllGroups = createMemo<boolean>(() => {
    const hub = bulkRelHubId();
    const ids = bulkSelectedTaxonIds();
    if (!hub || ids.size === 0) return false;
    const children = childrenForHub(hub);
    for (const id of ids) {
      if (!children.has(id) || children.get(id)!.size === 0) return false;
    }
    return true;
  });

  const bulkCandidateParents = createMemo<BulkCandidateParent[]>(() => {
    const hub = bulkRelHubId();
    if (!hub) return [];
    const cache = taxonItemsByHub.get(hub);
    if (!cache) return [];
    const selected = bulkSelectedTaxonIds();
    const children = childrenForHub(hub);
    const banned = new Set<string>(selected);
    const queue: string[] = [...selected];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const kids = children.get(cur);
      if (!kids) continue;
      for (const k of kids) {
        if (!banned.has(k)) {
          banned.add(k);
          queue.push(k);
        }
      }
    }
    const out: BulkCandidateParent[] = [];
    for (const item of cache.values()) {
      if (banned.has(item.id)) continue;
      out.push({ id: item.id, label: item.label });
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  });

  const bulkAvailableTaxons = createMemo<BulkAvailableTaxon[]>(() => {
    const rid = bulkRemoteId();
    if (!rid) return [];
    const out: BulkAvailableTaxon[] = [];
    for (const [hubId, cache] of taxonItemsByHub) {
      let hubParsed: ParsedId | null;
      try {
        hubParsed = parseNodeId(hubId);
      } catch {
        continue;
      }
      if (!hubParsed || hubParsed.kind !== "relation") continue;
      if (hubParsed.remoteId !== rid) continue;
      const kindMeta = taxonKindMetaByHub.get(hubId);
      const kindLabel = kindMeta?.label ?? hubParsed.relationKind;
      const kindColor = kindMeta?.color ?? null;
      for (const item of cache.values()) {
        out.push({ id: item.id, label: item.label, kindLabel, kindColor });
      }
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  });

  const bulkCanEdit = createMemo<boolean>(() => {
    const rid = bulkRemoteId();
    return !!rid && isRemoteAdmin(rid);
  });

  const handleBulkReparent = async (parentTaxonId: string | null) => {
    const hub = bulkRelHubId();
    const rid = bulkRemoteId();
    if (!hub || !rid) return;
    if (!isRemoteAdmin(rid)) return;
    const remote = remotes().find((r) => r.remote_id === rid);
    if (!remote) return;
    const parents = taxonParentsByHub.get(hub);
    const client = await getClientForRemote(remote);
    const ops: Promise<unknown>[] = [];
    const children = childrenForHub(hub);
    const descendantsOfTarget = new Set<string>();
    if (parentTaxonId) {
      const queue = [parentTaxonId];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        const kids = children.get(cur);
        if (!kids) continue;
        for (const k of kids) {
          if (!descendantsOfTarget.has(k)) {
            descendantsOfTarget.add(k);
            queue.push(k);
          }
        }
      }
    }
    for (const taxonId of bulkSelectedTaxonIds()) {
      if (taxonId === parentTaxonId) continue;
      if (parentTaxonId && descendantsOfTarget.has(taxonId)) continue;
      const existing = parents?.get(taxonId);
      if (existing === parentTaxonId) continue;
      if (existing) {
        ops.push(client.music.removeTaxonParent({ child_id: taxonId, parent_id: existing }));
      }
      if (parentTaxonId) {
        ops.push(client.music.addTaxonParent({ child_id: taxonId, parent_id: parentTaxonId }));
      }
    }
    const results = await Promise.allSettled(ops);
    summarizeMutation("bulk re-parent", results);
    await refreshHub(hub);
  };

  const handleBulkSetColor = async (color: string | null) => {
    const rid = bulkRemoteId();
    if (!rid) return;
    if (!isRemoteAdmin(rid)) return;
    const remote = remotes().find((r) => r.remote_id === rid);
    if (!remote) return;
    const client = await getClientForRemote(remote);
    const ops: Promise<unknown>[] = [];
    for (const taxonId of bulkSelectedTaxonIds()) {
      ops.push(client.music.setTaxonColor({ taxon_id: taxonId, color }));
    }
    const results = await Promise.allSettled(ops);
    summarizeMutation("bulk set color", results);
    const hub = bulkRelHubId();
    if (hub) await refreshHub(hub);
  };

  const handleBulkDeleteTaxons = async () => {
    const rid = bulkRemoteId();
    if (!rid) return;
    if (!isRemoteAdmin(rid)) return;
    const remote = remotes().find((r) => r.remote_id === rid);
    if (!remote) return;
    const client = await getClientForRemote(remote);
    const ops: Promise<unknown>[] = [];
    for (const taxonId of bulkSelectedTaxonIds()) {
      ops.push(client.music.deleteTaxon({ id: taxonId }));
    }
    const results = await Promise.allSettled(ops);
    summarizeMutation("bulk delete", results);
    const hub = bulkRelHubId();
    setMultiSelection(new Set<string>());
    setSelectedId(null);
    if (hub) await refreshHub(hub);
  };

  const handleBulkAssignTaxon = async (taxonId: string) => {
    const rid = bulkRemoteId();
    if (!rid) return;
    if (!isRemoteAdmin(rid)) return;
    const remote = remotes().find((r) => r.remote_id === rid);
    if (!remote) return;
    const client = await getClientForRemote(remote);
    const albumIds = new Set<string>();
    for (const p of bulkParsedSelection()) {
      if (p.kind === "album") albumIds.add(p.albumId);
      else if (p.kind === "artist") {
        for (const aid of albumIdsForArtist(rid, p.artistId)) albumIds.add(aid);
      }
    }
    if (albumIds.size === 0) return;
    const ops: Promise<unknown>[] = [];
    for (const aid of albumIds) {
      ops.push(client.music.addAlbumTaxon({ album_id: aid, taxon_id: taxonId, origin: "manual" }));
    }
    const results = await Promise.allSettled(ops);
    summarizeMutation("bulk assign", results);
    invalidateLinksForAlbums(albumIds);
    for (const [hubId, cache] of taxonItemsByHub) {
      let found = false;
      for (const item of cache.values()) {
        if (item.id === taxonId) {
          found = true;
          break;
        }
      }
      if (found) {
        await refreshHub(hubId);
        break;
      }
    }
  };

  const bulkActive = createMemo<boolean>(() => editMode() && multiSelection().size >= 1);

  // ---- current-taxons intersection ---------------------------------------
  //
  // for the bulk-media popover's "currently applied" chip row. we cache
  // per-album links (and a `version` signal to invalidate after edits)
  // so re-renders don't re-fetch on every selection tweak.
  type CachedLink = {
    taxonId: string;
    kindSlug: string;
    label: string;
  };
  const linksByAlbum = new Map<string, CachedLink[]>();
  const linksInFlight = new Map<string, Promise<void>>();
  const [linksVersion, setLinksVersion] = createSignal(0);
  const bumpLinks = () => setLinksVersion((v) => v + 1);

  const fetchLinksForAlbum = async (
    rid: string,
    albumId: string,
    remote: Remote
  ): Promise<void> => {
    if (linksByAlbum.has(albumId)) return;
    let inflight = linksInFlight.get(albumId);
    if (!inflight) {
      inflight = (async () => {
        try {
          const client = await getClientForRemote(remote);
          const resp = await client.music.getAlbumTaxonLinks({ album_id: albumId });
          if (resp.success && resp.data) {
            const rows: CachedLink[] = (
              resp.data as Array<{ taxon_id: string; kind_slug: string; label: string }>
            ).map((l) => ({ taxonId: l.taxon_id, kindSlug: l.kind_slug, label: l.label }));
            linksByAlbum.set(albumId, rows);
          } else {
            linksByAlbum.set(albumId, []);
          }
        } catch (err) {
          console.warn("[graph] fetch album taxon links failed", { albumId, err });
          linksByAlbum.set(albumId, []);
        } finally {
          linksInFlight.delete(albumId);
          bumpLinks();
        }
      })();
      linksInFlight.set(albumId, inflight);
      void rid;
    }
    await inflight;
  };

  // collect every album id covered by the current bulk selection
  // (direct + artist fan-out). pure derivation from existing state.
  const bulkAlbumIds = createMemo<Set<string>>(() => {
    const rid = bulkRemoteId();
    const out = new Set<string>();
    if (!rid) return out;
    for (const p of bulkParsedSelection()) {
      if (p.kind === "album") out.add(p.albumId);
      else if (p.kind === "artist") {
        for (const aid of albumIdsForArtist(rid, p.artistId)) out.add(aid);
      }
    }
    return out;
  });

  // chip row data: intersection of taxons applied to every album in
  // the selection. only renders when at least one album is in scope.
  // reads `linksVersion()` so add/remove mutations re-derive.
  const bulkCurrentTaxons = createMemo<BulkCurrentTaxon[]>(() => {
    linksVersion(); // dependency
    const rid = bulkRemoteId();
    if (!rid) return [];
    const remote = remotes().find((r) => r.remote_id === rid);
    if (!remote) return [];
    const albumIds = Array.from(bulkAlbumIds());
    if (albumIds.length === 0) return [];

    // kick off lazy fetches for any missing entries. these resolve
    // asynchronously and call bumpLinks(), which retriggers this memo.
    let missing = false;
    for (const aid of albumIds) {
      if (!linksByAlbum.has(aid)) {
        missing = true;
        void fetchLinksForAlbum(rid, aid, remote);
      }
    }
    if (missing) return [];

    // intersection of taxon ids across every album in the selection.
    let intersection: Set<string> | null = null;
    const metaByTaxonId = new Map<string, CachedLink>();
    for (const aid of albumIds) {
      const links = linksByAlbum.get(aid) ?? [];
      const ids = new Set<string>();
      for (const l of links) {
        ids.add(l.taxonId);
        if (!metaByTaxonId.has(l.taxonId)) metaByTaxonId.set(l.taxonId, l);
      }
      if (intersection === null) intersection = ids;
      else {
        const next = new Set<string>();
        for (const id of intersection) if (ids.has(id)) next.add(id);
        intersection = next;
      }
      if (intersection.size === 0) break;
    }
    if (!intersection || intersection.size === 0) return [];

    const out: BulkCurrentTaxon[] = [];
    for (const id of intersection) {
      const meta = metaByTaxonId.get(id);
      if (!meta) continue;
      const hubId = relationHubId(rid, meta.kindSlug);
      const kindMeta = taxonKindMetaByHub.get(hubId);
      out.push({
        id: meta.taxonId,
        label: meta.label,
        kindSlug: meta.kindSlug,
        kindLabel: kindMeta?.label ?? meta.kindSlug,
        kindColor: kindMeta?.color ?? null,
      });
    }
    out.sort((a, b) => a.kindLabel.localeCompare(b.kindLabel) || a.label.localeCompare(b.label));
    return out;
  });

  const invalidateLinksForAlbums = (albumIds: Iterable<string>) => {
    for (const aid of albumIds) linksByAlbum.delete(aid);
    bumpLinks();
  };

  const handleBulkRemoveTaxon = async (taxonId: string) => {
    const rid = bulkRemoteId();
    if (!rid) return;
    if (!isRemoteAdmin(rid)) return;
    const remote = remotes().find((r) => r.remote_id === rid);
    if (!remote) return;
    const albumIds = Array.from(bulkAlbumIds());
    if (albumIds.length === 0) return;
    const client = await getClientForRemote(remote);
    const ops: Promise<unknown>[] = [];
    const touched: string[] = [];
    for (const aid of albumIds) {
      const links = linksByAlbum.get(aid);
      // skip albums known to lack the link (cheap optimization). when
      // the cache is cold we still send the call — server ignores noop.
      if (links && !links.some((l) => l.taxonId === taxonId)) continue;
      touched.push(aid);
      ops.push(
        client.music.removeAlbumTaxon({
          album_id: aid,
          taxon_id: taxonId,
          origin: null,
        })
      );
    }
    if (ops.length === 0) return;
    const results = await Promise.allSettled(ops);
    summarizeMutation("bulk remove taxon", results);
    invalidateLinksForAlbums(touched);
    // refresh the hub for the kind that owned the removed taxon so
    // its album-count badge updates and the value node disappears if
    // it dropped to zero.
    for (const [hubId, cache] of taxonItemsByHub) {
      let found = false;
      for (const item of cache.values()) {
        if (item.id === taxonId) {
          found = true;
          break;
        }
      }
      if (found) {
        await refreshHub(hubId);
        break;
      }
    }
  };

  const handleBulkGroupSelection = async (
    label: string
  ): Promise<{ newTaxonId: string | null }> => {
    const rid = bulkRemoteId();
    const hub = bulkRelHubId();
    const kind = bulkKindSlug();
    if (!rid || !hub || !kind) return { newTaxonId: null };
    if (!isRemoteAdmin(rid)) return { newTaxonId: null };
    const remote = remotes().find((r) => r.remote_id === rid);
    if (!remote) return { newTaxonId: null };
    const trimmed = label.trim();
    if (!trimmed) return { newTaxonId: null };
    const client = await getClientForRemote(remote);

    const created = await client.music.createTaxon({
      kind_slug: kind,
      label: trimmed,
    });
    if (!created.success || !created.data) {
      console.warn("[graph] group selection: create taxon failed", created);
      toast.error("failed to create group taxon");
      return { newTaxonId: null };
    }
    const newId = created.data.id;
    const parents = taxonParentsByHub.get(hub);
    const ops: Promise<unknown>[] = [];
    for (const taxonId of bulkSelectedTaxonIds()) {
      if (taxonId === newId) continue;
      const existing = parents?.get(taxonId);
      if (existing === newId) continue;
      if (existing) {
        ops.push(client.music.removeTaxonParent({ child_id: taxonId, parent_id: existing }));
      }
      ops.push(client.music.addTaxonParent({ child_id: taxonId, parent_id: newId }));
    }
    const results = await Promise.allSettled(ops);
    summarizeMutation(`group as '${trimmed}'`, results);
    await refreshHub(hub);
    return { newTaxonId: newId };
  };

  return {
    bulkParsedSelection,
    bulkCounts,
    bulkMode,
    bulkRemoteId,
    bulkKindSlug,
    bulkRelHubId,
    bulkSelectedTaxonIds,
    bulkAllGroups,
    bulkCandidateParents,
    bulkAvailableTaxons,
    bulkCurrentTaxons,
    bulkCanEdit,
    bulkActive,
    handleBulkReparent,
    handleBulkSetColor,
    handleBulkDeleteTaxons,
    handleBulkAssignTaxon,
    handleBulkRemoveTaxon,
    handleBulkGroupSelection,
    invalidateLinksForAlbums,
  };
}
