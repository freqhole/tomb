// pure deterministic adapter: converts real library data into a WalkGraph
// ready for the walk explorer worker.
//
// output must NOT be wrapped in createStore before posting to the worker —
// the worker expects plain JSON (see S13 in graph2-integration.md).

import type { WalkGraph, WalkNode, WalkEdge, AlbumNodeData, ArtistNodeData } from "../types";
import {
  rootId,
  remoteHubId,
  relationHubId,
  artistNodeId,
  albumNodeId,
} from "./nodeIds";

export interface BuildWalkGraphInput {
  remoteIds: string[];
  albumsByRemote: Map<string, AlbumNodeData[]>;
  artistsByRemote: Map<string, ArtistNodeData[]>;
  /** bare album ids (from song favorites) per remote, unioned with album.isFavorite */
  favoriteSongAlbumIds?: Map<string, Set<string>>;
  /** bare artist ids (from song favorites) per remote, unioned with artist.isFavorite */
  favoriteSongArtistIds?: Map<string, Set<string>>;
  /** bare album ids "beloved" by any user on this remote (server-side aggregate). */
  belovedAlbumIdsByRemote?: Map<string, Set<string>>;
  /** bare artist ids "beloved" by any user on this remote (server-side aggregate). */
  belovedArtistIdsByRemote?: Map<string, Set<string>>;
  /** which remoteIds correspond to the local charnel-managed sidecar.
   *  the renderer draws a home-icon glyph next to those remote-hub labels. */
  charnelManagedRemoteIds?: Set<string>;
  /** human-readable display name per remoteId. used as the remote-hub label
   *  so renames (web local-library AppState, charnel toml server.name) are
   *  reflected in the graph viz. falls back to remoteId when unset. */
  remoteNamesById?: Map<string, string>;
}

export interface BuildWalkGraphOutput {
  graph: WalkGraph;
  /** full payload for every artist and album node, keyed by graph node id.
   *  hubs, value nodes, and root are NOT included. used by main thread for
   *  popover hydration and image resolution (S1). */
  nodesById: Map<string, AlbumNodeData | ArtistNodeData>;
}

// note: relation hubs (genre, mood, style, custom kinds, ...) are NOT
// derived from in-memory albums anymore. doing so was broken — page-1
// of an album catalogue (~200 rows) only covers a sliver of a library
// and would silently drop taxons attached to off-page albums.
//
// hubs are now seeded by LibraryGraphSubview from the dedicated
// `list_taxon_kinds` endpoint (one lazy hub per categorical kind);
// value nodes are lazy-loaded via `query_taxons` on hub pivot
// (`maybeLoadTaxonsForPivot`); and value->album edges are lazy-loaded
// via `query_albums` on value pivot (`maybeLoadAlbumsForPivot`).
//
// the synthesized hubs (`era`, `recently_added`, `favorite`) remain
// here because they have no row in `taxon_kindz`:
//   - era: server-side greedy decade binner (`list_era_bins`).
//   - recently_added: top-N by created_at (`list_recently_added_albums`).
//   - favorite: per-user signal unioned from album.isFavorite +
//     artist.isFavorite + song-derived favorite ids.

// AlbumNodeData.id is `${remoteId}::${albumId}` (set by adaptAlbum). albumNodeId
// expects a bare albumId, so strip the prefix before calling it.
function toBareAlbumId(remoteId: string, album: AlbumNodeData): string {
  const p = `${remoteId}::`;
  return album.id.startsWith(p) ? album.id.slice(p.length) : album.id;
}

// ArtistNodeData.id is `artist::${artistId}` (set by deriveArtistNodes) but
// .artistId is always bare. strip any accidental `artist::` prefix defensively.
function toBareArtistId(artist: ArtistNodeData): string {
  const p = "artist::";
  return artist.artistId.startsWith(p) ? artist.artistId.slice(p.length) : artist.artistId;
}

export function buildWalkGraph(input: BuildWalkGraphInput): BuildWalkGraphOutput {
  const { remoteIds, albumsByRemote, artistsByRemote } = input;

  const nodes: WalkNode[] = [];
  const edges: WalkEdge[] = [];
  const nodesById = new Map<string, AlbumNodeData | ArtistNodeData>();

  // ---- root ----------------------------------------------------------------
  const rId = rootId();
  nodes.push({ id: rId, role: "root", label: "root", parentId: null, childCount: remoteIds.length });

  for (const remoteId of remoteIds) {
    const albums  = albumsByRemote.get(remoteId)  ?? [];
    const artists = artistsByRemote.get(remoteId) ?? [];

    // ---- remote hub --------------------------------------------------------
    const rhId = remoteHubId(remoteId);
    nodes.push({
      id: rhId,
      role: "remote",
      label: input.remoteNamesById?.get(remoteId) ?? remoteId,
      parentId: rId,
      childCount: artists.length, // direct artist children (not counting relation hubs for sizing)
      isCharnelManaged: input.charnelManagedRemoteIds?.has(remoteId) || undefined,
    });
    edges.push({ source: rId, target: rhId });

    // ---- synthesized hubs (era, recently_added) --------------------------
    // these hubs aren't backed by stored taxonz: era is computed by the
    // backend's greedy decade binner (`list_era_bins`) and recently_added
    // is the top-N most-recently-added albums (`list_recently_added_albums`).
    // they are now seeded lazily by LibraryGraphSubview when the remote
    // hub becomes the pivot (see maybeLoadEraBinsForPivot /
    // maybeLoadRecentlyAddedForPivot). emitting them unconditionally
    // here would surface zero-count hexagons on libraries with no
    // year-dated or recently-added albums; deferring to the loaders
    // means hubs only appear once a real count is known and is > 0.

    // ---- favorite hub (flat: hub -> artist/album, no value tier) -----------
    // sources: album.isFavorite, artist.isFavorite, plus song-derived ids
    // passed in via BuildWalkGraphInput (querySongs with favorites_only: true).
    {
      const songFavAlbums = input.favoriteSongAlbumIds?.get(remoteId) ?? new Set<string>();
      const songFavArtists = input.favoriteSongArtistIds?.get(remoteId) ?? new Set<string>();
      const favArtistIds = new Set<string>([
        ...artists.filter((a) => a.isFavorite).map((a) => toBareArtistId(a)),
        ...Array.from(songFavArtists),
      ]);
      const favAlbumIds = new Set<string>([
        ...albums.filter((a) => a.isFavorite).map((a) => toBareAlbumId(remoteId, a)),
        ...Array.from(songFavAlbums),
      ]);
      if (favArtistIds.size > 0 || favAlbumIds.size > 0) {
        const favHubId = relationHubId(remoteId, "favorites");
        nodes.push({
          id: favHubId,
          role: "relation",
          label: "favorites",
          parentId: rhId,
          childCount: favArtistIds.size + favAlbumIds.size,
        });
        edges.push({ source: rhId, target: favHubId });
        for (const bareArtistId of favArtistIds) {
          edges.push({ source: favHubId, target: artistNodeId(remoteId, bareArtistId) });
        }
        for (const bareAlbumId of favAlbumIds) {
          edges.push({ source: favHubId, target: albumNodeId(remoteId, bareAlbumId) });
        }
      }
    }

    // ---- beloved hub (all-users favorites aggregate) -----------------------
    // server-side endpoint `/api/favorites/beloved` returns the distinct
    // union of album/artist ids favorited by any user on this remote
    // (direct + song-derived). emit only when at least one id is known.
    {
      const belovedAlbums = input.belovedAlbumIdsByRemote?.get(remoteId) ?? new Set<string>();
      const belovedArtists = input.belovedArtistIdsByRemote?.get(remoteId) ?? new Set<string>();
      console.log("[beloved] buildWalkGraph emit", { remoteId, albums: belovedAlbums.size, artists: belovedArtists.size, hasAlbumMap: !!input.belovedAlbumIdsByRemote, hasArtistMap: !!input.belovedArtistIdsByRemote });
      if (belovedAlbums.size > 0 || belovedArtists.size > 0) {
        const belHubId = relationHubId(remoteId, "beloved");
        nodes.push({
          id: belHubId,
          role: "relation",
          label: "beloved",
          parentId: rhId,
          childCount: belovedAlbums.size + belovedArtists.size,
        });
        edges.push({ source: rhId, target: belHubId });
        for (const bareArtistId of belovedArtists) {
          edges.push({ source: belHubId, target: artistNodeId(remoteId, bareArtistId) });
        }
        for (const bareAlbumId of belovedAlbums) {
          edges.push({ source: belHubId, target: albumNodeId(remoteId, bareAlbumId) });
        }
      }
    }

    // ---- relation hubs --------------------------------------------------
    // moved out: hubs are now seeded by LibraryGraphSubview from
    // `list_taxon_kinds` (see header comment). values + edges are
    // lazy-loaded on pivot via maybeLoadTaxonsForPivot /
    // maybeLoadAlbumsForPivot. no per-album taxon scan happens here.

    // ---- artist nodes ------------------------------------------------------
    for (const artist of artists) {
      const aId = artistNodeId(remoteId, toBareArtistId(artist));
      // count albums belonging to this artist in this remote
      const artistAlbums = albums.filter((alb) => alb.artistId === artist.artistId);
      nodes.push({
        id: aId,
        role: "artist",
        label: artist.name,
        parentId: rhId,
        childCount: artistAlbums.length,
      });
      // NOTE: no remoteHub -> artist edge. parentId still points at rhId
      // for breadcrumb / hierarchy traversal, but the visible link is
      // suppressed to cut radial clutter. artists reach the rest of the
      // graph via value -> artist edges emitted in the relation-hub loop
      // above.
      nodesById.set(aId, artist);

      // ---- album nodes ---------------------------------------------------
      for (const album of artistAlbums) {
        const albId = albumNodeId(remoteId, toBareAlbumId(remoteId, album));
        nodes.push({
          id: albId,
          role: "album",
          label: album.title,
          parentId: aId,
          childCount: 0,
        });
        edges.push({ source: aId, target: albId });
        nodesById.set(albId, album);
      }
    }

    // albums that have no matching artist node in this remote's artist list
    // are attached directly to the remote hub as orphans.
    const knownArtistIds = new Set(artists.map((a) => a.artistId));
    for (const album of albums) {
      if (!knownArtistIds.has(album.artistId)) {
        const albId = albumNodeId(remoteId, toBareAlbumId(remoteId, album));
        nodes.push({
          id: albId,
          role: "album",
          label: album.title,
          parentId: rhId,
          childCount: 0,
        });
        edges.push({ source: rhId, target: albId });
        nodesById.set(albId, album);
      }
    }
  }

  return { graph: { nodes, edges }, nodesById };
}
