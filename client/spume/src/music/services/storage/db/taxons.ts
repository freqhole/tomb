// taxon + album_taxon crud
//
// the taxons store holds genre/mood/era/label/... rows scoped to the
// owning library (local or a specific peer remote). the album_taxons
// junction is the authoritative source for cross-album / cross-artist
// taxon nav (the per-song `album_taxons` ref array on `songs` is a
// denormalized convenience for the single-album views and is kept in
// sync where possible, but graph viz reads through the junction).
import { initMusicDB } from "./init";
import { slug as toSlug } from "../../../../components/graph/data/nodeIds";
import {
  type AlbumTaxonRow,
  type EntityTaxonRow,
  type TaxonRow,
  LOCAL_TAXON_REMOTE_ID,
  STORE_ALBUMS,
  STORE_ALBUM_TAXONS,
  STORE_ENTITY_TAXONS,
  STORE_TAXONS,
} from "../types";

export interface UpsertTaxonInput {
  /** when omitted, defaults to `LOCAL_TAXON_REMOTE_ID`. */
  remote_id?: string;
  /** existing id from the source library; when omitted a uuid is
   *  generated (intended for local-origin taxons). */
  taxon_id?: string;
  kind_slug: string;
  label: string;
}

// upsert a taxon row, deduping on `(remote_id, kind_slug, slug(label))`.
// returns the resulting row (either the freshly inserted one or the
// pre-existing match with `updated_at` refreshed).
export async function upsertTaxon(input: UpsertTaxonInput): Promise<TaxonRow> {
  const db = await initMusicDB();
  const remoteId = input.remote_id ?? LOCAL_TAXON_REMOTE_ID;
  const kindSlug = input.kind_slug;
  const labelSlug = toSlug(input.label);
  if (!labelSlug) {
    throw new Error("taxon label must contain at least one alphanumeric char");
  }

  const tx = db.transaction(STORE_TAXONS, "readwrite");
  const store = tx.objectStore(STORE_TAXONS);
  const idx = store.index("by_remote_kind_slug");
  const existing = (await idx.get([remoteId, kindSlug, labelSlug])) as TaxonRow | undefined;
  const now = Date.now();
  let row: TaxonRow;
  if (existing) {
    row = { ...existing, label: input.label, updated_at: now };
    await store.put(row);
  } else {
    row = {
      taxon_id: input.taxon_id ?? crypto.randomUUID(),
      remote_id: remoteId,
      kind_slug: kindSlug,
      label: input.label,
      slug: labelSlug,
      created_at: now,
      updated_at: now,
    };
    await store.put(row);
  }
  await tx.done;
  return row;
}

export async function getTaxonById(taxonId: string): Promise<TaxonRow | undefined> {
  const db = await initMusicDB();
  return (await db.get(STORE_TAXONS, taxonId)) as TaxonRow | undefined;
}

// look up a taxon by its dedup key without inserting. handy for the
// edit modal "does this label exist?" check before showing a confirm
// prompt.
export async function findTaxon(
  remoteId: string,
  kindSlug: string,
  label: string
): Promise<TaxonRow | undefined> {
  const labelSlug = toSlug(label);
  if (!labelSlug) return undefined;
  const db = await initMusicDB();
  const idx = db.transaction(STORE_TAXONS).store.index("by_remote_kind_slug");
  return (await idx.get([remoteId, kindSlug, labelSlug])) as TaxonRow | undefined;
}

// list taxons, optionally filtered by remote / kind / case-insensitive
// label substring. used by the local searchSuggestions impl and by
// the explore graph viz to populate kind groups.
export async function queryTaxons(
  opts: {
    remote_id?: string;
    kind_slug?: string;
    partial?: string;
    limit?: number;
  } = {}
): Promise<TaxonRow[]> {
  const db = await initMusicDB();
  const limit = opts.limit ?? 1000;
  let rows: TaxonRow[];
  if (opts.remote_id) {
    rows = (await db.getAllFromIndex(STORE_TAXONS, "by_remote_id", opts.remote_id)) as TaxonRow[];
  } else if (opts.kind_slug) {
    rows = (await db.getAllFromIndex(STORE_TAXONS, "by_kind_slug", opts.kind_slug)) as TaxonRow[];
  } else {
    rows = (await db.getAll(STORE_TAXONS)) as TaxonRow[];
  }
  if (opts.kind_slug) {
    rows = rows.filter((r) => r.kind_slug === opts.kind_slug);
  }
  if (opts.remote_id && rows.length > 0 && rows[0].remote_id !== opts.remote_id) {
    rows = rows.filter((r) => r.remote_id === opts.remote_id);
  }
  if (opts.partial) {
    const needle = opts.partial.toLowerCase();
    rows = rows.filter((r) => r.label.toLowerCase().includes(needle));
  }
  return rows.slice(0, limit);
}

export async function deleteTaxon(taxonId: string): Promise<void> {
  const db = await initMusicDB();
  const tx = db.transaction([STORE_TAXONS, STORE_ALBUM_TAXONS, STORE_ENTITY_TAXONS], "readwrite");
  await tx.objectStore(STORE_TAXONS).delete(taxonId);
  // cascade: remove every junction row pointing at this taxon.
  const junction = tx.objectStore(STORE_ALBUM_TAXONS);
  const junctionIdx = junction.index("by_taxon_id");
  let cursor = await junctionIdx.openCursor(taxonId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  // cascade to generic entity junctions too. `by_taxon_id` there is
  // composite `[entity_type, taxon_id]` (scoped lookups need
  // entity_type), so a taxon-only cascade has to scan all rows.
  const entityJunction = tx.objectStore(STORE_ENTITY_TAXONS);
  let entityCursor = await entityJunction.openCursor();
  while (entityCursor) {
    if ((entityCursor.value as EntityTaxonRow).taxon_id === taxonId) {
      await entityCursor.delete();
    }
    entityCursor = await entityCursor.continue();
  }
  await tx.done;
}

// link an album to a taxon (idempotent). `remote_id` defaults to the
// taxon's owning remote so we never end up with a junction row whose
// `remote_id` disagrees with its taxon.
export async function linkAlbumTaxon(albumId: string, taxonId: string): Promise<void> {
  const db = await initMusicDB();
  const tx = db.transaction([STORE_TAXONS, STORE_ALBUM_TAXONS], "readwrite");
  const taxon = (await tx.objectStore(STORE_TAXONS).get(taxonId)) as TaxonRow | undefined;
  if (!taxon) {
    await tx.done;
    throw new Error(`linkAlbumTaxon: taxon ${taxonId} not found`);
  }
  const junction = tx.objectStore(STORE_ALBUM_TAXONS);
  const existing = await junction.get([albumId, taxonId]);
  if (!existing) {
    const row: AlbumTaxonRow = {
      album_id: albumId,
      taxon_id: taxonId,
      remote_id: taxon.remote_id,
      created_at: Date.now(),
    };
    await junction.put(row);
  }
  await tx.done;
}

export async function unlinkAlbumTaxon(albumId: string, taxonId: string): Promise<void> {
  const db = await initMusicDB();
  await db.delete(STORE_ALBUM_TAXONS, [albumId, taxonId]);
}

// every taxon attached to an album (across all kinds). returns the
// hydrated `TaxonRow`s so callers can render label / kind directly.
export async function getAlbumTaxons(albumId: string): Promise<TaxonRow[]> {
  const db = await initMusicDB();
  const junctionRows = (await db.getAllFromIndex(
    STORE_ALBUM_TAXONS,
    "by_album_id",
    albumId
  )) as AlbumTaxonRow[];
  if (junctionRows.length === 0) return [];
  const tx = db.transaction(STORE_TAXONS);
  const store = tx.objectStore(STORE_TAXONS);
  const taxons: TaxonRow[] = [];
  for (const j of junctionRows) {
    const t = (await store.get(j.taxon_id)) as TaxonRow | undefined;
    if (t) taxons.push(t);
  }
  return taxons;
}

// every album linked to a taxon. used by the graph viz when the user
// expands a taxon hub to fan out into the contributing albums.
export async function getAlbumIdsByTaxon(taxonId: string): Promise<string[]> {
  const db = await initMusicDB();
  const rows = (await db.getAllFromIndex(
    STORE_ALBUM_TAXONS,
    "by_taxon_id",
    taxonId
  )) as AlbumTaxonRow[];
  return rows.map((r) => r.album_id);
}

// ===== generic entity_taxons junction (non-album entities, e.g. video) =====
//
// mirrors the album functions above but keyed by `(entity_type,
// entity_id, taxon_id)` so any entity kind can attach taxons without a
// dedicated store. album keeps using its own `AlbumTaxonRow` /
// `STORE_ALBUM_TAXONS` above - this is purely additive.

// link an entity to a taxon (idempotent). `remote_id` defaults to the
// taxon's owning remote so we never end up with a junction row whose
// `remote_id` disagrees with its taxon.
export async function linkEntityTaxon(
  entityType: string,
  entityId: string,
  taxonId: string
): Promise<void> {
  const db = await initMusicDB();
  const tx = db.transaction([STORE_TAXONS, STORE_ENTITY_TAXONS], "readwrite");
  const taxon = (await tx.objectStore(STORE_TAXONS).get(taxonId)) as TaxonRow | undefined;
  if (!taxon) {
    await tx.done;
    throw new Error(`linkEntityTaxon: taxon ${taxonId} not found`);
  }
  const junction = tx.objectStore(STORE_ENTITY_TAXONS);
  const existing = await junction.get([entityType, entityId, taxonId]);
  if (!existing) {
    const row: EntityTaxonRow = {
      entity_type: entityType,
      entity_id: entityId,
      taxon_id: taxonId,
      remote_id: taxon.remote_id,
      created_at: Date.now(),
    };
    await junction.put(row);
  }
  await tx.done;
}

export async function unlinkEntityTaxon(
  entityType: string,
  entityId: string,
  taxonId: string
): Promise<void> {
  const db = await initMusicDB();
  await db.delete(STORE_ENTITY_TAXONS, [entityType, entityId, taxonId]);
}

// every taxon attached to an entity (across all kinds). returns the
// hydrated `TaxonRow`s so callers can render label / kind directly.
export async function getEntityTaxons(entityType: string, entityId: string): Promise<TaxonRow[]> {
  const db = await initMusicDB();
  const junctionRows = (await db.getAllFromIndex(STORE_ENTITY_TAXONS, "by_entity_id", [
    entityType,
    entityId,
  ])) as EntityTaxonRow[];
  if (junctionRows.length === 0) return [];
  const tx = db.transaction(STORE_TAXONS);
  const store = tx.objectStore(STORE_TAXONS);
  const taxons: TaxonRow[] = [];
  for (const j of junctionRows) {
    const t = (await store.get(j.taxon_id)) as TaxonRow | undefined;
    if (t) taxons.push(t);
  }
  return taxons;
}

// every entity id (of a given entity_type) linked to a taxon. mirrors
// `getAlbumIdsByTaxon` for the graph viz taxon-hub fan-out.
export async function getEntityIdsByTaxon(entityType: string, taxonId: string): Promise<string[]> {
  const db = await initMusicDB();
  const rows = (await db.getAllFromIndex(STORE_ENTITY_TAXONS, "by_taxon_id", [
    entityType,
    taxonId,
  ])) as EntityTaxonRow[];
  return rows.map((r) => r.entity_id);
}

// distinct kind_slugs actually linked to at least one entity of the
// given type (e.g. "video"). the flat `taxons` store has no per-kind
// domain of its own (it's shared/global, populated from whatever
// remote synced values down for autocomplete), so this is the only
// reliable way to scope "which kinds apply to this entity type" for
// local/offline storage — presence in `taxons` alone says nothing
// about which entity types actually use a kind.
export async function getKindSlugsLinkedToEntityType(entityType: string): Promise<Set<string>> {
  const db = await initMusicDB();
  const junctionRows = (await db.getAllFromIndex(
    STORE_ENTITY_TAXONS,
    "by_entity_type",
    entityType
  )) as EntityTaxonRow[];
  const taxonIds = [...new Set(junctionRows.map((r) => r.taxon_id))];
  const tx = db.transaction(STORE_TAXONS);
  const store = tx.objectStore(STORE_TAXONS);
  const slugs = new Set<string>();
  for (const taxonId of taxonIds) {
    const taxon = (await store.get(taxonId)) as TaxonRow | undefined;
    if (taxon) slugs.add(taxon.kind_slug);
  }
  return slugs;
}

// distinct-album counts per kind_slug for a single remote, plus the
// "unassigned" tally (albums with no junction row). single full-store
// scan over taxons + junctions; intended for first-order hub seeding
// in the graph viz, where counts drive whether a hub renders at all.
export async function countAlbumsByKindForRemote(
  remoteId: string
): Promise<{ byKind: Map<string, number>; unassigned: number }> {
  const db = await initMusicDB();
  // taxon_id -> kind_slug, restricted to this remote.
  const taxons = (await db.getAllFromIndex(STORE_TAXONS, "by_remote_id", remoteId)) as TaxonRow[];
  const kindByTaxon = new Map<string, string>();
  for (const t of taxons) kindByTaxon.set(t.taxon_id, t.kind_slug);
  // (kind_slug, album_id) -> seen, for distinct-album counts.
  const seenByKind = new Map<string, Set<string>>();
  const assignedAlbums = new Set<string>();
  const junctions = (await db.getAllFromIndex(
    STORE_ALBUM_TAXONS,
    "by_remote_id",
    remoteId
  )) as AlbumTaxonRow[];
  for (const j of junctions) {
    const kind = kindByTaxon.get(j.taxon_id);
    if (!kind) continue;
    assignedAlbums.add(j.album_id);
    let set = seenByKind.get(kind);
    if (!set) {
      set = new Set();
      seenByKind.set(kind, set);
    }
    set.add(j.album_id);
  }
  const byKind = new Map<string, number>();
  for (const [k, set] of seenByKind) byKind.set(k, set.size);
  // unassigned = local albums minus those with any taxon link. only
  // makes sense for the local remote (`assignedAlbums` only tracks
  // local junctions; peer junctions live under peer remote_ids and
  // the peer's own server computes unassigned for itself).
  let unassigned = 0;
  if (remoteId === LOCAL_TAXON_REMOTE_ID) {
    const allAlbums = (await db.getAll(STORE_ALBUMS)) as { album_id: string }[];
    for (const a of allAlbums) {
      if (!assignedAlbums.has(a.album_id)) unassigned += 1;
    }
  }
  return { byKind, unassigned };
}

// list every local album_id that has no junction row (i.e. albums
// with no taxon assignments at all). only meaningful for the local
// remote; peers' unassigned lists come from their server.
export async function listUnassignedLocalAlbumIds(): Promise<string[]> {
  const db = await initMusicDB();
  const junctions = (await db.getAllFromIndex(
    STORE_ALBUM_TAXONS,
    "by_remote_id",
    LOCAL_TAXON_REMOTE_ID
  )) as AlbumTaxonRow[];
  const assigned = new Set<string>();
  for (const j of junctions) assigned.add(j.album_id);
  const allAlbums = (await db.getAll(STORE_ALBUMS)) as { album_id: string }[];
  const out: string[] = [];
  for (const a of allAlbums) {
    if (!assigned.has(a.album_id)) out.push(a.album_id);
  }
  return out;
}

// wipe every taxon + junction row owned by a given remote. used when
// the user removes a peer (so its cached taxons don't linger forever)
// and when a full re-sync wants to start from scratch.
export async function clearTaxonsForRemote(remoteId: string): Promise<void> {
  const db = await initMusicDB();
  const tx = db.transaction([STORE_TAXONS, STORE_ALBUM_TAXONS], "readwrite");
  const taxonsIdx = tx.objectStore(STORE_TAXONS).index("by_remote_id");
  let tCursor = await taxonsIdx.openCursor(remoteId);
  while (tCursor) {
    await tCursor.delete();
    tCursor = await tCursor.continue();
  }
  const junctionIdx = tx.objectStore(STORE_ALBUM_TAXONS).index("by_remote_id");
  let jCursor = await junctionIdx.openCursor(remoteId);
  while (jCursor) {
    await jCursor.delete();
    jCursor = await jCursor.continue();
  }
  await tx.done;
}
