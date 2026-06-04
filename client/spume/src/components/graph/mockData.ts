// synthetic two-remote dataset for story/prototype work.
// shaped to mirror real grimoire data (remote → relation → value → artist → album)
// so swapping in real api calls later is mechanical.

import type { WalkGraph, WalkNode, WalkEdge } from "./types";
import { remote, relation, value, edge } from "./mockData/factories";
import { LOCAL_ARTISTS, LOCAL_ALBUMS, LOCAL_GHOSTS } from "./mockData/localData";
import { RAID_ARTISTS, RAID_ALBUMS } from "./mockData/raidData";
import {
  LOCAL_RELATIONS,
  LOCAL_GENRES,
  LOCAL_TAGS,
  LOCAL_ERAS,
  LOCAL_MOODS,
} from "./mockData/localTaxonomy";
import {
  ARTIST_ALBUMS,
  GENRE_ARTISTS,
  GENRE_ALBUMS,
  MOOD_ALBUMS,
  TAG_ARTISTS,
  FAVORITE_ARTISTS,
  RECENT_ALBUMS,
  ERA_ARTISTS,
  COLLAB_PAIRS,
  ARTIST_SIMILAR,
} from "./mockData/localEdges";
import {
  RAID_RELATIONS,
  RAID_GENRES,
  RAID_ARTIST_ALBUMS,
  RAID_GENRE_ARTISTS,
  RAID_FAVORITE_ARTISTS,
} from "./mockData/raidGraph";

function buildGraph(): WalkGraph {
  const nodes: WalkNode[] = [];
  const edges: WalkEdge[] = [];

  nodes.push({ id: "root", role: "root", label: "freqhole", parentId: null, childCount: 2 });

  // --- local remote ---
  nodes.push(remote("local", "local (charnel)", 5));
  edges.push(edge("root", "remote::local"));

  for (const [kind, label, count] of LOCAL_RELATIONS) {
    nodes.push(relation("local", kind, label, count));
    edges.push(edge("remote::local", `relation::local::${kind}`));
  }

  for (const [val, label, count] of LOCAL_GENRES) {
    const n = value("genres", val, label, count);
    n.parentId = "relation::local::genres";
    nodes.push(n);
    edges.push(edge("relation::local::genres", `value::genres::${val}`));
  }

  for (const [val, label, count] of LOCAL_TAGS) {
    const n = value("tags", val, label, count);
    n.parentId = "relation::local::tags";
    nodes.push(n);
    edges.push(edge("relation::local::tags", `value::tags::${val}`));
  }

  for (const [val, label, count] of LOCAL_ERAS) {
    const n = value("era", val, label, count);
    n.parentId = "relation::local::era";
    nodes.push(n);
    edges.push(edge("relation::local::era", `value::era::${val}`));
  }

  // mood childCount is recomputed from edges downstream
  for (const [val, label] of LOCAL_MOODS) {
    const n = value("mood", val, label, 0);
    n.parentId = "relation::local::mood";
    nodes.push(n);
    edges.push(edge("relation::local::mood", `value::mood::${val}`));
  }

  nodes.push(...LOCAL_ARTISTS);
  nodes.push(...LOCAL_ALBUMS);

  for (const [aId, lps] of ARTIST_ALBUMS) {
    for (const lp of lps) {
      edges.push(edge(`artist::local::${aId}`, `album::local::${lp}`));
    }
  }

  for (const [genre, artists] of Object.entries(GENRE_ARTISTS)) {
    for (const aId of artists) {
      edges.push(edge(`value::genres::${genre}`, `artist::local::${aId}`));
    }
  }

  for (const [genre, albums] of Object.entries(GENRE_ALBUMS)) {
    for (const lpId of albums) {
      edges.push(edge(`value::genres::${genre}`, `album::local::${lpId}`));
    }
  }

  for (const [mood, albums] of Object.entries(MOOD_ALBUMS)) {
    for (const lpId of albums) {
      edges.push(edge(`value::mood::${mood}`, `album::local::${lpId}`));
    }
  }

  for (const [tag, artists] of Object.entries(TAG_ARTISTS)) {
    for (const aId of artists) {
      edges.push(edge(`value::tags::${tag}`, `artist::local::${aId}`));
    }
  }

  for (const aId of FAVORITE_ARTISTS) {
    edges.push(edge("relation::local::favorites", `artist::local::${aId}`));
  }

  nodes.push(...LOCAL_GHOSTS);
  for (const g of LOCAL_GHOSTS) {
    edges.push(edge("relation::local::collaborators", g.id));
  }
  for (const [aId, gId] of COLLAB_PAIRS) {
    edges.push(edge(`artist::local::${aId}`, gId));
  }

  for (const lpId of RECENT_ALBUMS) {
    edges.push(edge("relation::local::recent_albums", `album::local::${lpId}`));
  }

  for (const [era, artists] of Object.entries(ERA_ARTISTS)) {
    for (const aId of artists) {
      edges.push(edge(`value::era::${era}`, `artist::local::${aId}`));
    }
  }

  for (const [aId, related] of ARTIST_SIMILAR) {
    for (const rId of related) {
      edges.push(edge(`artist::local::${aId}`, `artist::local::${rId}`));
    }
  }

  // --- freqraid remote ---
  nodes.push(remote("raid", "freqraid", 3));
  edges.push(edge("root", "remote::raid"));

  for (const [kind, label, count] of RAID_RELATIONS) {
    const rid = `relation::raid::${kind}`;
    nodes.push({ id: rid, role: "relation", label, parentId: "remote::raid", childCount: count });
    edges.push(edge("remote::raid", rid));
  }

  for (const [val, label, count] of RAID_GENRES) {
    const vid = `value::raid_genres::${val}`;
    nodes.push({ id: vid, role: "value", label, parentId: `relation::raid::genres`, childCount: count });
    edges.push(edge("relation::raid::genres", vid));
  }

  nodes.push(...RAID_ARTISTS);
  nodes.push(...RAID_ALBUMS);

  for (const [aId, lps] of RAID_ARTIST_ALBUMS) {
    for (const lp of lps) {
      edges.push(edge(`artist::raid::${aId}`, `album::raid::${lp}`));
    }
  }

  for (const [genre, artists] of Object.entries(RAID_GENRE_ARTISTS)) {
    for (const aId of artists) {
      edges.push(edge(`value::raid_genres::${genre}`, `artist::raid::${aId}`));
    }
  }

  for (const aId of RAID_FAVORITE_ARTISTS) {
    edges.push(edge("relation::raid::favorites", `artist::raid::${aId}`));
  }

  return { nodes, edges };
}

export const MOCK_GRAPH: WalkGraph = buildGraph();
