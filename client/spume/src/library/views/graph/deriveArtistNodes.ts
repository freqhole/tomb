// deriveArtistNodes
//
// projects the unique in-library artists out of a flat album-node list
// into circle-avatar `ArtistNodeData` records. used by the library
// graph subview when the content-kind selector is set to `artists` or
// `both`.
//
// rules:
// - one artist node per unique `artistId` (cross-remote merge —
//   sibling remotes pointing at the same artist collapse into one
//   node). when the same artist exists under different remote ids, we
//   pick the first non-empty name we see.
// - taxonomic fields are *unioned* across the artist's albums so the
//   existing relation builders (genre / tag / mood / style / favorite)
//   light up artist↔artist wires using the same machinery as
//   album↔album. era + label pick the most common value across the
//   artist's catalog.
// - image is the primary image of the first album we see that has
//   one. better than nothing while a proper artist-image fetch isn't
//   wired up.

import type { AlbumNodeData, ArtistNodeData, TagRef } from "../../../components/graph/types";
import { getArtistAbbreviation } from "../../../music/utils/format";

export const ARTIST_NODE_ID_PREFIX = "artist::";

export function artistNodeId(artistId: string): string {
  return `${ARTIST_NODE_ID_PREFIX}${artistId}`;
}

/** true when an id was produced by `artistNodeId`. */
export function isArtistNodeId(id: string): boolean {
  return id.startsWith(ARTIST_NODE_ID_PREFIX);
}

interface ArtistAccum {
  artistId: string;
  name: string;
  imageUrl: string | null;
  image: AlbumNodeData["image"];
  albumCount: number;
  genres: Set<string>;
  moods: Set<string>;
  styles: Set<string>;
  tags: Map<string, number>; // label → max weight
  labelCounts: Map<string, number>;
  eraCounts: Map<string, number>;
  sourceRemoteIds: Set<string>;
}

function pickMostCommon(m: Map<string, number>): string | null {
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of m) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

export function deriveArtistNodes(
  albums: AlbumNodeData[],
  favoriteArtistIds?: ReadonlySet<string>,
): ArtistNodeData[] {
  const byArtist = new Map<string, ArtistAccum>();
  for (const a of albums) {
    if (!a.artistId) continue;
    let acc = byArtist.get(a.artistId);
    if (!acc) {
      acc = {
        artistId: a.artistId,
        name: a.artistName || "",
        imageUrl: null,
        image: null,
        albumCount: 0,
        genres: new Set(),
        moods: new Set(),
        styles: new Set(),
        tags: new Map(),
        labelCounts: new Map(),
        eraCounts: new Map(),
        sourceRemoteIds: new Set(),
      };
      byArtist.set(a.artistId, acc);
    }
    if (!acc.name && a.artistName) acc.name = a.artistName;
    acc.albumCount++;
    if (!acc.image && a.image) acc.image = a.image;
    if (!acc.imageUrl && a.imageUrl) acc.imageUrl = a.imageUrl;
    for (const g of a.genres) if (g) acc.genres.add(g);
    for (const m of a.moods) if (m) acc.moods.add(m);
    for (const s of a.styles) if (s) acc.styles.add(s);
    for (const t of a.tags) {
      if (!t.label) continue;
      const prev = acc.tags.get(t.label) ?? 0;
      if (t.weight > prev) acc.tags.set(t.label, t.weight);
    }
    if (a.label) acc.labelCounts.set(a.label, (acc.labelCounts.get(a.label) ?? 0) + 1);
    if (a.era) acc.eraCounts.set(a.era, (acc.eraCounts.get(a.era) ?? 0) + 1);
    // union contributing remotes — prefer modern `sourceRemoteIds`,
    // fall back to the legacy single id for back-compat.
    if (a.sourceRemoteIds && a.sourceRemoteIds.length > 0) {
      for (const r of a.sourceRemoteIds) acc.sourceRemoteIds.add(r);
    } else if (a.sourceRemoteId) {
      acc.sourceRemoteIds.add(a.sourceRemoteId);
    }
  }

  const out: ArtistNodeData[] = [];
  for (const acc of byArtist.values()) {
    const tags: TagRef[] = [];
    for (const [label, weight] of acc.tags) tags.push({ label, weight });
    out.push({
      id: artistNodeId(acc.artistId),
      kind: "artist",
      artistId: acc.artistId,
      name: acc.name || acc.artistId,
      abbreviation: getArtistAbbreviation(acc.name || acc.artistId),
      imageUrl: acc.imageUrl,
      image: acc.image,
      albumCount: acc.albumCount,
      genres: Array.from(acc.genres),
      moods: Array.from(acc.moods),
      styles: Array.from(acc.styles),
      tags,
      label: pickMostCommon(acc.labelCounts),
      era: pickMostCommon(acc.eraCounts),
      isFavorite: favoriteArtistIds?.has(acc.artistId) ?? false,
      sourceRemoteIds: Array.from(acc.sourceRemoteIds),
    });
  }
  // stable order by name for deterministic id-sorted edge building
  // downstream (buildRelationEdges sorts by id; this is a nicety for
  // any consumer that iterates the array directly).
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
