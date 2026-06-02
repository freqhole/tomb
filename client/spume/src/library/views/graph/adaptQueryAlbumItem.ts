// shared album-row adapter for `queryAlbums` responses. used by both
// the library pivot handler (lazy-loading albums under taxon/artist
// hubs in library mode) and the search-mode pivot handler (loading
// albums under a taxon value hit). previously inlined inside
// createPivotHandler — extracted so the two code paths can't drift.

import type { Remote } from "../../../app/services/storage/schemas/remote";
import type { AlbumNodeData } from "../../../components/graph/types";
import type { AlbumSummary } from "../../../music/data/types";
import { adaptApiImage, adaptApiUrls } from "../../../music/data/remote/adapters";
import { adaptAlbum } from "./adaptAlbum";

export function adaptQueryAlbumItem(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item: any,
  remote: Remote,
): AlbumNodeData {
  const baseUrl = (remote as { base_url?: string }).base_url ?? "";
  const remoteId = remote.remote_id;
  const summary: AlbumSummary = {
    album_id: item.album.id,
    title: item.album.title,
    artist_id: item.artist?.id ?? "",
    artist_name: item.artist?.name ?? "unknown artist",
    album_type: item.album.album_type,
    year: undefined,
    release_date: item.album.release_date ?? undefined,
    label: item.album.label ?? undefined,
    genres: item.album.genres ?? undefined,
    song_count: item.album.song_count,
    total_duration: item.album.total_duration,
    images:
      item.images && item.images.length > 0
        ? item.images.map((img: unknown) => adaptApiImage(img as never, baseUrl, remoteId))
        : undefined,
    urls: adaptApiUrls(item.album.urls),
    is_favorite: item.is_favorite ?? undefined,
    user_rating: item.rating ?? undefined,
    tags: item.album_tags ?? undefined,
    created_at: item.album.created_at,
    updated_at: item.album.updated_at,
    created_by_username: item.album.created_by_username ?? undefined,
    updated_by_username: item.album.updated_by_username ?? undefined,
    metadata: item.album.metadata ?? null,
    mb_lookup_status: item.album.mb_lookup_status ?? null,
    mb_lookup_at: item.album.mb_lookup_at ?? null,
    mb_lookup_by: item.album.mb_lookup_by ?? null,
  };
  return adaptAlbum(summary, { remoteId });
}
