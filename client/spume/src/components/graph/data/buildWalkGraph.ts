// pure deterministic adapter: converts real library data into a WalkGraph
// ready for the walk explorer worker.
//
// output must NOT be wrapped in createStore before posting to the worker —
// the worker expects plain JSON (see S13 in graph2-integration.md).

import type {
  WalkGraph,
  WalkNode,
  WalkEdge,
  AlbumNodeData,
  ArtistNodeData,
  VideoNodeData,
  VideoSeriesNodeData,
  VideoSeasonNodeData,
} from "../types";
import {
  rootId,
  remoteHubId,
  relationHubId,
  artistNodeId,
  albumNodeId,
  videoNodeId,
  videoSeriesNodeId,
  videoSeasonNodeId,
} from "./nodeIds";

export interface BuildWalkGraphInput {
  remoteIds: string[];
  albumsByRemote: Map<string, AlbumNodeData[]>;
  artistsByRemote: Map<string, ArtistNodeData[]>;
  /** video/series data, mixed into the same graph: a video with a
   *  `seasonId` attaches under its season node, a video with a `seriesId`
   *  but no `seasonId` attaches directly under its series node. series
   *  nodes themselves and orphan videos (no series/season) are NOT wired
   *  to the remote hub — they reach the graph exclusively via lazy
   *  taxon-hub pivots (createPivotHandler's maybeLoadVideosForPivot for
   *  generic genre/mood/style hubs, plus recently-added/unassigned),
   *  mirroring how artist nodes reach the graph via value -> artist
   *  edges rather than a direct remote -> artist edge. */
  videosByRemote?: Map<string, VideoNodeData[]>;
  videoSeriesByRemote?: Map<string, VideoSeriesNodeData[]>;
  /** seasons per remote, attached under their series node (phase 5, see
   *  docs/graph-viz-video-domain-plan.md phase 5a). */
  videoSeasonsByRemote?: Map<string, VideoSeasonNodeData[]>;
  /** bare album ids (from song favorites) per remote, unioned with album.isFavorite */
  favoriteSongAlbumIds?: Map<string, Set<string>>;
  /** bare artist ids (from song favorites) per remote, unioned with artist.isFavorite */
  favoriteSongArtistIds?: Map<string, Set<string>>;
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
  /** full payload for every video, video_series, and video_season node,
   *  keyed by graph node id. kept separate from `nodesById` so existing
   *  album/artist consumers don't need to widen their types for a domain
   *  they don't render. */
  videoNodesById: Map<string, VideoNodeData | VideoSeriesNodeData | VideoSeasonNodeData>;
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
  const videoNodesById = new Map<string, VideoNodeData | VideoSeriesNodeData | VideoSeasonNodeData>();

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
    // moved out: seeded lazily by createPivotHandler's
    // maybeLoadBelovedForPivot when the remote hub (or the beloved
    // relation hub) becomes the pivot. emitting it here would surface
    // an empty hub on libraries with no favorites; lazy loader only
    // attaches the hub once the server returns at least one id.

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

    // ---- video series + season + video nodes ---------------------------
    // series/season/video -> series/season edges only (see
    // BuildWalkGraphInput's doc comment): a video with a seasonId attaches
    // under its season node; a video with a seriesId but no seasonId
    // attaches directly under its series node. series nodes and orphan
    // videos are NOT wired to the remote hub — they're surfaced via
    // taxon-hub pivots instead (see createPivotHandler.ts).
    const videoSeries = input.videoSeriesByRemote?.get(remoteId) ?? [];
    const videoSeasons = input.videoSeasonsByRemote?.get(remoteId) ?? [];
    const videos = input.videosByRemote?.get(remoteId) ?? [];
    const knownSeriesIds = new Set(videoSeries.map((s) => s.seriesId));
    const knownSeasonIds = new Set(videoSeasons.map((s) => s.seasonId));

    for (const series of videoSeries) {
      const seriesNodeIdStr = videoSeriesNodeId(remoteId, series.seriesId);
      const seriesVideoCount = videos.filter((v) => v.seriesId === series.seriesId).length;
      nodes.push({
        id: seriesNodeIdStr,
        role: "video_series",
        label: series.title,
        parentId: rhId,
        childCount: seriesVideoCount,
      });
      // no remoteHub -> series edge (mirrors artist nodes above): a series
      // reaches the graph via taxon-hub pivots (createPivotHandler's
      // maybeLoadVideosForPivot / recently-added / unassigned loaders),
      // not by attaching directly to the remote hub.
      videoNodesById.set(seriesNodeIdStr, series);
    }

    for (const season of videoSeasons) {
      // a season whose series isn't in this remote's known series list has
      // nowhere valid to attach — skip rather than silently misparenting
      // it to the remote hub (mirrors how orphan videos are handled below,
      // but a season needs its series to exist, not just be optional).
      if (!knownSeriesIds.has(season.seriesId)) continue;
      const seasonNodeIdStr = videoSeasonNodeId(remoteId, season.seasonId);
      const seriesNodeIdStr = videoSeriesNodeId(remoteId, season.seriesId);
      const seasonVideoCount = videos.filter((v) => v.seasonId === season.seasonId).length;
      nodes.push({
        id: seasonNodeIdStr,
        role: "video_season",
        label: season.title,
        parentId: seriesNodeIdStr,
        childCount: seasonVideoCount,
      });
      edges.push({ source: seriesNodeIdStr, target: seasonNodeIdStr });
      videoNodesById.set(seasonNodeIdStr, season);
    }

    for (const video of videos) {
      const vId = videoNodeId(remoteId, video.videoId);
      const inKnownSeason = video.seasonId !== null && knownSeasonIds.has(video.seasonId);
      const inKnownSeries = video.seriesId !== null && knownSeriesIds.has(video.seriesId);
      const parentId = inKnownSeason
        ? videoSeasonNodeId(remoteId, video.seasonId!)
        : inKnownSeries
          ? videoSeriesNodeId(remoteId, video.seriesId!)
          : rhId;
      nodes.push({
        id: vId,
        role: "video",
        label: video.title,
        parentId,
        childCount: 0,
      });
      // only wire a video -> season/series edge when it actually has one.
      // orphan videos (no series/season) reach the graph exclusively via
      // taxon-hub pivots — generic value/group hubs, or the "unassigned"
      // hub (createPivotHandler's maybeLoadUnassignedForPivot, which
      // fetches exactly this "no entity_taxonz rows" set from the
      // backend) — never via a direct edge to the remote hub.
      if (inKnownSeason || inKnownSeries) {
        edges.push({ source: parentId, target: vId });
      }
      videoNodesById.set(vId, video);
    }
  }

  return { graph: { nodes, edges }, nodesById, videoNodesById };
}

