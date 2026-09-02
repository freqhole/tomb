// hook for the import review flow.
//
// fetches pending review albums for a given session, enriches each with
// its full song list via query_songs, and exposes the mutation fns
// (patch, merge, move, mark-reviewed) that wire back to the api.
//
// usage:
//   const review = useImportReview(() => sessionId(), remote);
//   review.albums()      // ImportReviewAlbum[]
//   review.loading()     // boolean
//   review.patchAlbum(albumId, req)
//   review.mergeAlbums(sourceIds, targetId)
//   review.moveSong(songId, toAlbumId)
//   review.markReviewed(albumId)
//   review.refetch()

import { createSignal, createResource, createMemo } from "solid-js";
import { getClientForRemote } from "../../app/api/client";
import { getRemoteMediaUrl } from "../../utils/urls";
import { toast } from "../../components/feedback/Toast";
import type { CurrentRemoteInfo } from "../data/currentState";
import type {
  ImportReviewAlbum,
  ImportReviewSong,
} from "../../components/import/ImportGroupingView";
import type { PatchAlbumReviewRequest, PendingReviewAlbum } from "@freqhole/api-client";

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

// build an http artwork url from a blob id and the remote's base url.
// used for plain-http remotes; charnel-managed and P2P remotes resolve via
// transport so artworkUrl may be null - MediaImage handles both paths.
function artworkUrlFromBlob(
  blobId: string | null | undefined,
  remote: CurrentRemoteInfo | null | undefined
): string | null {
  if (!blobId || !remote?.base_url) return null;
  return getRemoteMediaUrl(remote.base_url, blobId);
}

// ----------------------------------------------------------------------------
// hook
// ----------------------------------------------------------------------------

export interface ImportReviewHandle {
  albums: () => ImportReviewAlbum[];
  loading: () => boolean;
  patchAlbum: (
    albumId: string,
    req: Omit<PatchAlbumReviewRequest, "album_id" | "session_id">
  ) => Promise<void>;
  mergeAlbums: (sourceIds: string[], targetId: string) => Promise<void>;
  moveSong: (
    songId: string,
    toAlbumId: string | null,
    newAlbumTitle?: string | null,
    newAlbumArtistName?: string | null
  ) => Promise<void>;
  markReviewed: (albumId: string) => Promise<void>;
  refetch: () => void;
}

export function useImportReview(
  sessionId: () => string | null,
  remote: () => CurrentRemoteInfo | null | undefined
): ImportReviewHandle {
  // reload key: increment to trigger refetch
  const [reloadKey, setReloadKey] = createSignal(0);

  const key = createMemo<[string, CurrentRemoteInfo, number] | null>(() => {
    const id = sessionId();
    const r = remote();
    if (!id || !r) return null;
    return [id, r, reloadKey()];
  });

  const [data] = createResource(key, async (k): Promise<ImportReviewAlbum[]> => {
    if (!k) return [];
    const [sid, r] = k;

    let client;
    try {
      client = await getClientForRemote(r);
    } catch (err) {
      toast.error(`failed to reach remote: ${(err as Error).message}`);
      return [];
    }

    // fetch pending review sessions for this session_id
    const pendingResp = await client.music.listPendingImportReview({ session_id: sid });
    if (!pendingResp.success || !pendingResp.data) return [];

    // flatten albums across sessions (should be just one session matching sid)
    const pendingAlbums = pendingResp.data.flatMap(
      (session) => session.albums as PendingReviewAlbum[]
    );
    if (pendingAlbums.length === 0) return [];

    // enrich each album with its full song list
    const results = await Promise.all(
      pendingAlbums.map(async (pa: PendingReviewAlbum): Promise<ImportReviewAlbum> => {
        let songs: ImportReviewSong[] = [];
        let entityUrls: { id?: string; name?: string | null; url: string }[] = [];
        let albumImages: import("../../music/services/storage/types").ImageMetadata[] | undefined;
        let liveTitle: string | undefined;
        let liveReleaseDate: string | null = null;
        let liveLabel: string | null = null;
        let liveGenres: string[] = [];
        let liveAlbumType: string | null = null;
        try {
          const [songsResp, albumResp] = await Promise.all([
            client.music.querySongs({
              q: null,
              search_fields: null,
              filters: { album_id: pa.album_id },
              sort_by: "track_number",
              sort_direction: "asc",
              limit: 1000,
              offset: 0,
              user_id: null,
              favorites_only: null,
              min_rating: null,
            }),
            client.music.getAlbum({ id: pa.album_id }),
          ]);
          if (songsResp.success && songsResp.data) {
            songs = songsResp.data.items.map((it): ImportReviewSong => ({
              id: it.song.id,
              title: it.song.title,
              trackNumber: it.song.track_number ?? undefined,
              discNumber: it.song.disc_number ?? undefined,
              // song.duration from API is milliseconds (raw DB value)
              durationSeconds: it.song.duration != null ? it.song.duration / 1000 : undefined,
            }));
          }
          // capture the live album entity title - separate from the session
          // blob which is written at import time and never updated
          if (albumResp.success && albumResp.data?.title) {
            liveTitle = albumResp.data.title;
          }
          if (albumResp.success && albumResp.data) {
            if (albumResp.data.release_date) liveReleaseDate = albumResp.data.release_date;
            if (albumResp.data.label) liveLabel = albumResp.data.label;
            if (albumResp.data.genres) liveGenres = albumResp.data.genres.map((g) => g.name);
            if (albumResp.data.album_type) liveAlbumType = albumResp.data.album_type;
          }
          if (albumResp.success && albumResp.data?.urls) {
            entityUrls = albumResp.data.urls.map((u) => ({
              id: u.id ?? undefined,
              name: u.name ?? null,
              url: u.url,
            }));
          }
          if (albumResp.success && albumResp.data?.images) {
            albumImages = albumResp.data.images.map((img) => ({
              remote_blob_id: img.blob_id,
              remote_url: artworkUrlFromBlob(img.blob_id, r) ?? undefined,
              remote_server_id: r.remote_id,
              is_primary: img.is_primary === 1,
              blob_type: img.blob_type as "original" | "thumbnail" | "waveform" | "preview",
            }));
          }
          // fall back to getAlbum primary image if pending-review query
          // didn't return artwork (timing window before ProcessFile completes)
          if (!pa.artwork_blob_id && albumResp.success && albumResp.data?.images) {
            const primary = albumResp.data.images.find((img) => img.is_primary === 1);
            if (primary) {
              pa = { ...pa, artwork_blob_id: primary.blob_id };
            }
          }
        } catch {
          // leave empty if fetch fails - album is still reviewable
        }

        const artworkBlobId = pa.artwork_blob_id ?? null;

        // mirror adaptApiImage: pass remote_blob_id + remote_url + remote_server_id
        // so MediaImage's transport-aware resolution works identically to normal
        // album art display (handles HTTP, charnel-managed, and P2P remotes).
        return {
          id: pa.album_id,
          // use the live album entity title instead of the session blob value
          // - the blob title is written at import time and never updated when
          //   the user edits metadata via MB panel or the metadata form.
          title: liveTitle ?? pa.title,
          artist: pa.artist_name ?? null,
          artistId: pa.artist_id ?? null,
          releaseDate: liveReleaseDate,
          label: liveLabel,
          genres: liveGenres,
          albumType: liveAlbumType,
          artworkUrl: artworkUrlFromBlob(artworkBlobId, r),
          artworkBlobId,
          remoteServerId: r.remote_id,
          entityUrls,
          images: albumImages,
          songs,
        };
      })
    );

    return results;
  });

  function refetch() {
    setReloadKey((n) => n + 1);
  }

  async function patchAlbum(
    albumId: string,
    req: Omit<PatchAlbumReviewRequest, "album_id" | "session_id">
  ) {
    const sid = sessionId();
    const r = remote();
    if (!sid || !r) return;
    let client;
    try {
      client = await getClientForRemote(r);
    } catch (err) {
      toast.error(`failed to reach remote: ${(err as Error).message}`);
      return;
    }
    const resp = await client.music.patchAlbumReview({
      album_id: albumId,
      session_id: sid,
      ...req,
    });
    if (!resp.success) {
      toast.error(`patch failed: ${resp.error?.issues?.[0]?.message ?? "unknown error"}`);
      return;
    }
    refetch();
  }

  async function mergeAlbums(sourceIds: string[], targetId: string) {
    const sid = sessionId();
    const r = remote();
    if (!sid || !r) return;
    let client;
    try {
      client = await getClientForRemote(r);
    } catch (err) {
      toast.error(`failed to reach remote: ${(err as Error).message}`);
      return;
    }
    const resp = await client.music.mergeAlbumsReview({
      session_id: sid,
      source_ids: sourceIds,
      target_id: targetId,
    });
    if (!resp.success) {
      toast.error(`merge failed: ${resp.error?.issues?.[0]?.message ?? "unknown error"}`);
      return;
    }
    refetch();
  }

  async function moveSong(
    songId: string,
    toAlbumId: string | null,
    newAlbumTitle: string | null = null,
    newAlbumArtistName: string | null = null
  ) {
    const sid = sessionId();
    const r = remote();
    if (!sid || !r) return;
    let client;
    try {
      client = await getClientForRemote(r);
    } catch (err) {
      toast.error(`failed to reach remote: ${(err as Error).message}`);
      return;
    }
    const resp = await client.music.moveSongReview({
      session_id: sid,
      song_id: songId,
      to_album_id: toAlbumId,
      new_album_title: newAlbumTitle,
      new_album_artist_name: newAlbumArtistName,
    });
    if (!resp.success) {
      toast.error(`move failed: ${resp.error?.issues?.[0]?.message ?? "unknown error"}`);
      return;
    }
    refetch();
  }

  async function markReviewed(albumId: string) {
    const sid = sessionId();
    const r = remote();
    if (!sid || !r) return;
    let client;
    try {
      client = await getClientForRemote(r);
    } catch (err) {
      toast.error(`failed to reach remote: ${(err as Error).message}`);
      return;
    }
    const resp = await client.music.markAlbumReviewed({
      album_id: albumId,
      session_id: sid,
    });
    if (!resp.success) {
      toast.error(`mark reviewed failed: ${resp.error?.issues?.[0]?.message ?? "unknown error"}`);
      return;
    }
    refetch();
  }

  return {
    // use data.latest so albums() keeps the previous value during a source-change
    // refetch - without this, data() briefly returns undefined, currentAlbum()
    // becomes falsy, and the editor unmounts, resetting the active tab.
    albums: () => data.latest ?? data() ?? [],
    // treat "unresolved" (key just became non-null, fetch hasn't started) as
    // loading is only true on the initial fetch (no previous data).
    // during a source-change refetch, data.latest keeps the previous value
    // so we can keep showing the editor without a loading spinner.
    loading: () => (data.loading && !data.latest) || data.state === "unresolved",
    patchAlbum,
    mergeAlbums,
    moveSong,
    markReviewed,
    refetch,
  };
}
