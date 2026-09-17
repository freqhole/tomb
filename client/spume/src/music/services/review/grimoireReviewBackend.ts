// grimoire `ReviewBackend` adapter - wraps the music.* api-client calls
// for whichever remote this session lives on. ports the per-album
// enrichment logic that used to live inline in useImportReview.ts's
// resource fetcher, plus the pending-sessions listing + bulk mark-reviewed
// that used to live inline in AddMediaModal.tsx's grimoire branch - both
// consumers now go through this one implementation (see reviewBackend.ts).
import { getClientForRemote } from "../../../app/api/client";
import { getRemoteMediaUrl } from "../../../utils/urls";
import type { CurrentRemoteInfo } from "../../data/currentState";
import type { ImportReviewAlbum, ImportReviewSong } from "./importReviewTypes";
import type { ImageMetadata } from "../../services/storage/types";
import type { PendingReviewAlbum, PendingReviewSession } from "@freqhole/api-client";
import type { ReviewBackend, ReviewSendTarget } from "./reviewBackendTypes";

// build an http artwork url from a blob id and the remote's base url.
// used for plain-http remotes; charnel-managed and P2P remotes resolve via
// transport so artworkUrl may be null - MediaImage handles both paths.
function artworkUrlFromBlob(
  blobId: string | null | undefined,
  remote: CurrentRemoteInfo
): string | null {
  if (!blobId || !remote.base_url) return null;
  return getRemoteMediaUrl(remote.base_url, blobId);
}

async function enrichAlbum(
  client: Awaited<ReturnType<typeof getClientForRemote>>,
  remote: CurrentRemoteInfo,
  pa: PendingReviewAlbum
): Promise<ImportReviewAlbum> {
  let songs: ImportReviewSong[] = [];
  let entityUrls: { id?: string; name?: string | null; url: string }[] = [];
  let albumImages: ImageMetadata[] | undefined;
  let liveTitle: string | undefined;
  let liveReleaseDate: string | null = null;
  let liveLabel: string | null = null;
  let liveGenres: string[] = [];
  let liveAlbumType: string | null = null;
  let artworkBlobId = pa.artwork_blob_id ?? null;

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
        remote_url: artworkUrlFromBlob(img.blob_id, remote) ?? undefined,
        remote_server_id: remote.remote_id,
        is_primary: img.is_primary === 1,
        blob_type: img.blob_type as "original" | "thumbnail" | "waveform" | "preview",
      }));
    }
    // fall back to getAlbum primary image if pending-review query didn't
    // return artwork (timing window before ProcessFile completes)
    if (!artworkBlobId && albumResp.success && albumResp.data?.images) {
      const primary = albumResp.data.images.find((img) => img.is_primary === 1);
      if (primary) artworkBlobId = primary.blob_id;
    }
  } catch {
    // leave partially-populated - album is still reviewable
  }

  // mirror adaptApiImage: pass remote_blob_id + remote_url + remote_server_id
  // so MediaImage's transport-aware resolution works identically to normal
  // album art display (handles HTTP, charnel-managed, and P2P remotes).
  return {
    id: pa.album_id,
    // use the live album entity title instead of the session blob value -
    // the blob title is written at import time and never updated when the
    // user edits metadata via MB panel or the metadata form.
    title: liveTitle ?? pa.title,
    artist: pa.artist_name ?? null,
    artistId: pa.artist_id ?? null,
    releaseDate: liveReleaseDate,
    label: liveLabel,
    genres: liveGenres,
    albumType: liveAlbumType,
    artworkUrl: artworkUrlFromBlob(artworkBlobId, remote),
    artworkBlobId,
    remoteServerId: remote.remote_id,
    entityUrls,
    images: albumImages,
    songs,
  };
}

export function createGrimoireReviewBackend(remote: CurrentRemoteInfo): ReviewBackend {
  return {
    kind: "grimoire",
    remote,

    async listPendingSessions(): Promise<PendingReviewSession[]> {
      const client = await getClientForRemote(remote);
      const resp = await client.music.listPendingImportReview({ session_id: null });
      if (!resp.success) return [];
      return resp.data ?? [];
    },

    async getSessionAlbums(sessionId): Promise<ImportReviewAlbum[]> {
      const client = await getClientForRemote(remote);
      const resp = await client.music.listPendingImportReview({ session_id: sessionId });
      if (!resp.success || !resp.data) return [];
      const pendingAlbums = resp.data.flatMap((session) => session.albums as PendingReviewAlbum[]);
      if (pendingAlbums.length === 0) return [];
      return Promise.all(pendingAlbums.map((pa) => enrichAlbum(client, remote, pa)));
    },

    async getSessionTarget(sessionId): Promise<ReviewSendTarget | null> {
      const client = await getClientForRemote(remote);
      const resp = await client.music.getImportSessionTarget({ session_id: sessionId });
      if (!resp.success || !resp.data.target_remote_id || !resp.data.target_remote_name) {
        return null;
      }
      return { id: resp.data.target_remote_id, name: resp.data.target_remote_name };
    },

    async patchAlbum(sessionId, albumId, req) {
      const client = await getClientForRemote(remote);
      const resp = await client.music.patchAlbumReview({
        album_id: albumId,
        session_id: sessionId,
        ...req,
      });
      if (!resp.success) {
        throw new Error(resp.error?.issues?.[0]?.message ?? "patch failed");
      }
    },

    async mergeAlbums(sessionId, sourceIds, targetId) {
      const client = await getClientForRemote(remote);
      const resp = await client.music.mergeAlbumsReview({
        session_id: sessionId,
        source_ids: sourceIds,
        target_id: targetId,
      });
      if (!resp.success) {
        throw new Error(resp.error?.issues?.[0]?.message ?? "merge failed");
      }
    },

    async moveSong(sessionId, songId, toAlbumId, newAlbumTitle = null, newAlbumArtistName = null) {
      const client = await getClientForRemote(remote);
      const resp = await client.music.moveSongReview({
        session_id: sessionId,
        song_id: songId,
        to_album_id: toAlbumId,
        new_album_title: newAlbumTitle,
        new_album_artist_name: newAlbumArtistName,
      });
      if (!resp.success) {
        throw new Error(resp.error?.issues?.[0]?.message ?? "move failed");
      }
    },

    async markAlbumReviewed(sessionId, albumId) {
      const client = await getClientForRemote(remote);
      const resp = await client.music.markAlbumReviewed({
        album_id: albumId,
        session_id: sessionId,
      });
      if (!resp.success) {
        throw new Error(resp.error?.issues?.[0]?.message ?? "mark reviewed failed");
      }
    },

    async markSessionReviewed(session) {
      const client = await getClientForRemote(remote);
      for (const album of session.albums) {
        const resp = await client.music.markAlbumReviewed({
          album_id: album.album_id,
          session_id: session.session_id,
        });
        if (!resp.success) {
          throw new Error(resp.error?.issues?.[0]?.message ?? "mark reviewed failed");
        }
      }
    },
  };
}
