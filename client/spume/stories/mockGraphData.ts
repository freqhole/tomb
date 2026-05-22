// mock graph data for the album graph viz storybook.
//
// design goal: reuse as much of the existing storybook mock data as possible
// (mockArtists, mockAlbums, mockGenres, mockTags from mockData.ts) and layer
// on the extra metadata the graph viz needs — moods, styles, era buckets,
// labels, related-artist links, weighted tags.
//
// this keeps a single source of truth for names, ids, thumbnails, etc.
// across all storybook stories.

import type { AlbumNodeData, TagRef } from "../src/components/graph/types";
import {
  mockAlbums,
  mockArtists,
  mockGenres,
  mockTags,
  type Album,
  type Artist,
} from "./mockData";

// ---- enrichment pools ------------------------------------------------------

const MOOD_POOL = [
  "uplifting",
  "melancholic",
  "energetic",
  "chill",
  "dark",
  "dreamy",
  "aggressive",
  "romantic",
  "nostalgic",
  "hypnotic",
  "somber",
  "euphoric",
];

const STYLE_POOL = [
  "psychedelic",
  "lo-fi",
  "garage",
  "post-punk",
  "dream pop",
  "hard bop",
  "modal",
  "ambient",
  "breakbeat",
  "shoegaze",
  "math rock",
  "drone",
  "no wave",
  "krautrock",
  "noise",
];

const LABEL_POOL = [
  "Sub Pop",
  "Matador",
  "Warp",
  "4AD",
  "Dischord",
  "Stones Throw",
  "Domino",
  "Drag City",
  "Constellation",
  "Touch and Go",
  "XL Recordings",
  "Ninja Tune",
];

// ---- deterministic prng (mulberry32) so stories are stable ----------------

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashId(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function pick<T>(arr: T[], r: () => number): T {
  return arr[Math.floor(r() * arr.length)];
}

function pickN<T>(arr: T[], n: number, r: () => number): T[] {
  if (n >= arr.length) return [...arr];
  const out = new Set<T>();
  while (out.size < n) out.add(pick(arr, r));
  return [...out];
}

function eraBucket(year: number | null): string | null {
  if (!year) return null;
  const start = Math.floor(year / 5) * 5;
  return `${start}-${start + 4}`;
}

// ---- artist index ---------------------------------------------------------

const artistByName = new Map<string, Artist>(mockArtists.map((a) => [a.name, a]));

function artistIdFor(name: string): string {
  const hit = artistByName.get(name);
  if (hit) return hit.id;
  // synthetic id for artists referenced by albums but missing from mockArtists
  return `artist-syn-${hashId(name) % 10000}`;
}

// build related-artist links once: each artist gets 2-4 stable links to other
// artists from the same dataset. used as the seed for related_artist edges.
function buildRelatedArtistMap(): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const a of mockArtists) {
    const r = rng(hashId(a.id));
    const count = 2 + Math.floor(r() * 3);
    const links: string[] = [];
    let attempts = 0;
    while (links.length < count && attempts < 20) {
      attempts++;
      const candidate = mockArtists[Math.floor(r() * mockArtists.length)];
      if (candidate.id === a.id) continue;
      if (links.includes(candidate.id)) continue;
      links.push(candidate.id);
    }
    m.set(a.id, links);
  }
  return m;
}

const RELATED_ARTISTS = buildRelatedArtistMap();

// ---- per-album enrichment -------------------------------------------------

export interface EnrichOptions {
  /** force a specific image url (or null) instead of the album's default */
  imageOverride?: string | null;
  /** override the chance of dropping the image (default 0.1) */
  noImageChance?: number;
}

/**
 * enrich a mockData Album with the extra metadata fields the graph viz needs.
 * deterministic per album id.
 */
export function enrichAlbum(
  album: Album,
  opts: EnrichOptions = {}
): AlbumNodeData {
  const r = rng(hashId(album.id));
  const artistId = artistIdFor(album.artist);

  // genres: 1-2 from the existing genre pool, biased by the artist's genres
  // when available
  const artist = artistByName.get(album.artist);
  const genrePool = mockGenres.map((g) => g.name);
  const primaryGenre =
    artist && artist.genres.length > 0 && r() < 0.6
      ? pick(artist.genres, r)
      : pick(genrePool, r);
  const genres =
    r() < 0.4
      ? [primaryGenre, pick(genrePool, r)].filter(
          (v, i, a) => a.indexOf(v) === i
        )
      : [primaryGenre];

  // tags: 2-5 from mockTags with weights derived from their counts
  const tagCount = 2 + Math.floor(r() * 4);
  const tagPicks = pickN(mockTags, tagCount, r);
  const maxTagCount = Math.max(...mockTags.map((t) => t.count), 1);
  const tags: TagRef[] = tagPicks.map((t) => ({
    label: t.label,
    weight: Math.max(0.1, t.count / maxTagCount),
  }));

  // moods + styles: 0-3 each, with a chunk of albums getting none
  const moods = r() < 0.7 ? pickN(MOOD_POOL, 1 + Math.floor(r() * 2), r) : [];
  const styles =
    r() < 0.65 ? pickN(STYLE_POOL, 1 + Math.floor(r() * 2), r) : [];

  // label: ~60% have one
  const label = r() < 0.6 ? pick(LABEL_POOL, r) : null;

  // image: ~10% missing by default
  const noImageChance = opts.noImageChance ?? 0.1;
  const imageUrl =
    opts.imageOverride !== undefined
      ? opts.imageOverride
      : r() < noImageChance
        ? null
        : album.thumbnailUrl;

  const relatedArtistIds = RELATED_ARTISTS.get(artistId) ?? [];

  return {
    id: album.id,
    title: album.title,
    artistId,
    artistName: album.artist,
    year: album.year,
    imageUrl,
    image: imageUrl
      ? { remote_url: imageUrl, is_primary: true, blob_type: "thumbnail" }
      : null,
    genres,
    tags,
    moods,
    styles,
    label,
    era: eraBucket(album.year),
    relatedArtistIds,
    trackCount: album.trackCount,
    totalDurationSec: album.duration,
    rating: album.rating,
    isFavorite: r() < 0.2,
  };
}

// ---- ready-made datasets --------------------------------------------------

/** the 22 hand-curated mockAlbums, enriched for the graph viz. */
export const mockGraphAlbums: AlbumNodeData[] = mockAlbums.map((a) =>
  enrichAlbum(a)
);

/**
 * generate `count` graph albums by cycling/repeating the existing mock pools
 * (artists, albums, genres, tags). useful for storybook scale stories
 * (200, 2000, 10000 nodes).
 *
 * artist + album titles repeat at larger counts (with disambiguating ids),
 * which is fine for viz testing — connectivity patterns are what matters.
 */
export function generateGraphAlbums(count: number, seed = 42): AlbumNodeData[] {
  const out: AlbumNodeData[] = [];
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const base = mockAlbums[i % mockAlbums.length];
    const artist = mockArtists[i % mockArtists.length];
    // synthesize a unique id while keeping referential overlap on title/artist
    const id = `gen-album-${i}`;
    // ~10% missing art, deterministic on id
    const noArt = r() < 0.1;
    const synthetic: Album = {
      ...base,
      id,
      artist: artist.name,
      // give each generated album a slightly varied thumbnail seed so the
      // viz isn't a sea of identical art
      thumbnailUrl: `https://picsum.photos/seed/graph-${i}/300/300`,
      year:
        base.year +
        // jitter the year a little for era diversity
        Math.floor((r() - 0.5) * 30),
    };
    out.push(
      enrichAlbum(synthetic, {
        imageOverride: noArt ? null : synthetic.thumbnailUrl,
      })
    );
  }
  return out;
}

/** small (22), medium (200), and large (2000) pre-built datasets. */
export const SMALL_GRAPH = mockGraphAlbums;
export const MEDIUM_GRAPH = generateGraphAlbums(200);
export const LARGE_GRAPH = generateGraphAlbums(2000);
