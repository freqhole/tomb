// adaptAlbumQueryResult
//
// converts an `AlbumQueryResult` (the enriched wire shape returned
// by the cross-remote walk routes — `albums_by_value`,
// `recently_added_albums`) into an `AlbumNodeData` for the graph.
//
// the walk routes return a richer shape than `useLibraryAlbumsQuery`
// (the standard page-by-page loader) — artist comes back nested
// instead of flat — but downstream consumers want the same node
// shape. simplest path: project to `AlbumSummary`, then reuse
// `adaptAlbum`. parallels the layering already used by
// RemoteAlbumsLoader.
//
// added 2026-05-25 for phase 9 walk-expansion.

import type { AlbumQueryResult } from "freqhole-api-client";
import type { AlbumSummary, ImageMetadata } from "../../../music/data/types";
import type { AlbumNodeData } from "../../../components/graph/types";
import { adaptAlbum, type AdaptAlbumOpts } from "./adaptAlbum";

function parseYear(releaseDate: string | null | undefined): number | undefined {
  if (!releaseDate) return undefined;
  // accept "YYYY", "YYYY-MM-DD", and other ISO-ish prefixes.
  const head = releaseDate.slice(0, 4);
  const n = parseInt(head, 10);
  return Number.isFinite(n) ? n : undefined;
}

function adaptImages(
  imgs: AlbumQueryResult["images"] | AlbumQueryResult["album"]["images"],
): ImageMetadata[] {
  if (!imgs) return [];
  return imgs.map((i) => ({
    remote_blob_id: i.blob_id,
    // server sends is_primary as 0/1; client uses boolean.
    is_primary: i.is_primary === 1,
    blob_type: i.blob_type,
  }));
}

/** project the rich query-result row to the flat summary the existing
 *  `adaptAlbum` already knows how to chew on. exposed so other walk-
 *  result consumers (popover hydration, future top-N hubs) can reuse
 *  the same shape conversion. */
export function albumQueryResultToSummary(r: AlbumQueryResult): AlbumSummary {
  // album-level image override wins; otherwise use the row's image
  // bundle (which the view layer usually populates for both art and
  // collage rendering).
  const images = adaptImages(r.album.images ?? r.images);

  return {
    album_id: r.album.id,
    title: r.album.title,
    artist_id: r.artist?.id ?? "",
    artist_name: r.artist?.name ?? "",
    album_type: r.album.album_type,
    year: parseYear(r.album.release_date),
    release_date: r.album.release_date ?? undefined,
    label: r.album.label ?? undefined,
    genres: r.album.genres ?? undefined,
    taxons: r.album.taxons ?? undefined,
    song_count: r.album.song_count,
    total_duration: r.album.total_duration,
    images,
    urls: r.album.urls
      ?.filter((u): u is { id: string; name: string | null; url: string } =>
        u.id != null,
      )
      .map((u) => ({
        id: u.id,
        name: u.name ?? undefined,
        url: u.url,
      })),
    is_favorite: r.is_favorite ?? undefined,
    user_rating: r.rating ?? undefined,
    tags: r.album_tags ?? undefined,
    created_at: r.album.created_at,
    updated_at: r.album.updated_at,
    metadata: r.album.metadata ?? undefined,
    mb_lookup_status: r.album.mb_lookup_status ?? undefined,
    mb_lookup_at: r.album.mb_lookup_at ?? undefined,
    mb_lookup_by: r.album.mb_lookup_by ?? undefined,
  };
}

export function adaptAlbumQueryResult(
  r: AlbumQueryResult,
  opts: AdaptAlbumOpts,
): AlbumNodeData {
  return adaptAlbum(albumQueryResultToSummary(r), opts);
}
